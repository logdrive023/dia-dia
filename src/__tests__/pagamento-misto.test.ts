/**
 * Venda com formas de pagamento misturadas (uma peça no Pix, outra no dinheiro).
 * Backtest: milhares de vendas aleatórias — tudo numa forma só ou cada peça com a sua —,
 * com correção de preço, cancelamento e troca de peça. O caixa tem que bater forma por forma com um modelo simples.
 */
import { describe, expect, it } from 'vitest';
import { AppDB, db, useDatabase } from '../db/db';
import { seedIfNeeded } from '../db/seed';
import type { PaymentMethod } from '../db/types';
import { uid } from '../lib/util';
import { startDay } from '../services/days';
import { cancelOrder, correctOrderPrices, createOrder, swapSaleItem, type CartLine } from '../services/sales';
import { UserError } from '../services/catalog';
import { computeCash, daySummary } from '../services/summary';
import { runDiagnostics } from '../services/diagnostics';
import { orderLine, whatsappReport } from '../services/report';

function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const TOTAL = Number((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.MISTO ?? 300);
const METHODS: PaymentMethod[] = ['dinheiro', 'pix', 'cartao', 'debito'];

async function setup(name: string) {
  useDatabase(new AppDB(`${name}-${Math.random()}`));
  await seedIfNeeded();
  await db.variants.toCollection().modify({ forSale: true });
  await db.settings.where('key').equals('initialOpening').delete();
  const d = await startDay('2026-11-04');
  for (const i of await db.dailyStockItems.where('dailyRecordId').equals(d.id).toArray())
    await db.dailyStockItems.update(i.id, { initialQuantity: 500, currentQuantity: 500 });
  return d;
}

describe('pagamento por peça', () => {
  it('exemplo: Branco no Pix + Verde no dinheiro → caixa separa; tudo numa forma só → um pagamento', async () => {
    const d = await setup('misto-ex');
    const [a, b] = (await db.variants.toArray()).slice(0, 2);
    const o = await createOrder({ orderId: uid(), dailyRecordId: d.id, paymentMethod: 'dinheiro', lines: [
      { variantId: a.id, quantity: 1, unitPriceInCents: 7000, paymentMethod: 'pix' },
      { variantId: b.id, quantity: 1, unitPriceInCents: 8500, paymentMethod: 'dinheiro' },
    ] });
    expect(o.payByLine).toBe(true);
    expect(o.payments?.map((p) => [p.method, p.amountInCents]).sort()).toEqual([['dinheiro', 8500], ['pix', 7000]]);
    let c = await computeCash(d.id);
    expect([c.salesByMethod.pix, c.salesByMethod.dinheiro, c.cashOnHand]).toEqual([7000, 8500, 8500]);
    const sales = await db.sales.where('orderId').equals(o.id).toArray();
    expect(orderLine(sales, o.totalInCents, o.paymentMethod)).toMatch(/1x70 Pix \+ 1x85 Dinheiro = 155|1x85 Dinheiro \+ 1x70 Pix = 155/);
    const w = whatsappReport(d.date, await daySummary(d.id, d.date));
    expect(w).toContain('➕ Vendas: 155 (💵 85 · ⚡ 70 · 💳 0 · 🏧 0)');
    // corrigir o preço da peça do Pix: a diferença entra no Pix, o dinheiro não muda
    await correctOrderPrices(o.id, { [sales.find((s) => s.paymentMethod === 'pix')!.id]: 9000 });
    c = await computeCash(d.id);
    expect([c.salesByMethod.pix, c.salesByMethod.dinheiro]).toEqual([9000, 8500]);
    // cancelar: cada forma volta a 0
    await cancelOrder(o.id);
    c = await computeCash(d.id);
    expect([c.salesByMethod.pix, c.salesByMethod.dinheiro, c.salesTotal]).toEqual([0, 0, 0]);
    // várias peças, tudo numa forma só: um pagamento só
    const o2 = await createOrder({ orderId: uid(), dailyRecordId: d.id, paymentMethod: 'pix', lines: [
      { variantId: a.id, quantity: 2, unitPriceInCents: 7000 }, { variantId: b.id, quantity: 1, unitPriceInCents: 7000 },
    ] });
    expect([o2.payByLine, o2.payments, (await db.cashMovements.where('relatedOrderId').equals(o2.id).count())]).toEqual([undefined, undefined, 1]);
    // todas as peças marcadas com a mesma forma também viram um pagamento só
    const o3 = await createOrder({ orderId: uid(), dailyRecordId: d.id, paymentMethod: 'pix', lines: [
      { variantId: a.id, quantity: 1, unitPriceInCents: 7000, paymentMethod: 'pix' }, { variantId: b.id, quantity: 1, unitPriceInCents: 7000, paymentMethod: 'pix' },
    ] });
    expect([o3.payByLine, (await db.cashMovements.where('relatedOrderId').equals(o3.id).count())]).toEqual([undefined, 1]);
    await expect(createOrder({ orderId: uid(), dailyRecordId: d.id, paymentMethod: 'pix', lines: [
      { variantId: a.id, quantity: 1, unitPriceInCents: 7000, paymentMethod: 'cheque' as PaymentMethod },
    ] })).rejects.toThrow(UserError);
    expect((await runDiagnostics()).findings.filter((f) => f.level === 'erro')).toEqual([]);
  });

  it(`backtest: ${TOTAL} operações (vendas misturadas, correções, cancelamentos, trocas) — caixa bate por forma`, async () => {
    const d = await setup('misto-bt');
    const rand = rng(20261104);
    const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
    const variants = (await db.variants.toArray()).map((v) => v.id);
    const model: Record<PaymentMethod, number> = { dinheiro: 0, pix: 0, cartao: 0, debito: 0, outro: 0 };
    const live = new Set<string>();
    let mixed = 0, single = 0, fixes = 0, cancels = 0, swaps = 0;
    const check = async (where: string) => {
      const c = await computeCash(d.id);
      for (const m of METHODS) expect(c.salesByMethod[m], `${where}: ${m}`).toBe(model[m]);
    };
    const linesOf = async (orderId: string) => (await db.sales.where('orderId').equals(orderId).toArray()).filter((s) => s.status === 'ok');
    for (let step = 0; step < TOTAL; step++) {
      const r = rand();
      if (r < 0.55 || !live.size) {
        // venda: 1 a 4 linhas, às vezes sem preço; tudo numa forma ou cada peça com a sua
        const each = rand() < 0.6;
        const main = pick(METHODS);
        const lines: CartLine[] = Array.from({ length: 1 + Math.floor(rand() * 4) }, () => ({
          variantId: pick(variants), quantity: 1 + Math.floor(rand() * 3),
          unitPriceInCents: rand() < 0.1 ? null : 1000 + Math.floor(rand() * 20000),
          ...(each ? { paymentMethod: pick(METHODS) } : {}),
        }));
        const o = await createOrder({ orderId: uid(), dailyRecordId: d.id, paymentMethod: main, lines });
        for (const l of lines) model[l.paymentMethod ?? main] += (l.unitPriceInCents ?? 0) * l.quantity;
        live.add(o.id);
        if (o.payByLine) mixed++; else single++;
        // pagamento = soma das peças de cada forma; peças guardam a sua forma
        const pays = o.payments ?? (o.totalInCents ? [{ method: o.paymentMethod, amountInCents: o.totalInCents }] : []);
        expect(pays.reduce((s, p) => s + p.amountInCents, 0), `passo ${step}: pagamentos = total`).toBe(o.totalInCents);
      } else if (r < 0.75) {
        // corrigir o preço de algumas peças
        const id = pick([...live]);
        const ls = await linesOf(id);
        const prices: Record<string, number | null> = {};
        for (const l of ls) if (rand() < 0.6) prices[l.id] = rand() < 0.1 ? null : 500 + Math.floor(rand() * 30000);
        const o = (await db.orders.get(id))!;
        await correctOrderPrices(id, prices);
        if (o.payByLine) {
          for (const l of ls) if (l.id in prices) model[l.paymentMethod] += ((prices[l.id] ?? 0) - (l.unitPriceInCents ?? 0)) * l.quantity;
        } else {
          // tudo numa forma só: a diferença entra/sai na forma da venda (devolução tira primeiro dela)
          const before = (await computeCash(d.id)).salesByMethod;
          for (const m of METHODS) model[m] = before[m];
        }
        fixes++;
      } else if (r < 0.88) {
        const id = pick([...live]);
        const net = await db.cashMovements.where('relatedOrderId').equals(id).toArray();
        for (const m of net) model[m.paymentMethod] += m.type === 'venda' ? -m.amountInCents : m.type === 'estorno' ? m.amountInCents : 0;
        await cancelOrder(id);
        live.delete(id); cancels++;
      } else {
        // trocar a peça: o caixa não muda
        const id = pick([...live]);
        const l = pick(await linesOf(id));
        const to = pick(variants.filter((v) => v !== l.variantId));
        try { await swapSaleItem(l.id, to, 1 + Math.floor(rand() * l.quantity)); swaps++; }
        catch (e) { if (!(e instanceof UserError)) throw e; }
      }
      if (step % 50 === 0) await check(`passo ${step}`);
      if (step % 200 === 0) expect((await runDiagnostics()).findings.filter((f) => f.level === 'erro'), `passo ${step}: diagnóstico`).toEqual([]);
    }
    await check('fim');
    // cada venda: soma das peças por forma = o que está no caixa por forma
    for (const id of live) {
      const o = (await db.orders.get(id))!;
      if (!o.payByLine) continue;
      const want = new Map<PaymentMethod, number>();
      for (const l of await linesOf(id)) want.set(l.paymentMethod, (want.get(l.paymentMethod) ?? 0) + l.totalInCents);
      const got = new Map<PaymentMethod, number>();
      for (const m of await db.cashMovements.where('relatedOrderId').equals(id).toArray())
        got.set(m.paymentMethod, (got.get(m.paymentMethod) ?? 0) + (m.type === 'estorno' ? -m.amountInCents : m.amountInCents));
      for (const m of METHODS) expect(got.get(m) ?? 0, `venda ${id}: ${m}`).toBe(want.get(m) ?? 0);
    }
    expect((await runDiagnostics()).findings.filter((f) => f.level === 'erro')).toEqual([]);
    console.log(`pagamento misto: ${TOTAL} operações · ${mixed} vendas misturadas · ${single} numa forma só · ${fixes} correções · ${cancels} cancelamentos · ${swaps} trocas`);
    expect(mixed).toBeGreaterThan(0);
  }, 600_000);
});
