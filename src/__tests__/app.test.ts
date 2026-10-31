import { beforeEach, describe, expect, it } from 'vitest';
import { AppDB, db, useDatabase } from '../db/db';
import { seedIfNeeded, SEED_DATA } from '../db/seed';
import {
  archiveGroup, createGroup, createVariant, deleteGroup, deleteVariant, moveVariant, registerPendingSellGroup,
  reorderGroups, updateGroup, updateVariant,
} from '../services/catalog';
import { closeDay, getDayByDate, moveStock, reopenDay, ReservedError, resyncFromPrevious, setStock, startDay, undoMovement } from '../services/days';
import { cancelOrder, cancelReservation, convertReservation, createOrder, createReservation } from '../services/sales';
import { addCashMovement, setCountedBalance, setOpeningBalance } from '../services/cash';
import { compareDays, computeCash, daySummary, loadStockRows, syncGap } from '../services/summary';
import { runDiagnostics } from '../services/diagnostics';
import { buildBackup, decodeTextBackup, encodeTextBackup, restoreBackup } from '../services/backup';
import { notebookReport, whatsappReport } from '../services/report';
import { getSetting } from '../services/settings';
import { money, toCents, uid } from '../lib/util';

let n = 0;
beforeEach(async () => {
  useDatabase(new AppDB(`test-${n++}-${Math.random()}`));
  await seedIfNeeded();
  await db.variants.toCollection().modify({ forSale: true }); await db.settings.where('key').equals('initialOpening').delete(); // testes de regra vendem qualquer peça
});

const variantId = async (group: string, name: string) => {
  const g = (await db.groups.toArray()).find((x) => x.name === group)!;
  return (await db.variants.where('groupId').equals(g.id).toArray()).find((v) => v.name === name)!.id;
};
const qty = async (dayId: string, vid: string) =>
  (await db.dailyStockItems.where('[dailyRecordId+variantId]').equals([dayId, vid]).first())!.currentQuantity;

describe('carga inicial', () => {
  it('8 grupos, 51 variações, 238 unidades, zeros preservados', async () => {
    expect(await db.groups.count()).toBe(8);
    expect(await db.variants.count()).toBe(51);
    const vs = await db.variants.toArray();
    expect(vs.reduce((s, v) => s + v.startQuantity, 0)).toBe(238);
    expect(vs.filter((v) => v.startQuantity === 0).length).toBe(3);
    const totals = Object.fromEntries(SEED_DATA.map((g) => [g.name, g.variants.reduce((s, [, q]) => s + q, 0)]));
    expect(totals).toEqual({ Plomo: 48, Lila: 24, Broche: 60, Camisa: 6, 'Broche Médio': 23, Naranja: 25, Dorado: 32, Azul: 20 });
  });
  it('não roda de novo nem sobrescreve personalização', async () => {
    const g = (await db.groups.toArray())[0];
    await updateGroup(g.id, { name: 'Plomo Premium' });
    expect(await seedIfNeeded()).toBe(false);
    expect(await db.groups.count()).toBe(8);
    expect((await db.groups.get(g.id))!.name).toBe('Plomo Premium');
  });
  it('Broche Rey fica pendente na seleção "Para vender"', async () => {
    const sell = await getSetting('sellGroups');
    expect(sell.map((s) => s.pendingName ?? 'grupo')).toEqual(['grupo', 'grupo', 'grupo', 'Broche Rey']);
    const g = await registerPendingSellGroup('Broche Rey');
    expect((await getSetting('sellGroups'))[3]).toEqual({ groupId: g.id, highlight: false });
    expect(await db.variants.where('groupId').equals(g.id).count()).toBe(0);
  });
});

describe('dias independentes', () => {
  it('iniciar o dia copia o saldo anterior e é idempotente', async () => {
    const d1 = await startDay('2026-10-30');
    expect((await loadStockRows(d1.id, d1.date)).reduce((s, r) => s + r.item.currentQuantity, 0)).toBe(238);
    const again = await startDay('2026-10-30');
    expect(again.id).toBe(d1.id);
    expect(await db.dailyRecords.count()).toBe(1);

    const v = await variantId('Plomo', 'Vermelho');
    await createOrder({ orderId: uid(), dailyRecordId: d1.id, paymentMethod: 'dinheiro', lines: [{ variantId: v, quantity: 3, unitPriceInCents: 7000 }] });
    const d2 = await startDay('2026-10-31');
    expect(d2.sourceDate).toBe('2026-10-30');
    expect(await qty(d2.id, v)).toBe(11);
    // vendas não são copiadas
    expect(await db.orders.where('dailyRecordId').equals(d2.id).count()).toBe(0);
    // alterar um dia não altera outro
    await setStock(d2.id, v, 2);
    expect(await qty(d1.id, v)).toBe(11);
    expect(await qty(d2.id, v)).toBe(2);
    await setStock(d1.id, v, 5);
    expect(await qty(d2.id, v)).toBe(2);
  });
  it('dia em branco começa zerado', async () => {
    await startDay('2026-10-30');
    const d = await startDay('2026-11-01', 'blank');
    expect((await loadStockRows(d.id, d.date)).every((r) => r.item.currentQuantity === 0)).toBe(true);
  });
  it('fechar bloqueia, reabrir libera', async () => {
    const d = await startDay('2026-10-31');
    const v = await variantId('Lila', 'Azul');
    await closeDay(d.id);
    await expect(moveStock(d.id, v, 1, 'entrada')).rejects.toThrow(/encerrado/);
    await reopenDay(d.id);
    await moveStock(d.id, v, 1, 'entrada');
    expect(await qty(d.id, v)).toBe(9);
    expect(await db.auditLogs.filter((a) => a.action === 'close' || a.action === 'reopen').count()).toBe(2);
  });
  it('desfazer cria movimentação inversa e só uma vez', async () => {
    const d = await startDay('2026-10-31');
    const v = await variantId('Lila', 'Azul');
    const mv = await moveStock(d.id, v, -2, 'perda');
    await undoMovement(mv.id);
    expect(await qty(d.id, v)).toBe(8);
    await expect(undoMovement(mv.id)).rejects.toThrow(/já foi desfeita/);
    expect(await db.stockMovements.count()).toBe(2);
  });
});

describe('vendas e reservas', () => {
  it('venda com várias peças baixa estoque uma vez, mesmo com toque repetido', async () => {
    const d = await startDay('2026-10-31');
    const a = await variantId('Azul', 'Branco'), b = await variantId('Plomo', 'Preto');
    const orderId = uid();
    const lines = [{ variantId: a, quantity: 2, unitPriceInCents: 7000 }, { variantId: b, quantity: 1, unitPriceInCents: 8500 }];
    await Promise.all([
      createOrder({ orderId, dailyRecordId: d.id, paymentMethod: 'pix', lines }),
      createOrder({ orderId, dailyRecordId: d.id, paymentMethod: 'pix', lines }),
    ]);
    expect(await qty(d.id, a)).toBe(3);
    expect(await qty(d.id, b)).toBe(5);
    const c = await computeCash(d.id);
    expect(c.salesByMethod.pix).toBe(22500);
    expect(await db.cashMovements.count()).toBe(1);
  });
  it('venda sem preço não gera receita; não vende além do disponível', async () => {
    const d = await startDay('2026-10-31');
    const v = await variantId('Plomo', 'Rosa');
    await createOrder({ orderId: uid(), dailyRecordId: d.id, paymentMethod: 'dinheiro', lines: [{ variantId: v, quantity: 1, unitPriceInCents: null }] });
    expect((await computeCash(d.id)).salesTotal).toBe(0);
    await expect(createOrder({ orderId: uid(), dailyRecordId: d.id, paymentMethod: 'dinheiro', lines: [{ variantId: v, quantity: 1, unitPriceInCents: 7000 }] }))
      .rejects.toThrow(/Só há 0/);
  });
  it('cancelar venda devolve peças e estorna caixa', async () => {
    const d = await startDay('2026-10-31');
    const v = await variantId('Broche', 'Branco');
    const o = await createOrder({ orderId: uid(), dailyRecordId: d.id, paymentMethod: 'cartao', lines: [{ variantId: v, quantity: 4, unitPriceInCents: 7500 }] });
    await cancelOrder(o.id);
    await cancelOrder(o.id);
    expect(await qty(d.id, v)).toBe(30);
    expect((await computeCash(d.id)).salesTotal).toBe(0);
  });
  it('reserva reduz disponível, não o físico; cancelar e converter', async () => {
    const d = await startDay('2026-10-31');
    const v = await variantId('Lila', 'Rosa');
    const r = await createReservation({ dailyRecordId: d.id, variantId: v, quantity: 3, customer: 'Ana' });
    let row = (await loadStockRows(d.id, d.date)).find((x) => x.variant.id === v)!;
    expect([row.item.currentQuantity, row.reserved, row.available]).toEqual([5, 3, 2]);
    await expect(createOrder({ orderId: uid(), dailyRecordId: d.id, paymentMethod: 'dinheiro', lines: [{ variantId: v, quantity: 3, unitPriceInCents: 7000 }] }))
      .rejects.toThrow();
    await convertReservation({ reservationId: r.id, dailyRecordId: d.id, unitPriceInCents: 7000, paymentMethod: 'dinheiro', orderId: uid() });
    row = (await loadStockRows(d.id, d.date)).find((x) => x.variant.id === v)!;
    expect([row.item.currentQuantity, row.reserved, row.available]).toEqual([2, 0, 2]);
    const r2 = await createReservation({ dailyRecordId: d.id, variantId: v, quantity: 1 });
    await cancelReservation(r2.id);
    row = (await loadStockRows(d.id, d.date)).find((x) => x.variant.id === v)!;
    expect(row.available).toBe(2);
  });
});

describe('caixa e relatório do caderno', () => {
  it('reproduz a página: 935 - 50 = 885; Ontem 645 + 885 = 1530 - 300 = 1230', async () => {
    const ontem = await startDay('2026-10-30');
    await addCashMovement({ dailyRecordId: ontem.id, type: 'entrada', amountInCents: 64500, description: 'saldo' });
    await closeDay(ontem.id);
    const d = await startDay('2026-10-31');
    expect((await computeCash(d.id)).opening).toBe(64500);
    const v = await variantId('Broche', 'Branco');
    const page: [number, number][] = [[1, 70], [1, 85], [2, 70], [1, 70], [1, 70], [2, 70], [1, 70], [1, 70], [1, 75], [1, 75], [1, 70]];
    for (const [q, p] of page)
      await createOrder({ orderId: uid(), dailyRecordId: d.id, paymentMethod: 'dinheiro', lines: [{ variantId: v, quantity: q, unitPriceInCents: p * 100 }] });
    await addCashMovement({ dailyRecordId: d.id, type: 'dar', amountInCents: 5000, person: 'Chico' });
    await addCashMovement({ dailyRecordId: d.id, type: 'retirada', amountInCents: 30000 });
    const c = await computeCash(d.id);
    expect([c.salesTotal, c.todayNet, c.subtotal, c.accumulated]).toEqual([93500, 88500, 153000, 123000]);
    await setCountedBalance(d.id, 123000);
    expect((await computeCash(d.id)).difference).toBe(0);

    const s = await daySummary(d.id, d.date);
    const nb = notebookReport(d.date, s);
    expect(nb).toContain('2x70 = 140 Dinheiro');
    expect(nb).toContain('Chico: 50');
    expect(nb).toContain('935 - 50 = 885');
    expect(nb).toContain('Ontem 645 + 885 = 1.530 - 300 = 1.230');
    const wa = whatsappReport(d.date, s);
    expect(wa).toContain('Vendeu: *935*');
    expect(wa).toContain('Precisa repor');
    // o dia seguinte começa com o saldo acumulado
    const amanha = await startDay('2026-11-01');
    expect((await computeCash(amanha.id)).opening).toBe(123000);
  });
  it('dinheiro em centavos', () => {
    expect(toCents('70')).toBe(7000);
    expect(toCents('1.230,50')).toBe(123050);
    expect(toCents('1.230')).toBe(123000);
    expect(toCents('1.230.000')).toBe(123000000);
    expect(toCents('1.230,00')).toBe(123000);
    expect(toCents('12.5')).toBe(1250);
    expect(toCents('70,50')).toBe(7050);
    expect(toCents('1.2345')).toBe(123);
    expect(toCents('abc')).toBeNull();
    expect(money(123000)).toBe('1.230');
    expect(money(7050)).toBe('70,50');
  });
});

describe('personalização', () => {
  it('renomear preserva histórico (mesmo id)', async () => {
    const d = await startDay('2026-10-31');
    const v = await variantId('Plomo', 'Vermelho');
    await createOrder({ orderId: uid(), dailyRecordId: d.id, paymentMethod: 'dinheiro', lines: [{ variantId: v, quantity: 1, unitPriceInCents: 7000 }] });
    const g = (await db.groups.toArray()).find((x) => x.name === 'Plomo')!;
    await updateGroup(g.id, { name: 'Plomo Premium', color: '#000000', icon: '⭐' });
    await updateVariant(v, { name: 'Rojo Vivo', minimumStock: 5, optionalPriceInCents: 7000 });
    const s = await daySummary(d.id, d.date);
    expect(s.soldByVariant[0].group.name).toBe('Plomo Premium');
    expect(s.soldByVariant[0].variant.name).toBe('Rojo Vivo');
    expect(await db.auditLogs.filter((a) => a.action === 'rename').count()).toBe(2);
  });
  it('criar grupo/variação, reordenar, arquivar, reativar, mover', async () => {
    const d = await startDay('2026-10-31');
    const g = await createGroup({ name: 'Novidades' });
    await expect(createGroup({ name: 'novidades' })).rejects.toThrow(/Já existe/);
    const v = await createVariant({ groupId: g.id, name: 'Roxo', startQuantity: 4, dailyRecordId: d.id });
    expect(await qty(d.id, v.id)).toBe(4);
    const ids = (await db.groups.orderBy('displayOrder').toArray()).map((x) => x.id).reverse();
    await reorderGroups(ids);
    expect((await db.groups.orderBy('displayOrder').first())!.id).toBe(g.id);
    await archiveGroup(g.id, true);
    expect((await db.groups.get(g.id))!.archivedAt).toBeTruthy();
    await archiveGroup(g.id, false);
    expect((await db.groups.get(g.id))!.active).toBe(true);
    const lila = (await db.groups.toArray()).find((x) => x.name === 'Lila')!;
    await moveVariant(v.id, lila.id);
    expect((await db.variants.get(v.id))!.groupId).toBe(lila.id);
    expect(await qty(d.id, v.id)).toBe(4); // mover não muda estoque
  });
  it('excluir só sem histórico', async () => {
    const g = await createGroup({ name: 'Teste' });
    const v = await createVariant({ groupId: g.id, name: 'X' });
    await deleteVariant(v.id);
    await deleteGroup(g.id);
    expect(await db.groups.get(g.id)).toBeUndefined();
    const d = await startDay('2026-10-31');
    const plomo = (await db.groups.toArray()).find((x) => x.name === 'Plomo')!;
    await expect(deleteGroup(plomo.id)).rejects.toThrow(/Arquive/);
    expect(d).toBeTruthy();
  });
});

describe('comparação e backup', () => {
  it('compara dias e acusa divergência sem movimentação', async () => {
    const d1 = await startDay('2026-10-30');
    const d2 = await startDay('2026-10-31');
    const v = await variantId('Azul', 'Verde Piscina');
    const w = await variantId('Azul', 'Branco');
    await createOrder({ orderId: uid(), dailyRecordId: d2.id, paymentMethod: 'dinheiro', lines: [{ variantId: v, quantity: 3, unitPriceInCents: 7000 }] });
    // divergência: alguém mexeu no dia 2 direto no banco, sem movimentação
    const item = await db.dailyStockItems.where('[dailyRecordId+variantId]').equals([d2.id, w]).first();
    await db.dailyStockItems.update(item!.id, { currentQuantity: 4 });
    const rows = await compareDays(d1.date, d2.date);
    const rv = rows.find((r) => r.variant.id === v)!;
    expect([rv.diff, rv.byType.venda, rv.unexplained]).toEqual([-3, -3, 0]);
    expect(rows.find((r) => r.variant.id === w)!.unexplained).toBe(-1);
  });
  it('backup JSON e texto restauram tudo, inclusive personalização', async () => {
    const d = await startDay('2026-10-31');
    const g = await createGroup({ name: 'Coleção Especial' });
    await createVariant({ groupId: g.id, name: 'Dourado', startQuantity: 2, dailyRecordId: d.id });
    const plomo = (await db.groups.toArray()).find((x) => x.name === 'Plomo')!;
    await updateGroup(plomo.id, { name: 'Plomo Premium' });
    await archiveGroup((await db.groups.toArray()).find((x) => x.name === 'Camisa')!.id, true);
    const v = await variantId('Lila', 'Azul');
    await createOrder({ orderId: uid(), dailyRecordId: d.id, paymentMethod: 'pix', lines: [{ variantId: v, quantity: 2, unitPriceInCents: 7000 }] });
    const backup = await buildBackup();
    const parts = await encodeTextBackup(backup, 500);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0].startsWith('ESTOQUE_BACKUP_V1')).toBe(true);

    // banco novo, vazio
    useDatabase(new AppDB(`restore-${Math.random()}`));
    await expect(decodeTextBackup(parts.slice(1).join('\n'))).rejects.toThrow(/Faltam partes/);
    const broken = parts.join('\n').replace(/[A-Za-z0-9]{40}/, (m) => m.split('').reverse().join(''));
    await expect(decodeTextBackup(broken)).rejects.toThrow();
    expect(await db.groups.count()).toBe(0);

    await restoreBackup(await decodeTextBackup([...parts].reverse().join('\n\n')));
    expect(await db.groups.count()).toBe(9);
    expect((await db.groups.get(plomo.id))!.name).toBe('Plomo Premium');
    expect((await db.groups.toArray()).find((x) => x.name === 'Camisa')!.archivedAt).toBeTruthy();
    const day = await getDayByDate('2026-10-31');
    expect(await qty(day!.id, v)).toBe(6);
    expect((await computeCash(day!.id)).salesByMethod.pix).toBe(14000);

    useDatabase(new AppDB(`restore2-${Math.random()}`));
    await restoreBackup(JSON.parse(JSON.stringify(backup)));
    expect(await db.sales.count()).toBe(1);
    await expect(restoreBackup({ format: 'x' })).rejects.toThrow();
    const bad = JSON.parse(JSON.stringify(backup));
    bad.data.variants[0].groupId = 'nope';
    await expect(restoreBackup(bad)).rejects.toThrow();
  });
});

describe('gaps corrigidos', () => {
  it('corrigir o dia anterior atualiza o "Ontem" do dia seguinte (a não ser que seja manual)', async () => {
    const d1 = await startDay('2026-10-30');
    const d2 = await startDay('2026-10-31');
    expect((await computeCash(d2.id)).opening).toBe(0);
    const v = await variantId('Broche', 'Poa');
    await createOrder({ orderId: uid(), dailyRecordId: d1.id, paymentMethod: 'dinheiro', lines: [{ variantId: v, quantity: 1, unitPriceInCents: 7000 }] });
    expect((await computeCash(d2.id)).opening).toBe(7000);
    await setOpeningBalance(d2.id, 64500);
    expect((await computeCash(d2.id)).opening).toBe(64500);
    await setOpeningBalance(d2.id, null);
    expect((await computeCash(d2.id)).opening).toBe(7000);
  });
  it('avisa quando o dia anterior mudou e atualiza mantendo as vendas do dia', async () => {
    const d1 = await startDay('2026-10-30');
    const d2 = await startDay('2026-10-31');
    const v = await variantId('Broche', 'Poa');
    await createOrder({ orderId: uid(), dailyRecordId: d2.id, paymentMethod: 'dinheiro', lines: [{ variantId: v, quantity: 2, unitPriceInCents: 7000 }] });
    expect(await syncGap(d2.id)).toBeNull();
    await createOrder({ orderId: uid(), dailyRecordId: d1.id, paymentMethod: 'dinheiro', lines: [{ variantId: v, quantity: 3, unitPriceInCents: 7000 }] });
    const gap = await syncGap(d2.id);
    expect(gap?.units).toBe(3);
    await resyncFromPrevious(d2.id);
    expect(await syncGap(d2.id)).toBeNull();
    const item = await db.dailyStockItems.where('[dailyRecordId+variantId]').equals([d2.id, v]).first();
    expect([item!.initialQuantity, item!.currentQuantity]).toEqual([12, 10]);
    expect((await runDiagnostics()).findings.filter((f) => f.level === 'erro')).toEqual([]);
  });
  it('variação nova sem dia aberto entra com sua quantidade no próximo dia, uma vez só', async () => {
    await startDay('2026-10-30');
    const g = await createGroup({ name: 'Novidades' });
    const v = await createVariant({ groupId: g.id, name: 'Roxo', startQuantity: 5 });
    const d2 = await startDay('2026-10-31');
    expect(await qty(d2.id, v.id)).toBe(5);
    await setStock(d2.id, v.id, 0);
    const d3 = await startDay('2026-11-01');
    expect(await qty(d3.id, v.id)).toBe(0);
  });
  it('variação criada depois do início do dia aparece no estoque do dia (com 0)', async () => {
    const d = await startDay('2026-10-31');
    const g = await createGroup({ name: 'Extra' });
    const v = await createVariant({ groupId: g.id, name: 'Azul' });
    const row = (await loadStockRows(d.id, d.date)).find((r) => r.variant.id === v.id);
    expect(row?.item.currentQuantity).toBe(0);
    await moveStock(d.id, v.id, 2, 'entrada');
    expect(await qty(d.id, v.id)).toBe(2);
  });
  it('entrada desfeita não conta como "entrou"', async () => {
    const d = await startDay('2026-10-31');
    const v = await variantId('Lila', 'Verde');
    const mv = await moveStock(d.id, v, 1, 'entrada');
    expect((await daySummary(d.id, d.date)).enteredUnits).toBe(1);
    await undoMovement(mv.id);
    expect((await daySummary(d.id, d.date)).enteredUnits).toBe(0);
  });
  it('diagnóstico: dados limpos sem erro; mexida fora do app é apontada', async () => {
    const d = await startDay('2026-10-31');
    const v = await variantId('Lila', 'Verde');
    const o = await createOrder({ orderId: uid(), dailyRecordId: d.id, paymentMethod: 'pix', lines: [{ variantId: v, quantity: 1, unitPriceInCents: 7000 }] });
    await cancelOrder(o.id);
    await moveStock(d.id, v, 3, 'entrada');
    expect((await runDiagnostics()).findings.filter((f) => f.level === 'erro')).toEqual([]);
    const item = await db.dailyStockItems.where('[dailyRecordId+variantId]').equals([d.id, v]).first();
    await db.dailyStockItems.update(item!.id, { currentQuantity: 99 });
    await db.cashMovements.where('relatedOrderId').equals(o.id).filter((c) => c.type === 'estorno').delete();
    const errs = (await runDiagnostics()).findings.filter((f) => f.level === 'erro').map((f) => f.title);
    expect(errs.some((t) => t.startsWith('Estoque não bate'))).toBe(true);
    expect(errs.some((t) => t.includes('estorno completo no caixa'))).toBe(true);
  });
});

describe('melhorias 1–3', () => {
  it('conferência compara só com o dinheiro vivo (Pix/Cartão ficam fora)', async () => {
    const d1 = await startDay('2026-10-30');
    await setOpeningBalance(d1.id, 10000);
    const v = await variantId('Broche', 'Branco');
    await createOrder({ orderId: uid(), dailyRecordId: d1.id, paymentMethod: 'dinheiro', lines: [{ variantId: v, quantity: 1, unitPriceInCents: 7000 }] });
    await createOrder({ orderId: uid(), dailyRecordId: d1.id, paymentMethod: 'pix', lines: [{ variantId: v, quantity: 1, unitPriceInCents: 8500 }] });
    await addCashMovement({ dailyRecordId: d1.id, type: 'dar', amountInCents: 2000, person: 'Chico' });
    let c = await computeCash(d1.id);
    expect([c.accumulated, c.cashOnHand, c.otherBalance]).toEqual([23500, 15000, 8500]);
    await setCountedBalance(d1.id, 15000);
    expect((await computeCash(d1.id)).difference).toBe(0);
    // dinheiro vivo passa para o dia seguinte
    const d2 = await startDay('2026-10-31');
    c = await computeCash(d2.id);
    expect([c.opening, c.openingCash]).toEqual([23500, 15000]);
    // "Ontem" manual com parte em dinheiro
    await setOpeningBalance(d2.id, 30000, 12000);
    c = await computeCash(d2.id);
    expect([c.opening, c.openingCash, c.otherBalance]).toEqual([30000, 12000, 18000]);
    await expect(setOpeningBalance(d2.id, 100, 200)).rejects.toThrow(/maior que o total/);
  });
  it('saída/ajuste abaixo do reservado pede confirmação; venda segue normal', async () => {
    const d = await startDay('2026-10-31');
    const v = await variantId('Lila', 'Rosa'); // 5 peças
    await createReservation({ dailyRecordId: d.id, variantId: v, quantity: 3, customer: 'Ana' });
    await moveStock(d.id, v, -2, 'saida'); // fica 3 = reservado: ok
    await expect(moveStock(d.id, v, -1, 'perda')).rejects.toBeInstanceOf(ReservedError);
    await expect(setStock(d.id, v, 1)).rejects.toThrow(/reservadas para Ana/);
    expect(await qty(d.id, v)).toBe(3);
    await moveStock(d.id, v, -1, 'perda', undefined, { allowBelowReserved: true });
    expect(await qty(d.id, v)).toBe(2);
    await moveStock(d.id, v, 4, 'entrada');
    await setStock(d.id, v, 4);
    expect(await qty(d.id, v)).toBe(4);
  });
});

describe('lista oficial: o que está à venda', () => {
  it('só Azul, Plomo e Lila à venda; os outros grupos guardados; estoque e quantidades iguais à lista', async () => {
    useDatabase(new AppDB(`oficial-${Math.random()}`));
    await seedIfNeeded();
    const groups = await db.groups.toArray();
    const vs = await db.variants.toArray();
    const byGroup = (n: string) => vs.filter((v) => v.groupId === groups.find((g) => g.name === n)!.id);
    for (const n of ['Azul', 'Plomo', 'Lila']) expect(byGroup(n).every((v) => v.forSale === true), n).toBe(true);
    for (const n of ['Broche', 'Camisa', 'Broche Médio', 'Naranja', 'Dorado']) expect(byGroup(n).every((v) => v.forSale === false), n).toBe(true);
    expect(vs.reduce((s, v) => s + v.startQuantity, 0)).toBe(238);
    expect((await getSetting('sellGroups')).map((s) => s.pendingName ?? groups.find((g) => g.id === s.groupId)?.name)).toEqual(['Azul', 'Plomo', 'Lila', 'Broche Rey']);
    // Broche Rey cadastrado depois: já nasce à venda
    const rey = await registerPendingSellGroup('Broche Rey');
    const v = await createVariant({ groupId: rey.id, name: 'Dourado', startQuantity: 4 });
    expect((await db.variants.get(v.id))!.forSale).toBe(true);
    // cor nova num grupo guardado nasce guardada
    const broche = groups.find((g) => g.name === 'Broche')!;
    const nv = await createVariant({ groupId: broche.id, name: 'Lilás' });
    expect((await db.variants.get(nv.id))!.forSale).toBe(false);
  });
  it('aparelho que já tinha dados recebe o padrão uma vez, sem desfazer o que a pessoa mudou', async () => {
    useDatabase(new AppDB(`antigo-${Math.random()}`));
    await seedIfNeeded();
    await db.settings.where('key').equals('forSaleDefaults').delete();
    await db.variants.toCollection().modify((v) => { delete (v as { forSale?: boolean }).forSale; });
    await seedIfNeeded(); // abre o app de novo
    const camisa = (await db.groups.toArray()).find((g) => g.name === 'Camisa')!;
    const cv = (await db.variants.where('groupId').equals(camisa.id).toArray())[0];
    expect(cv.forSale).toBe(false);
    await db.variants.update(cv.id, { forSale: true }); // a pessoa pôs à venda
    await seedIfNeeded();
    expect((await db.variants.get(cv.id))!.forSale).toBe(true);
  });
});

describe('dados iniciais oficiais (caderno 30/10 e 31/10)', () => {
  it('bate com o caderno: 30/10 encerrado; 31/10 = 645 + 885 = 1.530 − 300 = 1.230 na mão', async () => {
    useDatabase(new AppDB(`caderno-${Math.random()}`));
    await seedIfNeeded();
    const d1 = await startDay('2026-10-31');
    // 30/10 (sexta) encerrado: Dinheiro 645 · Crédito 753,75 · Débito 76,05
    const d0 = (await db.dailyRecords.where('date').equals('2026-10-30').first())!;
    expect(d0.status).toBe('closed');
    const c0 = await computeCash(d0.id);
    expect([c0.opening, c0.salesByMethod.dinheiro, c0.salesByMethod.cartao, c0.salesByMethod.debito, c0.cashOnHand, c0.notebookCount, c0.notebookUnits])
      .toEqual([0, 64500, 75375, 7605, 64500, 9, 20]);
    // 31/10 (sábado): 11 vendas em dinheiro = 935; Chico 50 → hoje 885; ontem 645 + 885 = 1.530; pagamento 300 → 1.230
    const c = await computeCash(d1.id);
    expect(d1.sourceDate).toBe('2026-10-30');
    expect([c.openingCash, c.salesByMethod.dinheiro, c.salesByMethod.cartao, c.salesByMethod.debito]).toEqual([64500, 93500, 0, 0]);
    expect([c.darTotal, c.cashToday, c.openingCash + c.cashToday, c.pagamentos, c.pagamentoDias, c.cashOnHand]).toEqual([5000, 88500, 153000, 30000, 2, 123000]);
    expect([c.opening, c.accumulated, c.otherBalance, c.notebookCount, c.notebookUnits]).toEqual([147480, 147480 + 88500 - 30000, 82980, 11, 13]);
    expect(c.dar[0].person).toBe('Chico');
    // estoque intacto: a lista é o começo de 31/10 (238 peças), nos dois dias
    for (const d of [d0, d1]) {
      const rows = await loadStockRows(d.id, d.date);
      expect([rows.reduce((s, r) => s + r.item.initialQuantity, 0), rows.reduce((s, r) => s + r.item.currentQuantity, 0)]).toEqual([238, 238]);
    }
    expect(await db.stockMovements.count()).toBe(0);
    expect((await runDiagnostics()).findings.filter((f) => f.level === 'erro')).toEqual([]);
    // WhatsApp deixa o pagamento claro e a conta do dinheiro igual ao caderno
    const w = whatsappReport('2026-10-31', await daySummary(d1.id, d1.date));
    // a conta do caixa: ontem separado, hoje linha por linha (inclusive o Chico e a diária) e o total
    const caixa = w.slice(w.indexOf('🧮 *Caixa*'), w.indexOf('🛍️'));
    expect(caixa).toBe([
      '🧮 *Caixa*', '',
      '📅 *Ontem: 1.474,80*',
      '   💵 645 em dinheiro · 🏦 829,80 no banco', '',
      '☀️ *Caixa de hoje*',
      '➕ 💵 Vendas no Dinheiro: 935',
      '➕ ⚡ Vendas no Pix: 0',
      '➕ 💳 Vendas no Crédito: 0',
      '➕ 🏧 Vendas no Débito: 0',
      '➖ 🤝 Dei a Chico: 50',
      '➖ 💼 Pagamento da diária (2 dias × 150): 300',
      '*= Hoje: +585*', '',
      '✅ *Total: 2.059,80*',
      '   ontem 1.474,80 + hoje 585',
      '💵 Na mão: 1.230',
      '🏦 No banco (Pix/cartão): 829,80', '', '',
    ].join('\n'));
    // somando as linhas de hoje dá o "Hoje"; ontem + hoje dá o total
    const { cashStatement } = await import('../services/summary');
    const st = cashStatement(c);
    expect(st.reduce((n, x) => n + (x.sign === '+' ? x.cents : -x.cents), 0)).toBe(c.dayResult);
    expect(c.opening + c.dayResult).toBe(c.accumulated);
    const n = notebookReport('2026-10-31', await daySummary(d1.id, d1.date));
    expect(n).toContain('Pagamento: 300 (2 diárias de 150)');
    // o dia seguinte continua do 1.230 em dinheiro
    const d2 = await startDay('2026-11-01');
    expect((await computeCash(d2.id)).openingCash).toBe(123000);
    expect((await computeCash(d2.id)).notebookCount).toBe(0);
  });
  it('pagamento: lança com diárias, sai depois do ontem + hoje, recusa dias inválidos', async () => {
    useDatabase(new AppDB(`pag-${Math.random()}`));
    await seedIfNeeded();
    await db.settings.where('key').equals('initialOpening').delete();
    const d = await startDay('2026-11-03');
    await addCashMovement({ dailyRecordId: d.id, type: 'entrada', amountInCents: 50000 });
    await addCashMovement({ dailyRecordId: d.id, type: 'pagamento', amountInCents: 15000, quantity: 1 });
    const c = await computeCash(d.id);
    expect([c.todayNet, c.subtotal, c.pagamentos, c.pagamentoDias, c.accumulated, c.cashOnHand]).toEqual([50000, 50000, 15000, 1, 35000, 35000]);
    await expect(addCashMovement({ dailyRecordId: d.id, type: 'pagamento', amountInCents: 15000, quantity: 0 })).rejects.toThrow();
    expect((await getSetting('dailyPayInCents'))).toBe(15000);
  });
  it('venda do caderno: corrige valor/forma/peças e cancela', async () => {
    const { updateNotebookSale, removeCashMovement } = await import('../services/cash');
    useDatabase(new AppDB(`caderno3-${Math.random()}`));
    await seedIfNeeded();
    const d = await startDay('2026-10-31');
    const sale = (await db.cashMovements.where('dailyRecordId').equals(d.id).toArray()).find((m) => m.type === 'venda' && m.amountInCents === 8500)!;
    await updateNotebookSale(sale.id, { amountInCents: 8000, paymentMethod: 'pix', quantity: 1 });
    let c = await computeCash(d.id);
    expect([c.salesByMethod.dinheiro, c.salesByMethod.pix, c.cashOnHand]).toEqual([93500 - 8500, 8000, 123000 - 8500]);
    await expect(updateNotebookSale(sale.id, { amountInCents: 0, paymentMethod: 'pix', quantity: 1 })).rejects.toThrow();
    await removeCashMovement(sale.id);
    c = await computeCash(d.id);
    expect([c.notebookCount, c.notebookUnits, c.salesByMethod.pix]).toEqual([10, 12, 0]);
  });
  it('dia antes do caderno começa zerado e não cria os dias do caderno', async () => {
    useDatabase(new AppDB(`caderno2-${Math.random()}`));
    await seedIfNeeded();
    const d = await startDay('2026-10-29');
    expect((await computeCash(d.id)).accumulated).toBe(0);
    expect(await db.dailyRecords.count()).toBe(1);
  });
  it('crédito e débito ficam separados', async () => {
    useDatabase(new AppDB(`cartoes-${Math.random()}`));
    await seedIfNeeded();
    await db.settings.where('key').equals('initialOpening').delete();
    const d = await startDay('2026-10-30');
    const v = (await db.variants.toArray()).find((x) => x.forSale && x.startQuantity >= 2)!;
    await createOrder({ orderId: uid(), dailyRecordId: d.id, paymentMethod: 'cartao', lines: [{ variantId: v.id, quantity: 1, unitPriceInCents: 75375 }] });
    await createOrder({ orderId: uid(), dailyRecordId: d.id, paymentMethod: 'debito', lines: [{ variantId: v.id, quantity: 1, unitPriceInCents: 7605 }] });
    const c = await computeCash(d.id);
    expect([c.salesByMethod.cartao, c.salesByMethod.debito, c.cashOnHand]).toEqual([75375, 7605, 0]);
  });
  it('recomeçar com os dados iniciais apaga os testes e dá para voltar como estava', async () => {
    const { resetToInitialData, undoLastRestore } = await import('../services/backup');
    useDatabase(new AppDB(`reset-${Math.random()}`));
    await seedIfNeeded();
    const d = await startDay('2026-10-20');
    await addCashMovement({ dailyRecordId: d.id, type: 'entrada', amountInCents: 1000 });
    await resetToInitialData();
    expect(await db.dailyRecords.count()).toBe(0);
    expect(await db.variants.count()).toBe(51);
    expect((await getSetting('sellGroups')).length).toBe(4);
    await undoLastRestore();
    expect(await db.dailyRecords.count()).toBe(1);
  });
});
