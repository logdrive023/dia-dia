/**
 * Lacunas da AUDITORIA-ESTOQUE.md fechadas (P5, P7, P8, P9, P11, devolução parcial e Juntar com cor antiga).
 * Cada teste é um caso de loja: o que a pessoa faz → o que o estoque, o caixa e o relatório têm que mostrar.
 */
import { describe, expect, it } from 'vitest';
import { AppDB, db, useDatabase } from '../db/db';
import { seedIfNeeded } from '../db/seed';
import { addDays, todayStr, uid } from '../lib/util';
import { closeDay, moveStock, reopenDay, resyncFromPrevious, setStock, startDay } from '../services/days';
import { archiveVariant, createGroup, createVariant, setForSale } from '../services/catalog';
import { cancelOrder, correctOrderPrices, createOrder, createReservation, returnSaleItem, swapSaleItem } from '../services/sales';
import { computeCash, daySummary, loadStockRows, syncGap } from '../services/summary';
import { runDiagnostics } from '../services/diagnostics';
import { whatsappReport } from '../services/report';
import { buildBackup } from '../services/backup';
import { mergeBackup } from '../services/sync';

async function fresh(name = 'lacunas') {
  useDatabase(new AppDB(`${name}-${Math.random()}`));
  await seedIfNeeded();
  await db.settings.where('key').equals('initialOpening').delete();
}
async function setup(date = '2026-11-04') {
  await fresh();
  const d = await startDay(date);
  const g = await createGroup({ name: 'Loja Teste' });
  const azul = await createVariant({ groupId: g.id, name: 'Azul', startQuantity: 10, dailyRecordId: d.id, forSale: true });
  const rosa = await createVariant({ groupId: g.id, name: 'Rosa', startQuantity: 5, dailyRecordId: d.id, forSale: true });
  return { d, g, azul, rosa };
}
const sell = (dayId: string, lines: { variantId: string; quantity: number; unitPriceInCents: number }[], payments?: { method: 'pix' | 'dinheiro'; amountInCents: number }[]) =>
  createOrder({ orderId: uid(), dailyRecordId: dayId, paymentMethod: 'dinheiro', lines, payments });
const qty = async (dayId: string, date: string, id: string) => (await loadStockRows(dayId, date)).find((r) => r.variant.id === id)!.item.currentQuantity;
const errors = async () => (await runDiagnostics()).findings.filter((f) => f.level === 'erro');

describe('P9: cor antiga não vende, não reserva, não recebe troca (regra do serviço)', () => {
  it('venda, reserva e entrada em cor arquivada são recusadas; troca para guardada também', async () => {
    const { d, azul, rosa } = await setup();
    await archiveVariant(rosa.id, true);
    await expect(sell(d.id, [{ variantId: rosa.id, quantity: 1, unitPriceInCents: 7000 }])).rejects.toThrow('cor antiga');
    await expect(createReservation({ dailyRecordId: d.id, variantId: rosa.id, quantity: 1, customer: 'Ana' })).rejects.toThrow('cor antiga');
    await expect(moveStock(d.id, rosa.id, 1, 'entrada')).rejects.toThrow('cor antiga');
    await expect(setStock(d.id, rosa.id, 9)).rejects.toThrow('cor antiga');
    await archiveVariant(rosa.id, false);
    await setForSale([rosa.id], false);
    const o = await sell(d.id, [{ variantId: azul.id, quantity: 1, unitPriceInCents: 7000 }]);
    const line = (await db.sales.where('orderId').equals(o.id).toArray())[0];
    await expect(swapSaleItem(line.id, rosa.id)).rejects.toThrow('guardada');
  });
});

describe('Devolução parcial', () => {
  it('levou 3, devolveu 1: a peça volta, o valor dela sai do caixa, o resto da venda fica', async () => {
    const { d, azul } = await setup();
    const o = await sell(d.id, [{ variantId: azul.id, quantity: 3, unitPriceInCents: 7000 }]);
    const line = (await db.sales.where('orderId').equals(o.id).toArray())[0];
    await returnSaleItem(line.id, 1);
    expect(await qty(d.id, d.date, azul.id)).toBe(8);
    const ord = (await db.orders.get(o.id))!;
    expect([ord.status, ord.totalInCents, ord.itemCount]).toEqual(['ok', 14000, 2]);
    expect(await db.sales.get(line.id)).toMatchObject({ quantity: 2, totalInCents: 14000, returnedQuantity: 1 });
    const net = (await db.cashMovements.where('relatedOrderId').equals(o.id).toArray()).reduce((s, c) => s + (c.type === 'estorno' ? -c.amountInCents : c.amountInCents), 0);
    expect(net).toBe(14000);
    expect(await errors()).toEqual([]);
    await expect(returnSaleItem(line.id, 2)).rejects.toThrow('Cancelar venda');
  });

  it('pagamento dividido: devolver tira da forma da peça e as formas da venda acompanham', async () => {
    const { d, azul } = await setup();
    const o = await sell(d.id, [{ variantId: azul.id, quantity: 2, unitPriceInCents: 7000 }], [{ method: 'pix', amountInCents: 4000 }, { method: 'dinheiro', amountInCents: 10000 }]);
    const line = (await db.sales.where('orderId').equals(o.id).toArray())[0];
    await returnSaleItem(line.id, 1);
    const ord = (await db.orders.get(o.id))!;
    expect(ord.totalInCents).toBe(7000);
    expect((ord.payments ?? [{ method: ord.paymentMethod, amountInCents: ord.totalInCents }]).reduce((s, p) => s + p.amountInCents, 0)).toBe(7000);
    expect(await errors()).toEqual([]);
  });
});

describe('P7: cancelar ou devolver venda de dia encerrado entra HOJE (o dia encerrado não muda)', () => {
  it('cancelar venda de ontem: peça e dinheiro voltam hoje; ontem continua igual', async () => {
    const { d, azul } = await setup(addDays(todayStr(), -1));
    const o = await sell(d.id, [{ variantId: azul.id, quantity: 2, unitPriceInCents: 7000 }]);
    await closeDay(d.id);
    const ontem = { estoque: await qty(d.id, d.date, azul.id), caixa: (await computeCash(d.id)).dayResult };
    const hoje = await startDay(todayStr());
    expect(await qty(hoje.id, hoje.date, azul.id)).toBe(8);
    await cancelOrder(o.id);
    expect(await qty(d.id, d.date, azul.id)).toBe(ontem.estoque);
    expect((await computeCash(d.id)).dayResult).toBe(ontem.caixa);
    expect(await qty(hoje.id, hoje.date, azul.id)).toBe(10);
    const est = (await db.cashMovements.where('relatedOrderId').equals(o.id).toArray()).find((c) => c.type === 'estorno')!;
    expect(est.dailyRecordId).toBe(hoje.id);
    expect(est.description).toContain('venda de');
    expect(est.amountInCents).toBe(14000);
    expect(await errors()).toEqual([]);
  });

  it('sem o dia de hoje iniciado: avisa para iniciar (não mexe no dia encerrado)', async () => {
    const { d, azul } = await setup(addDays(todayStr(), -1));
    const o = await sell(d.id, [{ variantId: azul.id, quantity: 1, unitPriceInCents: 7000 }]);
    await closeDay(d.id);
    await expect(cancelOrder(o.id)).rejects.toThrow('Inicie o dia de hoje');
  });

  it('devolver 1 de uma venda de ontem: volta hoje', async () => {
    const { d, azul } = await setup(addDays(todayStr(), -1));
    const o = await sell(d.id, [{ variantId: azul.id, quantity: 3, unitPriceInCents: 7000 }]);
    await closeDay(d.id);
    const hoje = await startDay(todayStr());
    await returnSaleItem((await db.sales.where('orderId').equals(o.id).toArray())[0].id, 1);
    expect(await qty(d.id, d.date, azul.id)).toBe(7);
    expect(await qty(hoje.id, hoje.date, azul.id)).toBe(8);
    expect(await errors()).toEqual([]);
  });
});

describe('P11: corrigir valor com pagamento dividido mantém as formas iguais ao caixa', () => {
  it('Pix 40 + dinheiro 100 → corrige para 120: as formas somam 120', async () => {
    const { d, azul } = await setup();
    const o = await sell(d.id, [{ variantId: azul.id, quantity: 2, unitPriceInCents: 7000 }], [{ method: 'pix', amountInCents: 4000 }, { method: 'dinheiro', amountInCents: 10000 }]);
    const line = (await db.sales.where('orderId').equals(o.id).toArray())[0];
    await correctOrderPrices(o.id, { [line.id]: 6000 });
    const ord = (await db.orders.get(o.id))!;
    expect(ord.totalInCents).toBe(12000);
    expect(ord.payments!.reduce((s, p) => s + p.amountInCents, 0)).toBe(12000);
    expect(await errors()).toEqual([]);
  });
});

describe('P5: a conta do estoque fecha no relatório (com saída, ajuste e devolução)', () => {
  it('começou − vendeu + voltou + entrou − saiu ± ajustes = terminou, e a mensagem mostra cada parte', async () => {
    const { d, azul, rosa } = await setup();
    const o = await sell(d.id, [{ variantId: azul.id, quantity: 3, unitPriceInCents: 7000 }]);
    await returnSaleItem((await db.sales.where('orderId').equals(o.id).toArray())[0].id, 1);
    await moveStock(d.id, rosa.id, 4, 'entrada', undefined, { entryKind: 'reposicao' });
    await moveStock(d.id, rosa.id, -2, 'saida');
    await setStock(d.id, azul.id, 6); // contou 6 (tinha 8)
    const s = await daySummary(d.id, d.date);
    const f = s.flow;
    expect(f.start - f.sold + f.returned + f.entered - f.out + f.adjust).toBe(f.end);
    expect([f.sold, f.returned, f.entered, f.out, f.adjust, f.end - f.start]).toEqual([3, 1, 4, 2, -2, -2]);
    const w = whatsappReport(d.date, s, { showStock: true, totals: true });
    expect(w).toContain('📤 *Saiu sem ser venda (2 peças)*');
    expect(w).toContain('✏️ *Ajustes de contagem (−2)*');
    expect(w).toContain(`🧮 começou ${f.start} − vendeu 3 + voltou 1 + entrou 4 − saiu sem venda 2 − ajustes 2 = terminou ${f.end}`);
  });
});

describe('P8: “Atualizar” leva a correção pela cadeia de dias', () => {
  it('corrigiu 02/11 com 03/11 encerrado e 04/11 aberto: os dois acompanham', async () => {
    await fresh();
    const d1 = await startDay('2026-11-02');
    const g = await createGroup({ name: 'Cadeia' });
    const v = await createVariant({ groupId: g.id, name: 'Azul', startQuantity: 10, dailyRecordId: d1.id });
    await closeDay(d1.id);
    const d2 = await startDay('2026-11-03');
    await moveStock(d2.id, v.id, -1, 'saida');
    await closeDay(d2.id);
    const d3 = await startDay('2026-11-04');
    await reopenDay(d1.id);
    await setStock(d1.id, v.id, 8); // contou 8, não 10
    await closeDay(d1.id);
    expect(await syncGap(d3.id)).toBeNull(); // o vizinho (03/11) não mudou…
    expect(await syncGap(d3.id, true)).not.toBeNull(); // …mas a cadeia tem diferença
    await resyncFromPrevious(d3.id);
    expect(await qty(d2.id, d2.date, v.id)).toBe(7);
    expect(await qty(d3.id, d3.date, v.id)).toBe(7);
    expect(await syncGap(d3.id, true)).toBeNull();
    expect(await errors()).toEqual([]);
  });
});

describe('Juntar: cor antiga de um celular não entra na cor ativa do outro', () => {
  it('A tem Poa antiga (7) e Poa nova (7); B tem só a Poa ativa (7): depois de juntar, B continua com 7 na ativa', async () => {
    // celular A
    await fresh('juntar-a');
    const a = await startDay('2026-11-04');
    const ga = await createGroup({ name: 'Camisa J' });
    const oldA = await createVariant({ groupId: ga.id, name: 'Poa', startQuantity: 7, dailyRecordId: a.id });
    await archiveVariant(oldA.id, true);
    await createVariant({ groupId: ga.id, name: 'Poa', color: 'poa', startQuantity: 7, dailyRecordId: a.id });
    const backupA = await buildBackup();
    // celular B (identificadores próprios)
    await fresh('juntar-b');
    const b = await startDay('2026-11-04');
    const gb = await createGroup({ name: 'Camisa J' });
    const poaB = await createVariant({ groupId: gb.id, name: 'Poa', startQuantity: 7, dailyRecordId: b.id });
    await mergeBackup(JSON.parse(JSON.stringify(backupA)));
    const rows = (await loadStockRows(b.id, b.date)).filter((r) => r.group.id === gb.id);
    expect(rows.find((r) => r.variant.id === poaB.id)!.item.currentQuantity).toBe(7);
    const live = rows.filter((r) => !r.variant.archivedAt && !r.variant.deletedAt);
    expect(live.reduce((s, r) => s + r.item.currentQuantity, 0)).toBe(7);
  });
});
