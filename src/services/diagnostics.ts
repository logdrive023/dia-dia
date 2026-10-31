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
  const [groups, variants, days, items, moves, orders, sales, reservations, cashRecs, cashMoves] = await Promise.all([
    db.groups.toArray(), db.variants.toArray(), db.dailyRecords.orderBy('date').toArray(), db.dailyStockItems.toArray(),
    db.stockMovements.toArray(), db.orders.toArray(), db.sales.toArray(), db.reservations.toArray(),
    db.cashRecords.toArray(), db.cashMovements.toArray(),
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
    if (i.currentQuantity < 0) f.push({ level: 'erro', title: `Estoque negativo: ${name(i.variantId)} em ${dName(i.dailyRecordId)}` });
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
    const net = cm.reduce((s, c) => s + (c.type === 'venda' ? c.amountInCents : c.type === 'estorno' ? -c.amountInCents : 0), 0);
    const expected = o.status === 'ok' ? o.totalInCents : 0;
    if (net !== expected)
      f.push({ level: 'erro', title: o.status === 'ok' ? `Valor no caixa diferente da venda (${when})` : `Venda cancelada sem estorno completo no caixa (${when})`,
        detail: `No caixa ${money(net)}, deveria ser ${money(expected)}.` });
    if (o.payments && o.payments.reduce((s, p) => s + p.amountInCents, 0) !== o.totalInCents && !cm.some((c) => c.description === 'Correção de valor'))
      f.push({ level: 'erro', title: `Pagamento dividido não soma o total (${when})` });
    // baixa no estoque exatamente uma vez por peça
    const sold = moves.filter((m) => m.orderId === o.id && m.type === 'venda').reduce((s, m) => s - m.quantity, 0);
    const qty = ls.reduce((s, l) => s + l.quantity, 0);
    if (sold !== qty) f.push({ level: 'erro', title: `Baixa no estoque não bate com a venda (${when})`, detail: `Vendeu ${qty}, baixou ${sold}.` });
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
  const last = await getSetting('lastBackupAt');
  if (days.length && !last) f.push({ level: 'aviso', title: 'Nenhum backup feito ainda' });

  return {
    findings: f.sort((a, b) => (a.level === b.level ? 0 : a.level === 'erro' ? -1 : 1)),
    checked: { dias: days.length, variacoes: variants.length, estoques: items.length, movimentos: moves.length, vendas: orders.length, caixa: cashMoves.length },
  };
}
