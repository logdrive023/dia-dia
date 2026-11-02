/**
 * Cadastro e relatório (bugs de 02/11):
 *  1) cor arquivada precisa de "Excluir"; depois de excluir, o relatório fica certo;
 *  2) mudar a meta (estoque ideal) 15 → 18 não é "entrou" nem muda o estoque — só o "repor";
 *     a quantidade do cadastro é o começo do dia, não "Entrou no estoque";
 *  3) cor arquivada não entra no relatório do WhatsApp (Entrou / Repor / Estoque).
 * Também roda com os dados reais do celular: DADOS_REAIS=caminho/do/arquivo.json npm test
 */
import { describe, expect, it, vi } from 'vitest';
import { AppDB, db, useDatabase } from '../db/db';
import { seedIfNeeded } from '../db/seed';
import { uid } from '../lib/util';
import { migrateCadastroEntries, moveStock, startDay } from '../services/days';
import { archiveVariant, createGroup, createVariant, deleteVariant, updateVariant } from '../services/catalog';
import { createOrder, createReservation } from '../services/sales';
import { daySummary, loadStockRows } from '../services/summary';
import { openWhatsApp, whatsappReport, WHATSAPP_URL_MAX } from '../services/report';
import { runDiagnostics } from '../services/diagnostics';
import { restoreBackup } from '../services/backup';

async function setup(name: string) {
  useDatabase(new AppDB(`${name}-${Math.random()}`));
  await seedIfNeeded();
  await db.settings.where('key').equals('initialOpening').delete();
  return startDay('2026-11-02');
}
const erros = async () => (await runDiagnostics()).findings.filter((f) => f.level === 'erro');
const entrouSection = (w: string) => { const i = w.indexOf('📦 *Entrou'); return i < 0 ? '' : w.slice(i, w.indexOf('\n\n', i) < 0 ? undefined : w.indexOf('\n\n', i)); };

describe('cadastro: quantidade inicial e meta do repor', () => {
  it('cor nova com 15 peças: começa o dia com 15, não aparece em "Entrou"', async () => {
    const d = await setup('cad1');
    const g = await createGroup({ name: 'Extra' });
    const v = await createVariant({ groupId: g.id, name: 'Rojo', startQuantity: 15, dailyRecordId: d.id });
    const it = (await db.dailyStockItems.where('[dailyRecordId+variantId]').equals([d.id, v.id]).first())!;
    expect([it.initialQuantity, it.currentQuantity]).toEqual([15, 15]);
    expect(await db.stockMovements.where('variantId').equals(v.id).count()).toBe(0);
    const s = await daySummary(d.id, d.date);
    expect(s.enteredUnits).toBe(0);
    expect(entrouSection(whatsappReport(d.date, s))).not.toContain('Rojo');
    expect(await erros()).toEqual([]);
  });
  it('meta 15 → 18: o estoque continua 15, nada "entrou", só repor 3', async () => {
    const d = await setup('cad2');
    const g = await createGroup({ name: 'Extra' });
    const v = await createVariant({ groupId: g.id, name: 'Rojo', startQuantity: 15, dailyRecordId: d.id });
    await updateVariant(v.id, { idealStock: 18 });
    const row = (await loadStockRows(d.id, d.date)).find((r) => r.variant.id === v.id)!;
    expect([row.item.currentQuantity, row.restock]).toEqual([15, 3]);
    const s = await daySummary(d.id, d.date);
    expect([s.enteredUnits, await db.stockMovements.where('variantId').equals(v.id).count()]).toEqual([0, 0]);
    expect(whatsappReport(d.date, s)).toContain('   • Cor Rojo: 3\n'); // em "Precisa repor": só o número
    expect(whatsappReport(d.date, s)).not.toMatch(/\(tem \d+ de \d+\)/);
    // chave ligada: mostra “(tem X de Y)” só no repor
    expect(whatsappReport(d.date, s, { restockDetail: true })).toContain('Cor Rojo: 3 (tem 15 de 18)');
  });
  it('entrada de verdade (+) continua aparecendo em "Entrou"', async () => {
    const d = await setup('cad3');
    const v = (await db.variants.toArray()).find((x) => !x.archivedAt)!;
    await moveStock(d.id, v.id, 4, 'entrada');
    const s = await daySummary(d.id, d.date);
    expect(s.enteredUnits).toBe(4);
    expect(entrouSection(whatsappReport(d.date, s))).toContain(`${v.name}: +4`);
  });
});

describe('arquivadas e excluídas fora do relatório', () => {
  it('cor arquivada não entra em Entrou, Repor nem no total do estoque', async () => {
    const d = await setup('arq1');
    const g = await createGroup({ name: 'Extra' });
    const a = await createVariant({ groupId: g.id, name: 'Velha', startQuantity: 10, dailyRecordId: d.id });
    await updateVariant(a.id, { idealStock: 20 });
    await moveStock(d.id, a.id, 5, 'entrada');
    const before = await daySummary(d.id, d.date);
    await archiveVariant(a.id, true);
    const s = await daySummary(d.id, d.date);
    expect(s.enteredUnits).toBe(before.enteredUnits - 5);
    expect(s.totalUnits).toBe(before.totalUnits - 15);
    const w = whatsappReport(d.date, s);
    expect(w).not.toContain('Velha');
    expect(await erros()).toEqual([]);
  });
  it('excluir: nunca vendida → some de vez; vendida → some de tudo, venda antiga fica no histórico', async () => {
    const d = await setup('exc1');
    const g = await createGroup({ name: 'Extra' });
    const nunca = await createVariant({ groupId: g.id, name: 'Nunca', startQuantity: 3, dailyRecordId: d.id });
    const vendida = await createVariant({ groupId: g.id, name: 'Vendida', startQuantity: 3, dailyRecordId: d.id });
    await moveStock(d.id, nunca.id, 2, 'entrada');
    const o = await createOrder({ orderId: uid(), dailyRecordId: d.id, paymentMethod: 'pix', lines: [{ variantId: vendida.id, quantity: 1, unitPriceInCents: 7000 }] });
    await archiveVariant(nunca.id, true); await archiveVariant(vendida.id, true);
    expect(await deleteVariant(nunca.id)).toBe('apagada');
    expect(await db.variants.get(nunca.id)).toBeUndefined();
    expect(await db.stockMovements.where('variantId').equals(nunca.id).count()).toBe(0);
    expect(await deleteVariant(vendida.id)).toBe('escondida');
    expect((await db.variants.get(vendida.id))!.deletedAt).toBeTruthy();
    await expect(archiveVariant(vendida.id, false)).rejects.toThrow(/excluída/);
    // a venda continua: caixa e "o que saiu" certos
    expect((await db.orders.get(o.id))!.status).toBe('ok');
    const s = await daySummary(d.id, d.date);
    expect(s.cash.salesByMethod.pix).toBe(7000);
    const w = whatsappReport(d.date, s);
    expect(entrouSection(w)).not.toContain('Nunca');
    expect(w).not.toContain('Nunca');
    expect(await erros()).toEqual([]);
  });
});

/** Lê a seção "Estoque agora" da mensagem: { 'Grupo Cor': quantidade } e as notas. */
function stockSection(w: string) {
  const i = w.indexOf('📦 *Estoque agora');
  if (i < 0) return null;
  const out: Record<string, { qty: number; start?: number; note: string }> = {};
  let group = '';
  for (const line of w.slice(i).split('\n').slice(1)) {
    const g = line.match(/^\S+ \*(.+)\*$/);
    if (g) { group = g[1]; continue; }
    const m = line.match(/^ {3}• Cor (.+?): (?:começou (\d+) → terminou )?(\d+)(.*)$/);
    if (m) out[`${group} ${m[1]}`] = { qty: Number(m[3]), start: m[2] === undefined ? undefined : Number(m[2]), note: m[4].trim() };
  }
  return out;
}

describe('mensagem com o estoque de agora (configurável)', () => {
  it('ligado: lista cada cor ativa com a quantidade exata; repor/esgotado ao lado; arquivada fora', async () => {
    const d = await setup('estq1');
    const vs = (await db.variants.toArray()).filter((v) => !v.archivedAt);
    // vende tudo de uma cor (esgota) e uma de outra (repor 1)
    const sell = vs.filter((v) => v.forSale !== false); // só dá para vender o que está à venda
    const a = sell.find((v) => v.startQuantity === 2)!, b = sell.find((v) => v.startQuantity >= 5 && v.id !== a.id)!;
    await createOrder({ orderId: uid(), dailyRecordId: d.id, paymentMethod: 'pix', lines: [{ variantId: a.id, quantity: 2, unitPriceInCents: 7000 }, { variantId: b.id, quantity: 1, unitPriceInCents: 7000 }] });
    const arch = vs.find((v) => v.id !== a.id && v.id !== b.id && v.startQuantity > 0)!;
    await archiveVariant(arch.id, true);
    const s = await daySummary(d.id, d.date);
    const w = whatsappReport(d.date, s, { showStock: true });
    const st = stockSection(w)!;
    const groups = new Map((await db.groups.toArray()).map((g) => [g.id, g.name]));
    const rows = (await loadStockRows(d.id, d.date)).filter((r) => !r.variant.archivedAt && !r.group.archivedAt);
    // exatamente o que tem no estoque: mesmas cores, mesmas quantidades, mesmo total
    expect(Object.keys(st).length).toBe(rows.length);
    for (const r of rows) expect(st[`${groups.get(r.variant.groupId)} ${r.variant.name}`]?.qty, r.variant.name).toBe(r.item.currentQuantity);
    expect(Object.values(st).reduce((n, x) => n + x.qty, 0)).toBe(s.totalUnits);
    expect(w).toContain(`📦 *Estoque agora (${s.totalUnits} peças)*`);
    expect(st[`${groups.get(a.groupId)} ${a.name}`].note).toBe('🚫 esgotado');
    expect(st[`${groups.get(b.groupId)} ${b.name}`].note).toBe('⚠️ repor 1');
    expect(st[`${groups.get(arch.groupId)} ${arch.name}`]).toBeUndefined(); // nome exato (Broche ≠ Broche Médio)
    // começo → fim do dia (ligado por padrão no app; aqui pela opção)
    const se = stockSection(whatsappReport(d.date, s, { showStock: true, stockStartEnd: true }))!;
    for (const r of rows) expect(se[`${groups.get(r.variant.groupId)} ${r.variant.name}`]).toMatchObject({ start: r.item.initialQuantity, qty: r.item.currentQuantity });
    expect(whatsappReport(d.date, s, { showStock: true, stockStartEnd: true })).toContain(`Cor ${a.name}: começou 2 → terminou 0 🚫 esgotado`);
    // a parte "Precisa repor" continua
    expect(w).toContain('🔁 *Precisa repor');
  });
  it('desligado: só o total, sem a lista', async () => {
    const d = await setup('estq2');
    const s = await daySummary(d.id, d.date);
    const w = whatsappReport(d.date, s, { showStock: false });
    expect(stockSection(w)).toBeNull();
    expect(w).toContain(`📊 Estoque no fim do dia: *${s.totalUnits} peças*`);
    expect((await (await import('../services/settings')).getSetting('reportShowStock'))).toBe(true); // padrão: mostra
  });
});

describe('reserva no estoque da mensagem (bug Plomo Azul 02/11)', () => {
  it('começou 3, vendeu 1, 2 reservadas: “começou 3 → terminou 2 🔒 2 reservadas”, não “esgotado”', async () => {
    const d = await setup('res1');
    const g = await createGroup({ name: 'Teste Res' });
    const v = await createVariant({ groupId: g.id, name: 'Azul', startQuantity: 3, idealStock: 2, dailyRecordId: d.id });
    await createOrder({ orderId: uid(), dailyRecordId: d.id, paymentMethod: 'pix', lines: [{ variantId: v.id, quantity: 1, unitPriceInCents: 7000 }] });
    await createReservation({ dailyRecordId: d.id, variantId: v.id, quantity: 2, customer: 'Kelly' });
    const s = await daySummary(d.id, d.date);
    const w = whatsappReport(d.date, s, { showStock: true, stockStartEnd: true });
    expect(w).toContain('Cor Azul: começou 3 → terminou 2 🔒 2 reservadas');
    expect(stockSection(w)!['Teste Res Azul']).toEqual({ start: 3, qty: 2, note: '🔒 2 reservadas' }); // não “esgotado”
    expect(whatsappReport(d.date, s, { showStock: true })).toContain('Cor Azul: 2 🔒 2 reservadas');
    // não entra em “Esgotados” (o grupo de teste nem aparece lá)
    const esg = w.indexOf('🚫 *Esgotados');
    if (esg >= 0) expect(w.slice(esg, w.indexOf('\n\n', esg))).not.toContain('Teste Res');
  });
});

describe('repor configurado em cada produto', () => {
  it('"Precisa repor?" desligado: nunca aparece em repor (Estoque nem WhatsApp)', async () => {
    const d = await setup('rep1');
    const g = await createGroup({ name: 'Extra' });
    const v = await createVariant({ groupId: g.id, name: 'Unica', startQuantity: 5, dailyRecordId: d.id });
    await updateVariant(v.id, { idealStock: 10 });
    let row = (await loadStockRows(d.id, d.date)).find((r) => r.variant.id === v.id)!;
    expect(row.restock).toBe(5);
    await updateVariant(v.id, { restockOff: true });
    row = (await loadStockRows(d.id, d.date)).find((r) => r.variant.id === v.id)!;
    expect(row.restock).toBe(0);
    const s = await daySummary(d.id, d.date);
    expect(s.restock.some((r) => r.variant.id === v.id)).toBe(false);
    const w = whatsappReport(d.date, s, { showStock: true });
    expect(w).toMatch(/^ {3}• Cor Unica: 5$/m); // no estoque, sem aviso (última linha da mensagem)
    expect(w).not.toContain('Cor Unica: 5 ⚠️');
  });
  it('estoque mínimo 3 (meta 10): com 5 não repõe; com 3 repõe 7; esgotado repõe 10', async () => {
    const d = await setup('rep2');
    const g = await createGroup({ name: 'Extra' });
    const v = await createVariant({ groupId: g.id, name: 'Minima', startQuantity: 5, dailyRecordId: d.id });
    await updateVariant(v.id, { idealStock: 10, minimumStock: 3 });
    const at = async () => (await loadStockRows(d.id, d.date)).find((r) => r.variant.id === v.id)!;
    expect((await at()).restock).toBe(0);
    let w = whatsappReport(d.date, await daySummary(d.id, d.date), { showStock: true });
    expect(w).not.toContain('Cor Minima: 5 ⚠️');
    await moveStock(d.id, v.id, -2, 'saida');
    expect((await at()).restock).toBe(7);
    w = whatsappReport(d.date, await daySummary(d.id, d.date), { showStock: true });
    expect(w).toContain('   • Cor Minima: 7\n'); // em "Precisa repor"
    expect(w).toContain('Cor Minima: 3 ⚠️ repor 7'); // no estoque
    await moveStock(d.id, v.id, -3, 'saida');
    expect((await at()).restock).toBe(10);
    await expect(updateVariant(v.id, { minimumStock: -1 })).rejects.toThrow(/mínimo inválido/);
    expect(await erros()).toEqual([]);
  });
});

describe('dados antigos: "entrou" do cadastro vira começo do dia', () => {
  it('converte uma vez; o estoque final não muda; rodar de novo não faz nada', async () => {
    const d = await setup('mig1');
    const v = (await db.variants.toArray())[0];
    const it = (await db.dailyStockItems.where('[dailyRecordId+variantId]').equals([d.id, v.id]).first())!;
    // como a versão antiga gravava: começou 0 + entrada "Quantidade inicial do cadastro"
    await db.dailyStockItems.update(it.id, { initialQuantity: 0, currentQuantity: it.currentQuantity + 9 });
    await db.stockMovements.add({ id: uid(), dailyRecordId: d.id, variantId: v.id, type: 'entrada', quantity: it.initialQuantity + 9,
      previousBalance: 0, newBalance: it.currentQuantity + 9, createdAt: new Date().toISOString(), description: 'Quantidade inicial do cadastro' });
    const finalBefore = (await db.dailyStockItems.get(it.id))!.currentQuantity;
    expect((await daySummary(d.id, d.date)).enteredUnits).toBe(0); // o relatório já ignora
    expect(await migrateCadastroEntries()).toBe(1);
    const after = (await db.dailyStockItems.get(it.id))!;
    expect([after.initialQuantity, after.currentQuantity]).toEqual([finalBefore, finalBefore]);
    expect(await migrateCadastroEntries()).toBe(0);
    expect(await erros()).toEqual([]);
  });
});

describe('WhatsApp com mensagem grande não trava', () => {
  it('curta: abre o WhatsApp; comprida: compartilhar do celular; sem compartilhar: copia', async () => {
    const open = vi.fn();
    vi.stubGlobal('window', { open });
    vi.stubGlobal('navigator', { share: vi.fn().mockResolvedValue(undefined), clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    expect(await openWhatsApp('oi')).toBe('whatsapp');
    expect(open).toHaveBeenCalledTimes(1);
    const big = 'linha de relatório com acento ção\n'.repeat(400);
    expect(`https://wa.me/?text=${encodeURIComponent(big)}`.length).toBeGreaterThan(WHATSAPP_URL_MAX);
    expect(await openWhatsApp(big)).toBe('shared');
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    expect(await openWhatsApp(big)).toBe('copied');
    expect(open).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});

// ---- com os dados reais do celular (opcional: só roda com DADOS_REAIS=arquivo.json) ----
const REAL = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.DADOS_REAIS;
describe.skipIf(!REAL)('dados reais do celular (02/11)', () => {
  it('relatório sem arquivadas, sem o "entrou" do cadastro; excluir as arquivadas deixa tudo certo', async () => {
    // @ts-expect-error módulo do Node sem tipos (só neste teste)
    const { readFileSync } = await import('node:fs');
    useDatabase(new AppDB(`real-${Math.random()}`));
    await restoreBackup(JSON.parse(readFileSync(REAL!, 'utf8')), { keepSafety: false });
    const day = (await db.dailyRecords.orderBy('date').last())!;
    const before = await daySummary(day.id, day.date);
    const archived = (await db.variants.toArray()).filter((v) => v.archivedAt);
    const archivedIds = new Set(archived.map((v) => v.id));
    // relatório: nenhuma arquivada em "Entrou", e "Entrou" só com entradas de verdade
    expect(before.enteredByVariant.some((x) => archivedIds.has(x.variant.id))).toBe(false);
    const realEntradas = (await db.stockMovements.where('dailyRecordId').equals(day.id).toArray())
      .filter((m) => m.type === 'entrada' && m.description !== 'Quantidade inicial do cadastro' && !archivedIds.has(m.variantId));
    expect(before.enteredUnits).toBe(realEntradas.reduce((n, m) => n + m.quantity, 0));
    // total do estoque = só cores ativas
    const rows = await loadStockRows(day.id, day.date);
    expect(before.totalUnits).toBe(rows.filter((r) => !r.variant.archivedAt && !r.group.archivedAt).reduce((n, r) => n + r.item.currentQuantity, 0));
    const finalStock = rows.map((r) => [r.variant.id, r.item.currentQuantity]);
    // conserta os dados antigos: estoque final igual, diagnóstico sem erro
    const fixed = await migrateCadastroEntries();
    console.log(`dados reais: ${archived.length} arquivadas · ${fixed} cadastros convertidos · entrou de verdade ${before.enteredUnits} · estoque ativo ${before.totalUnits}`);
    const rows2 = await loadStockRows(day.id, day.date);
    expect(rows2.map((r) => [r.variant.id, r.item.currentQuantity])).toEqual(finalStock);
    expect(await erros()).toEqual([]);
    // excluir todas as arquivadas
    let apagadas = 0, escondidas = 0;
    for (const v of archived) (await deleteVariant(v.id)) === 'apagada' ? apagadas++ : escondidas++;
    const after = await daySummary(day.id, day.date);
    const w = whatsappReport(day.date, after);
    for (const v of archived) expect(entrouSection(w), `arquivada ${v.name} no relatório`).not.toMatch(new RegExp(`Cor ${v.name}: \\+`));
    expect(after.totalUnits).toBe(before.totalUnits);
    expect(after.cash.accumulated).toBe(before.cash.accumulated); // dinheiro não muda
    // estoque de agora na mensagem = exatamente o que tem
    const ws = whatsappReport(day.date, after, { showStock: true });
    const st = stockSection(ws)!;
    expect(Object.values(st).reduce((n, x) => n + x.qty, 0)).toBe(after.totalUnits);
    expect(Object.keys(st).length).toBe(after.stockNow.length);
    // o número de esgotados do Início = “Esgotados (N)” da mensagem = marcas “esgotado” na lista
    const homeOut = after.restock.filter((r) => r.out).length;
    const msgOut = Number(ws.match(/🚫 \*Esgotados \((\d+)\)\*/)?.[1] ?? 0);
    expect(msgOut, 'esgotados: Início x mensagem').toBe(homeOut);
    expect(Object.values(st).filter((x) => x.note.includes('esgotado')).length).toBe(homeOut);
    console.log(`dados reais: esgotados ${homeOut} no Início = ${msgOut} na mensagem`);
    // “esgotado” só ao lado de 0 peças; começo → fim bate com o dia
    for (const [k, x] of Object.entries(st)) expect(x.note.includes('esgotado'), `${k}: ${x.qty} ${x.note}`).toBe(x.qty === 0);
    const se = stockSection(whatsappReport(day.date, after, { showStock: true, stockStartEnd: true }))!;
    for (const r of after.stockNow) expect(se[`${r.group.name} ${r.variant.name}`], r.variant.name).toMatchObject({ start: r.item.initialQuantity, qty: r.item.currentQuantity });
    console.log('dados reais: ' + ws.split('\n').filter((l) => /reservad/.test(l)).join(' | '));
    console.log(`dados reais: estoque na mensagem ${Object.keys(st).length} cores · ${after.totalUnits} peças · ${Object.values(st).filter((x) => x.note).length} com aviso · mensagem ${ws.length} letras`);
    expect(await erros()).toEqual([]);
    console.log(`dados reais: excluídas ${apagadas} de vez + ${escondidas} com vendas (histórico mantido) · mensagem ${w.length} letras`);
  });
});
