/**
 * Recursos novos (condicional, contagem, mais vendidas/paradas/lucro, recibo, fiado, vale).
 * Regra de ouro de cada teste: o caixa, o estoque e o diagnóstico continuam batendo (nenhum erro).
 */
import { describe, expect, it } from 'vitest';
import { AppDB, db, useDatabase } from '../db/db';
import { seedIfNeeded } from '../db/seed';
import { uid } from '../lib/util';
import { moveStock, startDay } from '../services/days';
import { createGroup, createVariant, updateVariant } from '../services/catalog';
import {
  cancelOrder, cancelReservation, convertReservation, createOrder, createReservation, creditBalance, openFiado, owedOf,
  receiveFiado, returnSaleItem,
} from '../services/sales';
import { computeCash, loadStockRows } from '../services/summary';
import { runDiagnostics } from '../services/diagnostics';
import { applyCount, receiptText, salesInsights } from '../services/insights';

async function setup() {
  useDatabase(new AppDB(`recursos-${Math.random()}`));
  await seedIfNeeded();
  await db.settings.where('key').equals('initialOpening').delete();
  const d = await startDay('2026-11-04');
  const g = await createGroup({ name: 'Loja R' });
  const azul = await createVariant({ groupId: g.id, name: 'Azul', startQuantity: 10, dailyRecordId: d.id, forSale: true });
  const rosa = await createVariant({ groupId: g.id, name: 'Rosa', startQuantity: 5, dailyRecordId: d.id, forSale: true });
  return { d, g, azul, rosa };
}
const row = async (dayId: string, date: string, id: string) => (await loadStockRows(dayId, date)).find((r) => r.variant.id === id)!;
const errors = async () => (await runDiagnostics()).findings.filter((f) => f.level === 'erro');
const sell = (dayId: string, variantId: string, quantity: number, extra: Partial<Parameters<typeof createOrder>[0]> = {}) =>
  createOrder({ orderId: uid(), dailyRecordId: dayId, paymentMethod: 'dinheiro', lines: [{ variantId, quantity, unitPriceInCents: 7000 }], ...extra });

describe('Condicional (levou para provar em casa)', () => {
  it('sai da venda, continua no estoque; ficou 1 de 3 → vende 1 e 2 voltam à venda', async () => {
    const { d, azul } = await setup();
    await expect(createReservation({ dailyRecordId: d.id, variantId: azul.id, quantity: 3, kind: 'condicional', dueDate: '2026-11-06' })).rejects.toThrow('nome');
    await expect(createReservation({ dailyRecordId: d.id, variantId: azul.id, quantity: 3, kind: 'condicional', customer: 'Kelly' })).rejects.toThrow('até quando');
    const r = await createReservation({ dailyRecordId: d.id, variantId: azul.id, quantity: 3, kind: 'condicional', customer: 'Kelly', dueDate: '2026-11-06' });
    let x = await row(d.id, d.date, azul.id);
    expect([x.item.currentQuantity, x.available]).toEqual([10, 7]); // é da loja, mas não está à venda
    await convertReservation({ reservationId: r.id, dailyRecordId: d.id, unitPriceInCents: 7000, paymentMethod: 'pix', orderId: uid(), quantity: 1 });
    x = await row(d.id, d.date, azul.id);
    expect([x.item.currentQuantity, x.available]).toEqual([9, 9]);
    expect(await errors()).toEqual([]);
  });

  it('voltou tudo: cancelar devolve à venda sem mexer no estoque', async () => {
    const { d, azul } = await setup();
    const r = await createReservation({ dailyRecordId: d.id, variantId: azul.id, quantity: 2, kind: 'condicional', customer: 'Ana', dueDate: '2026-11-05' });
    await cancelReservation(r.id, d.id);
    const x = await row(d.id, d.date, azul.id);
    expect([x.item.currentQuantity, x.available]).toEqual([10, 10]);
  });
});

describe('Contagem da loja', () => {
  it('contou na loja + o que está em condicional = estoque; só mexe no que mudou; cor não contada fica', async () => {
    const { d, azul, rosa } = await setup();
    await createReservation({ dailyRecordId: d.id, variantId: azul.id, quantity: 2, kind: 'condicional', customer: 'Ana', dueDate: '2026-11-05' });
    const changes = await applyCount(d.id, [{ variantId: azul.id, counted: 7 }]); // na loja 7 + 2 com a Ana = 9
    expect(changes).toEqual([{ variantId: azul.id, from: 10, to: 9 }]);
    expect((await row(d.id, d.date, azul.id)).item.currentQuantity).toBe(9);
    expect((await row(d.id, d.date, rosa.id)).item.currentQuantity).toBe(5);
    expect(await applyCount(d.id, [{ variantId: azul.id, counted: 7 }])).toEqual([]); // contar de novo igual: nada muda
    const mv = (await db.stockMovements.where('variantId').equals(azul.id).toArray()).filter((m) => m.description === 'Contagem da loja');
    expect(mv.map((m) => m.quantity)).toEqual([-1]);
    expect(await errors()).toEqual([]);
  });
});

describe('Mais vendidas, paradas e lucro', () => {
  it('ranking por peças; parada = tem peça e não vendeu; lucro só com custo cadastrado', async () => {
    const { d, azul, rosa } = await setup();
    await updateVariant(azul.id, { costInCents: 3000 });
    await sell(d.id, azul.id, 3);
    const i = await salesInsights(7, d.date);
    expect(i.top.map((r) => [r.variant.name, r.qty])).toEqual([['Azul', 3]]);
    expect(i.stale.some((r) => r.variant.id === rosa.id)).toBe(true);
    expect(i.stale.some((r) => r.variant.id === azul.id)).toBe(false);
    expect(i.profit).toEqual({ revenueWithCost: 21000, cost: 9000, profit: 12000, piecesNoCost: 0 });
    await sell(d.id, rosa.id, 1);
    expect((await salesInsights(7, d.date)).profit.piecesNoCost).toBe(1);
    // custo muda depois: a venda antiga guarda o custo do dia em que vendeu
    await updateVariant(azul.id, { costInCents: 5000 });
    expect((await salesInsights(7, d.date)).profit.cost).toBe(9000);
  });
});

describe('Recibo', () => {
  it('lista as peças, o total e a forma', async () => {
    const { d, azul } = await setup();
    const o = await sell(d.id, azul.id, 2, { customer: 'Kelly' });
    const t = receiptText(o, await db.sales.where('orderId').equals(o.id).toArray(), () => 'Loja R Azul');
    expect(t).toContain('👩 Kelly');
    expect(t).toContain('• 2× Loja R Azul — 140');
    expect(t).toContain('*Total: 140*');
    expect(t).toContain('Dinheiro: 140');
  });
});

describe('Fiado (sim ou não)', () => {
  it('fiado: peça sai, nada entra no caixa; “Pagou” recebe tudo hoje; tocar de novo não recebe duas vezes', async () => {
    const { d, azul } = await setup();
    const before = (await computeCash(d.id)).salesTotal;
    await expect(sell(d.id, azul.id, 2, { fiado: true })).rejects.toThrow('nome');
    const o = await sell(d.id, azul.id, 2, { fiado: true, customer: 'Ana' });
    expect((await row(d.id, d.date, azul.id)).item.currentQuantity).toBe(8);
    expect((await computeCash(d.id)).salesTotal).toBe(before);
    expect(await owedOf(o)).toBe(14000);
    expect((await openFiado()).map((f) => f.owed)).toEqual([14000]);
    expect(await errors()).toEqual([]);
    expect(await receiveFiado(o.id, d.id, 'pix')).toBe(14000);
    expect(await receiveFiado(o.id, d.id, 'pix')).toBe(0);
    expect((await computeCash(d.id)).salesByMethod.pix).toBe(14000);
    expect(await openFiado()).toEqual([]);
    expect(await errors()).toEqual([]);
  });

  it('fiado não pago e cancelado: peça volta, caixa nem mexe', async () => {
    const { d, azul } = await setup();
    const o = await sell(d.id, azul.id, 2, { fiado: true, customer: 'Ana' });
    await cancelOrder(o.id);
    expect((await row(d.id, d.date, azul.id)).item.currentQuantity).toBe(10);
    expect((await db.cashMovements.where('relatedOrderId').equals(o.id).toArray())).toEqual([]);
    expect(await errors()).toEqual([]);
  });

  it('fiado: devolveu 1 antes de pagar → só passa a dever menos (nada sai do caixa)', async () => {
    const { d, azul } = await setup();
    const o = await sell(d.id, azul.id, 2, { fiado: true, customer: 'Ana' });
    await returnSaleItem((await db.sales.where('orderId').equals(o.id).toArray())[0].id, 1);
    expect(await owedOf((await db.orders.get(o.id))!)).toBe(7000);
    expect((await db.cashMovements.where('relatedOrderId').equals(o.id).toArray())).toEqual([]);
    expect(await errors()).toEqual([]);
  });
});

describe('Vale (crédito da cliente)', () => {
  it('devolução vira vale; ela usa o vale numa compra; o caixa só recebe a diferença', async () => {
    const { d, azul, rosa } = await setup();
    const o = await sell(d.id, azul.id, 2, { customer: 'Kelly' });
    await returnSaleItem((await db.sales.where('orderId').equals(o.id).toArray())[0].id, 1, 'vale');
    expect(await creditBalance('kelly')).toBe(7000); // nome sem maiúscula também acha
    const cash1 = (await computeCash(d.id)).salesTotal;
    const o2 = await createOrder({ orderId: uid(), dailyRecordId: d.id, paymentMethod: 'dinheiro', customer: 'Kelly', valeInCents: 7000,
      lines: [{ variantId: rosa.id, quantity: 2, unitPriceInCents: 7000 }] });
    expect(await creditBalance('Kelly')).toBe(0);
    expect((await computeCash(d.id)).salesTotal - cash1).toBe(7000); // pagou 140: 70 de vale + 70 em dinheiro
    await expect(createOrder({ orderId: uid(), dailyRecordId: d.id, paymentMethod: 'dinheiro', customer: 'Kelly', valeInCents: 100,
      lines: [{ variantId: rosa.id, quantity: 1, unitPriceInCents: 7000 }] })).rejects.toThrow('vale');
    expect(await errors()).toEqual([]);
    // cancelou a compra paga com vale: o dinheiro sai e o vale volta
    await cancelOrder(o2.id);
    expect(await creditBalance('Kelly')).toBe(7000);
    expect(await errors()).toEqual([]);
  });

  it('cancelar e virar vale: o dinheiro fica no caixa e ela ganha o vale', async () => {
    const { d, azul } = await setup();
    const o = await sell(d.id, azul.id, 1, { customer: 'Bia' });
    const cash = (await computeCash(d.id)).salesTotal;
    await cancelOrder(o.id, { refund: 'vale' });
    expect((await computeCash(d.id)).salesTotal).toBe(cash);
    expect(await creditBalance('Bia')).toBe(7000);
    expect((await row(d.id, d.date, azul.id)).item.currentQuantity).toBe(10);
    expect(await errors()).toEqual([]);
    const sem = await sell(d.id, azul.id, 1);
    await expect(cancelOrder(sem.id, { refund: 'vale' })).rejects.toThrow('nome');
  });
});

describe('Nada antigo mudou', () => {
  it('venda normal, entrada e cancelamento como sempre', async () => {
    const { d, azul } = await setup();
    const o = await sell(d.id, azul.id, 2);
    await moveStock(d.id, azul.id, 3, 'entrada');
    expect((await row(d.id, d.date, azul.id)).item.currentQuantity).toBe(11);
    await cancelOrder(o.id);
    expect((await row(d.id, d.date, azul.id)).item.currentQuantity).toBe(13);
    expect(await creditBalance('')).toBe(0);
    expect(await errors()).toEqual([]);
  });
});
