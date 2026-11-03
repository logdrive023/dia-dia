/**
 * A conta do estoque na mensagem do WhatsApp bate do começo ao fim:
 * começou 15, vendeu 3 → “O que saiu 3”, “começou 15 → terminou 12”, repor 3, totais −3,
 * e os mesmos números do Início. Também com cancelar, entrada, ajuste e reserva.
 */
import { describe, expect, it } from 'vitest';
import { AppDB, db, useDatabase } from '../db/db';
import { seedIfNeeded } from '../db/seed';
import { uid } from '../lib/util';
import { moveStock, startDay } from '../services/days';
import { createGroup, createVariant } from '../services/catalog';
import { cancelOrder, createOrder, createReservation } from '../services/sales';
import { daySummary } from '../services/summary';
import { whatsappReport } from '../services/report';
import { runDiagnostics } from '../services/diagnostics';

async function setup() {
  useDatabase(new AppDB(`conta-${Math.random()}`));
  await seedIfNeeded();
  await db.settings.where('key').equals('initialOpening').delete();
  const d = await startDay('2026-11-02');
  const g = await createGroup({ name: 'Conta' });
  const v = await createVariant({ groupId: g.id, name: 'Azul', startQuantity: 15, dailyRecordId: d.id });
  return { d, v };
}
const sell = (dayId: string, variantId: string, quantity: number) =>
  createOrder({ orderId: uid(), dailyRecordId: dayId, paymentMethod: 'pix', lines: [{ variantId, quantity, unitPriceInCents: 7000 }] });
/** o pedaço da seção da mensagem que fala do grupo “Conta” */
function groupLines(w: string, section: string) {
  const i = w.indexOf(section);
  if (i < 0) return [];
  const end = w.indexOf('\n\n', i);
  const sec = w.slice(i, end < 0 ? undefined : end).split('\n');
  const g = sec.findIndex((l) => l.endsWith('*Conta*'));
  if (g < 0) return [];
  const out: string[] = [];
  for (const l of sec.slice(g + 1)) { if (!l.startsWith('   • ')) break; out.push(l.trim()); }
  return out;
}
const opts = { showStock: true, stockStartEnd: true, totals: true, dividers: true };

describe('começou 15, vendeu 3', () => {
  it('cada parte da mensagem diz a mesma coisa', async () => {
    const { d, v } = await setup();
    const before = await daySummary(d.id, d.date);
    await sell(d.id, v.id, 3);
    const s = await daySummary(d.id, d.date);
    const w = whatsappReport(d.date, s, opts);
    expect(groupLines(w, '🛍️ *O que saiu')).toEqual(['• Cor Azul: 3']);
    expect(groupLines(w, '🔁 *Precisa repor')).toEqual(['• Cor Azul: 3']);
    expect(groupLines(w, '📦 *Estoque agora')).toEqual(['• Cor Azul: começou 15 → terminou 12 ⚠️ repor 3']);
    expect(groupLines(whatsappReport(d.date, s, { ...opts, stockStartEnd: false }), '📦 *Estoque agora')).toEqual(['• Cor Azul: 12 ⚠️ repor 3']);
    // totais: o dia todo mudou −3; o estoque é o de antes − 3
    expect(s.totalUnits).toBe(before.totalUnits - 3);
    expect(s.initialUnits).toBe(before.initialUnits);
    expect(w).toContain(`📦 Total no estoque: *${s.totalUnits} peças*`);
    expect(w).toContain(`🌅 Começo do dia ${s.initialUnits} → 🌙 final ${s.totalUnits} = *−3*`);
    expect(w).toContain('O que saiu (3 peças)');
    expect(w).toContain(`📦 *Estoque agora (${s.totalUnits} peças)*`);
    // começo − o que saiu = final
    expect(s.initialUnits - s.soldUnits).toBe(s.totalUnits);
    expect((await runDiagnostics()).findings.filter((f) => f.level === 'erro')).toEqual([]);
  });

  it('cancelar a venda volta tudo: terminou 15, sem repor, saiu 0', async () => {
    const { d, v } = await setup();
    const o = await sell(d.id, v.id, 3);
    await cancelOrder(typeof o === 'string' ? o : (o as { id: string }).id);
    const s = await daySummary(d.id, d.date);
    const w = whatsappReport(d.date, s, opts);
    expect(groupLines(w, '📦 *Estoque agora')).toEqual(['• Cor Azul: começou 15 → terminou 15']);
    expect(groupLines(w, '🛍️ *O que saiu')).toEqual([]);
    expect(groupLines(w, '🔁 *Precisa repor')).toEqual([]);
    expect(s.initialUnits - s.soldUnits).toBe(s.totalUnits);
  });

  it('vende 3, entram 2, ajuste −1: começou 15 → terminou 13; a conta fecha com entrou e ajuste', async () => {
    const { d, v } = await setup();
    await sell(d.id, v.id, 3);
    await moveStock(d.id, v.id, 2, 'entrada');
    await moveStock(d.id, v.id, -1, 'ajuste');
    const s = await daySummary(d.id, d.date);
    const w = whatsappReport(d.date, s, opts);
    expect(groupLines(w, '📦 *Estoque agora')).toEqual(['• Cor Azul: começou 15 → terminou 13 ⚠️ repor 2']);
    expect(groupLines(w, '📦 *Entrou no estoque')).toEqual(['• Cor Azul: +2']);
    expect(groupLines(w, '🛍️ *O que saiu')).toEqual(['• Cor Azul: 3']);
    expect(s.initialUnits - s.soldUnits + s.enteredUnits + s.adjustUnits).toBe(s.totalUnits);
  });

  it('vende 3 e reserva 2: ainda tem 12 no estoque (2 guardadas), não some da conta', async () => {
    const { d, v } = await setup();
    await sell(d.id, v.id, 3);
    await createReservation({ dailyRecordId: d.id, variantId: v.id, quantity: 2, customer: 'Ana' });
    const s = await daySummary(d.id, d.date);
    const w = whatsappReport(d.date, s, opts);
    expect(groupLines(w, '📦 *Estoque agora')).toEqual(['• Cor Azul: começou 15 → terminou 12 🔒 2 reservadas ⚠️ repor 3']);
    expect(s.initialUnits - s.soldUnits).toBe(s.totalUnits);
  });

  it('dia seguinte começa com o que terminou ontem (12)', async () => {
    const { d, v } = await setup();
    await sell(d.id, v.id, 3);
    const d2 = await startDay('2026-11-03');
    const w = whatsappReport(d2.date, await daySummary(d2.id, d2.date), opts);
    expect(groupLines(w, '📦 *Estoque agora')).toEqual(['• Cor Azul: começou 12 → terminou 12 ⚠️ repor 3']);
  });
});

// ---- dados reais (opcional: DADOS_REAIS=arquivo.json) ----
const REAL = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.DADOS_REAIS;
describe.skipIf(!REAL)('dados reais: a conta fecha cor por cor', () => {
  it('começou − vendeu + entrou ± ajuste = terminou, em cada cor e no total da mensagem', async () => {
    // @ts-expect-error módulo do Node sem tipos (só neste teste)
    const { readFileSync } = await import('node:fs');
    const { restoreBackup } = await import('../services/backup');
    const { migrateCadastroEntries } = await import('../services/days');
    const { effectiveMovements } = await import('../services/summary');
    useDatabase(new AppDB(`conta-real-${Math.random()}`));
    await restoreBackup(JSON.parse(readFileSync(REAL!, 'utf8')), { keepSafety: false });
    await migrateCadastroEntries();
    const day = (await db.dailyRecords.orderBy('date').last())!;
    const s = await daySummary(day.id, day.date);
    const moves = effectiveMovements(await db.stockMovements.where('dailyRecordId').equals(day.id).toArray());
    const sold = new Map(s.soldByVariant.map((x) => [x.variant.id, x.qty]));
    const bad: string[] = [];
    for (const r of s.stockNow) {
      const mv = moves.filter((m) => m.variantId === r.variant.id).reduce((n, m) => n + m.quantity, 0);
      if (r.item.initialQuantity + mv !== r.item.currentQuantity) bad.push(`${r.group.name} ${r.variant.name}: ${r.item.initialQuantity} + ${mv} ≠ ${r.item.currentQuantity}`);
      // o que a mensagem diz que saiu dessa cor é o que saiu de verdade do estoque
      // (venda cancelada: “venda −1” e depois “cancelamento +1”, a peça volta e não conta como saída)
      const outOfStock = -moves.filter((m) => m.variantId === r.variant.id && (m.type === 'venda' || m.type === 'cancelamento')).reduce((n, m) => n + m.quantity, 0);
      if ((sold.get(r.variant.id) ?? 0) !== outOfStock) bad.push(`${r.group.name} ${r.variant.name}: saiu ${sold.get(r.variant.id) ?? 0} na mensagem, ${outOfStock} no estoque`);
    }
    console.log('dados reais: DIFERENÇAS\n' + bad.join('\n'));
    expect(bad).toEqual([]);
    const colorSold = s.soldByVariant.reduce((n, x) => n + x.qty, 0);
    const byType = (t: string) => moves.filter((m) => m.type === t).reduce((n, m) => n + m.quantity, 0);
    console.log(`dados reais: começou ${s.initialUnits} · saiu ${s.soldUnits} (com cor ${colorSold}, do caderno sem cor ${s.cash.notebookUnits}) · entrou ${s.enteredUnits} · ajustes ${s.adjustUnits} · terminou ${s.totalUnits}`);
    console.log(`dados reais: movimentos do dia por tipo: ${[...new Set(moves.map((m) => m.type))].map((t) => `${t} ${byType(t)}`).join(' · ')}`);
    console.log(`dados reais: começou − terminou = ${s.initialUnits - s.totalUnits}`);
  });
});
