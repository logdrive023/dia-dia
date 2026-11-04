import { db } from '../db/db';
import { fmtDate, money, todayStr } from '../lib/util';
import { getSetting } from './settings';
import { syncGap } from './summary';

export interface Finding {
  level: 'erro' | 'aviso';
  title: string;
  detail?: string;
}

/**
 * Confere a coerência dos dados gravados (somente leitura): estoque x movimentos, vendas x caixa,
 * vínculos quebrados e dias que ficaram diferentes do dia anterior.
 */
export async function runDiagnostics(): Promise<{ findings: Finding[]; checked: Record<string, number> }> {
  const [groups, variants, days, items, moves, orders, sales, reservations, cashRecs, cashMoves, credits] = await Promise.all([
    db.groups.toArray(), db.variants.toArray(), db.dailyRecords.orderBy('date').toArray(), db.dailyStockItems.toArray(),
    db.stockMovements.toArray(), db.orders.toArray(), db.sales.toArray(), db.reservations.toArray(),
    db.cashRecords.toArray(), db.cashMovements.toArray(), db.credits.toArray(),
  ]);
  const f: Finding[] = [];
  const gIds = new Set(groups.map((g) => g.id));
  const vMap = new Map(variants.map((v) => [v.id, v]));
  const dMap = new Map(days.map((d) => [d.id, d]));
  const gName = new Map(groups.map((g) => [g.id, g.name]));
  const name = (vid: string) => { const v = vMap.get(vid); return v ? `${gName.get(v.groupId) ?? '?'} ${v.name}` : `variação removida (${vid.slice(0, 6)})`; };
  const dName = (id: string) => (dMap.get(id) ? fmtDate(dMap.get(id)!.date, false) : 'dia removido');

  // vínculos
  for (const v of variants) if (!gIds.has(v.groupId)) f.push({ level: 'erro', title: `Variação sem grupo: ${v.name}` });
  const orphanItems = items.filter((i) => !dMap.has(i.dailyRecordId) || !vMap.has(i.variantId)).length;
  if (orphanItems) f.push({ level: 'erro', title: `${orphanItems} registros de estoque sem dia ou variação` });
  const orphanMoves = moves.filter((m) => !dMap.has(m.dailyRecordId) || !vMap.has(m.variantId)).length;
  if (orphanMoves) f.push({ level: 'erro', title: `${orphanMoves} movimentos sem dia ou variação` });

  // estoque = inicial + soma dos movimentos
  const delta = new Map<string, number>();
  for (const m of moves) delta.set(`${m.dailyRecordId}|${m.variantId}`, (delta.get(`${m.dailyRecordId}|${m.variantId}`) ?? 0) + m.quantity);
  for (const i of items) {
    const expected = i.initialQuantity + (delta.get(`${i.dailyRecordId}|${i.variantId}`) ?? 0);
    if (expected !== i.currentQuantity)
      f.push({ level: 'erro', title: `Estoque não bate com os movimentos: ${name(i.variantId)} em ${dName(i.dailyRecordId)}`,
        detail: `Gravado ${i.currentQuantity}, pelos movimentos deveria ser ${expected}.` });
    // só acontece ao juntar celulares que venderam a mesma última peça: é aviso para conferir, não erro do banco
    if (i.currentQuantity < 0) f.push({ level: 'aviso', title: `Vendeu mais do que tinha: ${name(i.variantId)} em ${dName(i.dailyRecordId)} (${i.currentQuantity})`,
      detail: 'Os dois celulares venderam a mesma peça. Confira a peça e ajuste no Estoque.' });
  }
  const itemKeys = new Set(items.map((i) => `${i.dailyRecordId}|${i.variantId}`));
  for (const key of delta.keys()) if (!itemKeys.has(key) && delta.get(key)) {
    const [d, v] = key.split('|');
    f.push({ level: 'erro', title: `Movimentos sem registro de estoque: ${name(v)} em ${dName(d)}` });
  }

  // vendas x estoque x caixa
  const salesBy = new Map<string, typeof sales>();
  for (const s of sales) salesBy.set(s.orderId, [...(salesBy.get(s.orderId) ?? []), s]);
  const cashBy = new Map<string, typeof cashMoves>();
  for (const c of cashMoves) if (c.relatedOrderId) cashBy.set(c.relatedOrderId, [...(cashBy.get(c.relatedOrderId) ?? []), c]);
  for (const o of orders) {
    const ls = salesBy.get(o.id) ?? [];
    const when = `${dName(o.dailyRecordId)} ${new Date(o.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    if (!ls.length) { f.push({ level: 'erro', title: `Venda sem peças (${when})` }); continue; }
    const total = ls.reduce((s, l) => s + l.totalInCents, 0);
    if (total !== o.totalInCents) f.push({ level: 'erro', title: `Total da venda não bate (${when})`, detail: `Venda ${money(o.totalInCents)}, peças somam ${money(total)}.` });
    if (ls.some((l) => l.status !== o.status)) f.push({ level: 'erro', title: `Situação das peças diferente da venda (${when})` });
    const cm = cashBy.get(o.id) ?? [];
    const cash = cm.reduce((s, c) => s + (c.type === 'venda' ? c.amountInCents : c.type === 'estorno' ? -c.amountInCents : 0), 0);
    // pago = dinheiro + vale usado − vale devolvido (venda sem vale: pago = dinheiro)
    const cr = credits.filter((c) => c.orderId === o.id);
    const net = cash - cr.filter((c) => c.amountInCents > 0).reduce((s, c) => s + c.amountInCents, 0) - cr.filter((c) => c.amountInCents < 0).reduce((s, c) => s + c.amountInCents, 0);
    const expected = o.status === 'ok' ? o.totalInCents : 0;
    if (o.fiado && o.status === 'ok' ? net < 0 || net > expected : net !== expected)
      f.push({ level: 'erro', title: o.status === 'ok' ? `Valor no caixa diferente da venda (${when})` : `Venda cancelada sem estorno completo no caixa (${when})`,
        detail: `No caixa ${money(net)}, deveria ser ${money(expected)}.` });
    if (o.payments && o.payments.reduce((s, p) => s + p.amountInCents, 0) !== (o.valeInCents ? cash : o.totalInCents) && !cm.some((c) => c.description === 'Correção de valor') && !cr.length && o.status === 'ok')
      f.push({ level: 'erro', title: `Pagamento dividido não soma o total (${when})` });
    // baixa no estoque exatamente uma vez por peça: saiu − voltou (devolução/cancelamento) = o que ficou vendido
    const sold = moves.filter((m) => m.orderId === o.id && m.type === 'venda').reduce((s, m) => s - m.quantity, 0);
    const back = moves.filter((m) => m.orderId === o.id && m.type === 'cancelamento').reduce((s, m) => s + m.quantity, 0);
    const qty = o.status === 'ok' ? ls.reduce((s, l) => s + l.quantity, 0) : 0;
    if (sold - back !== qty) f.push({ level: 'erro', title: `Baixa no estoque não bate com a venda (${when})`, detail: `Ficou vendido ${qty}, o estoque baixou ${sold - back}.` });
  }

  // caixa
  const recDays = new Map<string, number>();
  for (const c of cashRecs) recDays.set(c.dailyRecordId, (recDays.get(c.dailyRecordId) ?? 0) + 1);
  for (const d of days) if ((recDays.get(d.id) ?? 0) !== 1) f.push({ level: 'erro', title: `Caixa ausente ou duplicado em ${fmtDate(d.date, false)}` });
  if (cashMoves.some((c) => !Number.isInteger(c.amountInCents) || c.amountInCents <= 0)) f.push({ level: 'erro', title: 'Lançamento de caixa com valor inválido' });

  // reservas
  for (const r of reservations.filter((x) => x.status === 'active')) {
    const v = vMap.get(r.variantId);
    if (!v) f.push({ level: 'erro', title: 'Reserva ativa de uma variação que não existe' });
    else if (v.archivedAt) f.push({ level: 'aviso', title: `Reserva ativa de variação arquivada: ${name(v.id)}` });
  }

  // avisos de rotina
  for (const d of days) {
    const gap = await syncGap(d.id);
    if (gap) f.push({ level: 'aviso', title: `${fmtDate(d.date, false)} começou diferente do fim de ${fmtDate(gap.prevDate, false)}`,
      detail: `${gap.diffs.length} variações, ${gap.units} peças. Provavelmente o dia anterior foi corrigido depois. Abra o dia e toque em “Atualizar”.` });
  }
  const today = todayStr();
  const openPast = days.filter((d) => d.status === 'open' && d.date < today);
  if (openPast.length) f.push({ level: 'aviso', title: `${openPast.length} dia(s) passado(s) ainda aberto(s)`, detail: openPast.map((d) => fmtDate(d.date, false)).join(', ') });
  const future = days.filter((d) => d.date > today);
  if (future.length) f.push({ level: 'aviso', title: `Dia(s) no futuro registrado(s)`, detail: future.map((d) => fmtDate(d.date, false)).join(', ') });
  // cor antiga (arquivada/excluída) com peças no dia aberto: é como “Poa 7 + Poa 7 = 14” quando só existiam 7
  const gArchived = new Set(groups.filter((g) => g.archivedAt).map((g) => g.id));
  for (const d of days.filter((x) => x.status === 'open')) {
    for (const i of items.filter((x) => x.dailyRecordId === d.id && x.currentQuantity !== 0)) {
      const v = vMap.get(i.variantId);
      if (v && (v.archivedAt || v.deletedAt || gArchived.has(v.groupId)))
        f.push({ level: 'aviso', title: `Cor antiga com peças: ${name(v.id)} (${i.currentQuantity}) em ${dName(d.id)}`,
          detail: 'Não conta no total. No Estoque, toque em “Resolver” para passar as peças para a cor certa ou zerar.' });
    }
  }
  // nome repetido entre cores ativas do mesmo grupo
  const seen = new Map<string, string[]>();
  for (const v of variants) if (!v.archivedAt && !v.deletedAt) {
    const k = `${v.groupId}|${v.name.trim().toLowerCase()}|${(v.size ?? '').toLowerCase()}`;
    seen.set(k, [...(seen.get(k) ?? []), v.id]);
  }
  for (const ids of seen.values()) if (ids.length > 1)
    f.push({ level: 'aviso', title: `Cor repetida no mesmo grupo: ${name(ids[0])} (${ids.length}×)`, detail: 'Confira se não está contando a mesma peça duas vezes.' });
  const last = await getSetting('lastBackupAt');
  if (days.length && !last) f.push({ level: 'aviso', title: 'Nenhum backup feito ainda' });

  return {
    findings: f.sort((a, b) => (a.level === b.level ? 0 : a.level === 'erro' ? -1 : 1)),
    checked: { dias: days.length, variacoes: variants.length, estoques: items.length, movimentos: moves.length, vendas: orders.length, caixa: cashMoves.length },
  };
}
