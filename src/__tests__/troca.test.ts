/**
 * Backtest da troca de peça vendida (vendeu Branco, era Vermelho): 10.000 trocas aleatórias.
 * Um "modelo" simples guarda quanto cada cor deveria ter; depois de cada troca o estoque do app
 * precisa bater cor por cor, as linhas da venda precisam somar o mesmo total e o caixa não muda.
 */
import { describe, expect, it } from 'vitest';
import { AppDB, db, useDatabase } from '../db/db';
import { seedIfNeeded } from '../db/seed';
import { uid } from '../lib/util';
import { startDay } from '../services/days';
import { cancelOrder, createOrder, createReservation, swapSaleItem } from '../services/sales';
import { UserError } from '../services/catalog';
import { computeCash } from '../services/summary';
import { runDiagnostics } from '../services/diagnostics';

function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const TOTAL = Number((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.TROCAS ?? 1000);

describe('troca de peça vendida', () => {
  it('exemplo: Branco 2 → vende 1 → era Vermelho: Vermelho 2 → 1 e Branco volta a 2', async () => {
    useDatabase(new AppDB(`troca-ex-${Math.random()}`));
    await seedIfNeeded();
    await db.variants.toCollection().modify({ forSale: true });
    await db.settings.where('key').equals('initialOpening').delete();
    const d = await startDay('2026-11-02');
    const plomo = (await db.groups.toArray()).find((g) => g.name === 'Lila')!;
    const vs = await db.variants.where('groupId').equals(plomo.id).toArray();
    const branco = vs.find((v) => v.name === 'Branco')!;
    const verde = vs.find((v) => v.name === 'Verde')!;
    const qty = async (id: string) => (await db.dailyStockItems.where('[dailyRecordId+variantId]').equals([d.id, id]).first())!.currentQuantity;
    const b0 = await qty(branco.id), v0 = await qty(verde.id);
    const o = await createOrder({ orderId: uid(), dailyRecordId: d.id, paymentMethod: 'pix', lines: [{ variantId: branco.id, quantity: 1, unitPriceInCents: 7000 }] });
    expect(await qty(branco.id)).toBe(b0 - 1);
    const sale = (await db.sales.where('orderId').equals(o.id).first())!;
    await swapSaleItem(sale.id, verde.id);
    expect([await qty(branco.id), await qty(verde.id)]).toEqual([b0, v0 - 1]);
    expect((await computeCash(d.id)).salesByMethod.pix).toBe(7000);
    // cancelar depois devolve a peça certa
    await cancelOrder(o.id);
    expect([await qty(branco.id), await qty(verde.id)]).toEqual([b0, v0]);
    // não troca para a mesma peça nem para uma sem estoque
    const o2 = await createOrder({ orderId: uid(), dailyRecordId: d.id, paymentMethod: 'pix', lines: [{ variantId: branco.id, quantity: 1, unitPriceInCents: 7000 }] });
    const s2 = (await db.sales.where('orderId').equals(o2.id).first())!;
    await expect(swapSaleItem(s2.id, branco.id)).rejects.toThrow(UserError);
    const zero = (await db.dailyStockItems.where('dailyRecordId').equals(d.id).toArray()).find((i) => i.currentQuantity === 0)!;
    await expect(swapSaleItem(s2.id, zero.variantId)).rejects.toThrow(UserError);
    expect((await runDiagnostics()).findings.filter((f) => f.level === 'erro')).toEqual([]);
  });

  it(`backtest: ${TOTAL} trocas aleatórias sem bug`, async () => {
    useDatabase(new AppDB(`troca-bt-${Math.random()}`));
    await seedIfNeeded();
    await db.variants.toCollection().modify({ forSale: true });
    await db.settings.where('key').equals('initialOpening').delete();
    const d = await startDay('2026-11-02');
    const rand = rng(20261031);
    const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
    const variants = (await db.variants.toArray()).map((v) => v.id);
    // estoque alto para as trocas não esbarrarem sempre em "sem estoque"
    for (const i of await db.dailyStockItems.where('dailyRecordId').equals(d.id).toArray())
      await db.dailyStockItems.update(i.id, { initialQuantity: 40, currentQuantity: 40 });
    const model = new Map(variants.map((v) => [v, 40]));
    // reservas: a troca não pode vender o que está reservado
    const reserved = new Map<string, number>();
    for (let i = 0; i < 5; i++) {
      const v = pick(variants), q = 1 + Math.floor(rand() * 3);
      await createReservation({ dailyRecordId: d.id, variantId: v, quantity: q, customer: `R${i}` });
      reserved.set(v, (reserved.get(v) ?? 0) + q);
    }
    let cashBefore = 0, ok = 0, refused = 0, orders = 0, cancels = 0;
    const check = async (where: string) => {
      const items = await db.dailyStockItems.where('dailyRecordId').equals(d.id).toArray();
      for (const i of items) expect(i.currentQuantity, `${where}: estoque de ${i.variantId}`).toBe(model.get(i.variantId));
    };
    for (let step = 0; step < TOTAL; step++) {
      const live = (await db.sales.where('dailyRecordId').equals(d.id).toArray()).filter((s) => s.status === 'ok');
      // de vez em quando: nova venda (1 a 3 linhas) ou cancelamento, para misturar com as trocas
      if (!live.length || rand() < 0.08) {
        const lines = Array.from({ length: 1 + Math.floor(rand() * 3) }, () => ({ variantId: pick(variants), quantity: 1 + Math.floor(rand() * 3), unitPriceInCents: 7000 }));
        try {
          await createOrder({ orderId: uid(), dailyRecordId: d.id, paymentMethod: pick(['dinheiro', 'pix', 'cartao', 'debito'] as const), lines });
          for (const l of lines) model.set(l.variantId, model.get(l.variantId)! - l.quantity);
          orders++;
        } catch (e) { expect(e).toBeInstanceOf(UserError); }
        continue;
      }
      if (rand() < 0.02) {
        const o = pick(live).orderId;
        for (const s of live.filter((x) => x.orderId === o)) model.set(s.variantId, model.get(s.variantId)! + s.quantity);
        await cancelOrder(o); cancels++;
        continue;
      }
      const s = pick(live);
      const to = pick(variants);
      const q = rand() < 0.7 ? s.quantity : 1 + Math.floor(rand() * s.quantity);
      const free = model.get(to)! - (reserved.get(to) ?? 0);
      if (step % 500 === 0) cashBefore = (await computeCash(d.id)).accumulated;
      const linesBefore = live.filter((x) => x.orderId === s.orderId).reduce((n, x) => n + x.quantity, 0);
      try {
        await swapSaleItem(s.id, to, q);
        // só pode dar certo se era válido
        expect(to !== s.variantId && q <= free, `troca aceita indevidamente no passo ${step}`).toBe(true);
        model.set(s.variantId, model.get(s.variantId)! + q);
        model.set(to, model.get(to)! - q);
        ok++;
        const after = (await db.sales.where('orderId').equals(s.orderId).toArray()).filter((x) => x.status === 'ok');
        expect(after.reduce((n, x) => n + x.quantity, 0), `passo ${step}: peças da venda`).toBe(linesBefore);
        expect(after.reduce((n, x) => n + x.totalInCents, 0), `passo ${step}: total da venda`).toBe((await db.orders.get(s.orderId))!.totalInCents);
      } catch (e) {
        if (!(e instanceof UserError)) throw e;
        // recusa só quando era inválido mesmo
        expect(to === s.variantId || q > free, `troca válida recusada no passo ${step}: ${(e as Error).message}`).toBe(true);
        refused++;
      }
      if (step % 500 === 0) {
        await check(`passo ${step}`);
        expect((await computeCash(d.id)).accumulated, `passo ${step}: caixa mudou com a troca`).toBe(cashBefore);
        expect((await runDiagnostics()).findings.filter((f) => f.level === 'erro'), `passo ${step}: diagnóstico`).toEqual([]);
      }
    }
    await check('fim');
    expect((await runDiagnostics()).findings.filter((f) => f.level === 'erro')).toEqual([]);
    console.log(`trocas: ${ok} feitas, ${refused} recusadas (inválidas), ${orders} vendas, ${cancels} cancelamentos`);
    expect(ok).toBeGreaterThan(TOTAL * 0.5);
  }, 1_800_000);
});
