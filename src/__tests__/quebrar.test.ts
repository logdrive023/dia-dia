/**
 * Tentativas de quebrar o app: entradas absurdas, ordem errada, toque repetido, dados corrompidos.
 * Cada teste diz o ataque e o que tem de acontecer.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { AppDB, db, useDatabase } from '../db/db';
import { seedIfNeeded } from '../db/seed';
import {
  archiveGroup, archiveVariant, createGroup, createVariant, moveVariant, registerPendingSellGroup, transferVariants, updateGroup,
} from '../services/catalog';
import { closeDay, moveStock, previousDay, setStock, startDay, undoMovement } from '../services/days';
import {
  cancelOrder, cancelReservation, convertReservation, correctOrderPrices, createOrder, createReservation, reservationsOfOrder,
} from '../services/sales';
import { addCashMovement, removeCashMovement, setCountedBalance, setOpeningBalance } from '../services/cash';
import { computeCash, daySummary, loadStockRows } from '../services/summary';
import { buildBackup, decodeTextBackup, encodeTextBackup, restoreBackup, validateBackup } from '../services/backup';
import { buildCsv } from '../services/csv';
import { runDiagnostics } from '../services/diagnostics';
import { notebookReport, whatsappReport } from '../services/report';
import { getSetting } from '../services/settings';
import { money, toCents, uid } from '../lib/util';

let n = 0;
beforeEach(async () => {
  useDatabase(new AppDB(`q-${n++}-${Math.random()}`));
  await seedIfNeeded();
  await db.variants.toCollection().modify({ forSale: true }); await db.settings.where('key').equals('initialOpening').delete(); // testes de regra vendem qualquer peça
});
const vid = async (g: string, v: string) => {
  const gr = (await db.groups.toArray()).find((x) => x.name === g)!;
  return (await db.variants.where('groupId').equals(gr.id).toArray()).find((x) => x.name === v)!.id;
};
const qty = async (dayId: string, v: string) =>
  (await db.dailyStockItems.where('[dailyRecordId+variantId]').equals([dayId, v]).first())?.currentQuantity ?? 0;
const sell = (dayId: string, v: string, q: number, price: number | null, extra: Partial<Parameters<typeof createOrder>[0]> = {}) =>
  createOrder({ orderId: uid(), dailyRecordId: dayId, paymentMethod: 'dinheiro', lines: [{ variantId: v, quantity: q, unitPriceInCents: price }], ...extra });
const errors = async () => (await runDiagnostics()).findings.filter((f) => f.level === 'erro');

describe('entrada de valores absurdos', () => {
  it('toCents recusa lixo, negativos, notação científica e números gigantes', () => {
    for (const bad of ['-5', '1e5', '+70', '0x10', 'abc', '70,5,5', '1.2.3', '.', ',', '99999999999999', 'NaN', 'Infinity'])
      expect(toCents(bad), bad).toBeNull();
    expect(toCents(' 1 230 ')).toBe(123000);
    expect(toCents('0')).toBe(0);
    expect(toCents(-1)).toBeNull();
    expect(toCents(Number.NaN)).toBeNull();
  });
  it('venda com preço negativo, fracionado ou gigante é recusada', async () => {
    const d = await startDay('2026-10-31');
    const v = await vid('Broche', 'Branco');
    await expect(sell(d.id, v, 1, -7000)).rejects.toThrow(/Preço inválido/);
    await expect(sell(d.id, v, 1, 70.5)).rejects.toThrow(/Preço inválido/);
    await expect(sell(d.id, v, 1, 1e15)).rejects.toThrow(/Preço inválido/);
    await expect(sell(d.id, v, 2.5, 7000)).rejects.toThrow(/Quantidade/);
    await expect(sell(d.id, v, -3, 7000)).rejects.toThrow(/Quantidade/);
    await expect(sell(d.id, v, 1e9, 7000)).rejects.toThrow(/Quantidade/);
    expect(await qty(d.id, v)).toBe(30);
    expect(await db.orders.count()).toBe(0);
  });
  it('movimento de estoque absurdo é recusado', async () => {
    const d = await startDay('2026-10-31');
    const v = await vid('Broche', 'Branco');
    await expect(moveStock(d.id, v, 0, 'entrada')).rejects.toThrow();
    await expect(moveStock(d.id, v, 1.5, 'entrada')).rejects.toThrow();
    await expect(moveStock(d.id, v, 1e9, 'entrada')).rejects.toThrow();
    await expect(moveStock(d.id, v, -1, 'entrada')).rejects.toThrow();
    await expect(moveStock(d.id, v, 1, 'saida')).rejects.toThrow();
    await expect(moveStock(d.id, v, -31, 'saida')).rejects.toThrow(/negativo/);
    await expect(moveStock(d.id, v, 1, 'venda')).rejects.toThrow(/Tipo/);
    await expect(setStock(d.id, v, -1)).rejects.toThrow();
    await expect(setStock(d.id, 'nao-existe', 5)).rejects.toThrow(/não encontrada/);
    await expect(moveStock(d.id, 'nao-existe', 1, 'entrada')).rejects.toThrow(/não encontrada/);
    expect(await qty(d.id, v)).toBe(30);
  });
  it('caixa com valor zero, negativo, fracionado, tipo ou forma inválida é recusado', async () => {
    const d = await startDay('2026-10-31');
    for (const amountInCents of [0, -100, 10.5, 1e15])
      await expect(addCashMovement({ dailyRecordId: d.id, type: 'dar', amountInCents })).rejects.toThrow();
    await expect(addCashMovement({ dailyRecordId: d.id, type: 'venda' as never, amountInCents: 100 })).rejects.toThrow(/Tipo/);
    await expect(addCashMovement({ dailyRecordId: d.id, type: 'dar', amountInCents: 100, paymentMethod: 'bitcoin' as never })).rejects.toThrow(/Forma/);
    await expect(setCountedBalance(d.id, -5)).rejects.toThrow();
    await expect(setOpeningBalance(d.id, 1.5)).rejects.toThrow();
    expect(await db.cashMovements.count()).toBe(0);
  });
  it('datas inválidas não criam dia', async () => {
    for (const bad of ['', '2026-13-01', '2026-02-30', '31/10/2026', '1999-01-01', 'abc', '2026-1-1'])
      await expect(startDay(bad), bad).rejects.toThrow(/Data inválida/);
    expect(await db.dailyRecords.count()).toBe(0);
  });
  it('nomes vazios, só espaços, gigantes ou repetidos (com acento diferente) são recusados', async () => {
    await expect(createGroup({ name: '   ' })).rejects.toThrow();
    await expect(createGroup({ name: 'x'.repeat(41) })).rejects.toThrow(/longo/);
    await expect(createGroup({ name: 'plomo' })).rejects.toThrow(/Já existe/);
    await expect(createGroup({ name: '  Plômo ' })).rejects.toThrow(/Já existe/); // acento não engana a checagem
  });
});

describe('ordem errada e toque repetido', () => {
  it('vender, lançar ou mexer em dia encerrado ou inexistente é bloqueado', async () => {
    const d = await startDay('2026-10-31');
    const v = await vid('Lila', 'Azul');
    await closeDay(d.id);
    await expect(sell(d.id, v, 1, 7000)).rejects.toThrow(/encerrado/);
    await expect(addCashMovement({ dailyRecordId: d.id, type: 'dar', amountInCents: 100 })).rejects.toThrow(/encerrado/);
    await expect(createReservation({ dailyRecordId: d.id, variantId: v, quantity: 1 })).rejects.toThrow(/encerrado/);
    await expect(createVariant({ groupId: (await db.groups.toArray())[0].id, name: 'Nova', startQuantity: 3, dailyRecordId: d.id })).rejects.toThrow(/encerrado/);
    await expect(sell('dia-que-nao-existe', v, 1, 7000)).rejects.toThrow(/não encontrado/);
  });
  it('toque triplo em "Confirmar venda" registra uma venda só', async () => {
    const d = await startDay('2026-10-31');
    const v = await vid('Lila', 'Azul');
    const orderId = uid();
    const p = () => createOrder({ orderId, dailyRecordId: d.id, paymentMethod: 'pix', lines: [{ variantId: v, quantity: 1, unitPriceInCents: 7000 }] });
    await Promise.all([p(), p(), p()]);
    expect(await db.orders.count()).toBe(1);
    expect(await qty(d.id, v)).toBe(7);
    expect((await computeCash(d.id)).salesTotal).toBe(7000);
  });
  it('vender a mesma peça em duas linhas não passa do estoque', async () => {
    const d = await startDay('2026-10-31');
    const v = await vid('Plomo', 'Rosa'); // 1 peça
    await expect(createOrder({ orderId: uid(), dailyRecordId: d.id, paymentMethod: 'dinheiro',
      lines: [{ variantId: v, quantity: 1, unitPriceInCents: 7000 }, { variantId: v, quantity: 1, unitPriceInCents: 7000 }] })).rejects.toThrow(/Só há 1/);
  });
  it('duas vendas ao mesmo tempo da última peça: só uma passa', async () => {
    const d = await startDay('2026-10-31');
    const v = await vid('Plomo', 'Rosa');
    const r = await Promise.allSettled([sell(d.id, v, 1, 7000), sell(d.id, v, 1, 7000)]);
    expect(r.filter((x) => x.status === 'fulfilled').length).toBe(1);
    expect(await qty(d.id, v)).toBe(0);
  });
  it('cancelar duas vezes, desfazer duas vezes, converter reserva duas vezes: efeito único', async () => {
    const d = await startDay('2026-10-31');
    const v = await vid('Lila', 'Verde');
    const o = await sell(d.id, v, 2, 7000);
    await Promise.all([cancelOrder(o.id), cancelOrder(o.id)]);
    expect(await qty(d.id, v)).toBe(4);
    expect((await computeCash(d.id)).salesTotal).toBe(0);
    const mv = await moveStock(d.id, v, 3, 'entrada');
    await undoMovement(mv.id);
    await expect(undoMovement(mv.id)).rejects.toThrow();
    const res = await createReservation({ dailyRecordId: d.id, variantId: v, quantity: 2 });
    const oid = uid();
    await convertReservation({ reservationId: res.id, dailyRecordId: d.id, unitPriceInCents: 7000, paymentMethod: 'pix', orderId: oid });
    await expect(convertReservation({ reservationId: res.id, dailyRecordId: d.id, unitPriceInCents: 7000, paymentMethod: 'pix', orderId: uid() })).rejects.toThrow(/não está ativa/);
    expect(await qty(d.id, v)).toBe(2);
    expect(await errors()).toEqual([]);
  });
  it('desfazer registro de reserva (não mexe no estoque) é recusado', async () => {
    const d = await startDay('2026-10-31');
    const v = await vid('Lila', 'Verde');
    await createReservation({ dailyRecordId: d.id, variantId: v, quantity: 1 });
    const mv = (await db.stockMovements.toArray()).find((m) => m.type === 'reserva')!;
    await expect(undoMovement(mv.id)).rejects.toThrow(/não mexe/);
  });
  it('venda forjada dizendo que vem de reserva de outra peça é recusada', async () => {
    const d = await startDay('2026-10-31');
    const a = await vid('Lila', 'Verde'), b = await vid('Lila', 'Azul');
    const r = await createReservation({ dailyRecordId: d.id, variantId: a, quantity: 1 });
    await expect(createOrder({ orderId: uid(), dailyRecordId: d.id, paymentMethod: 'pix',
      lines: [{ variantId: b, quantity: 8, unitPriceInCents: 1, reservationId: r.id }] })).rejects.toThrow(/não confere/);
  });
  it('apagar lançamento de venda pelo caixa é bloqueado (só cancelando a venda)', async () => {
    const d = await startDay('2026-10-31');
    await sell(d.id, await vid('Lila', 'Verde'), 1, 7000);
    const m = (await db.cashMovements.toArray())[0];
    await expect(removeCashMovement(m.id)).rejects.toThrow(/cancele a venda/);
  });
});

describe('pagamento dividido, correção de valor e reserva de volta', () => {
  it('dividido precisa somar o total; entra um lançamento por forma; cancelar estorna as duas', async () => {
    const d = await startDay('2026-10-31');
    const v = await vid('Broche', 'Poa');
    await expect(sell(d.id, v, 2, 7000, { payments: [{ method: 'pix', amountInCents: 10000 }, { method: 'dinheiro', amountInCents: 3000 }] })).rejects.toThrow(/soma/);
    const o = await sell(d.id, v, 2, 7000, { payments: [{ method: 'pix', amountInCents: 10000 }, { method: 'dinheiro', amountInCents: 4000 }] });
    let c = await computeCash(d.id);
    expect([c.salesByMethod.pix, c.salesByMethod.dinheiro, c.cashOnHand]).toEqual([10000, 4000, 4000]);
    expect(o.paymentMethod).toBe('pix');
    const s = await daySummary(d.id, d.date);
    expect(notebookReport(d.date, s)).toContain('2x70 = 140 (Pix 100 + Dinheiro 40)');
    await cancelOrder(o.id);
    c = await computeCash(d.id);
    expect([c.salesByMethod.pix, c.salesByMethod.dinheiro]).toEqual([0, 0]);
    expect(await errors()).toEqual([]);
  });
  it('corrigir valor: aumenta e diminui sem deixar forma negativa', async () => {
    const d = await startDay('2026-10-31');
    const v = await vid('Broche', 'Poa');
    const o = await sell(d.id, v, 2, null); // vendeu sem preço
    const [line] = await db.sales.where('orderId').equals(o.id).toArray();
    await correctOrderPrices(o.id, { [line.id]: 7000 });
    expect((await computeCash(d.id)).salesTotal).toBe(14000);
    await correctOrderPrices(o.id, { [line.id]: 6000 });
    expect((await computeCash(d.id)).salesTotal).toBe(12000);
    expect((await db.orders.get(o.id))!.totalInCents).toBe(12000);
    await expect(correctOrderPrices(o.id, { [line.id]: -1 })).rejects.toThrow();
    expect(await errors()).toEqual([]);
    await cancelOrder(o.id);
    expect((await computeCash(d.id)).salesTotal).toBe(0);
    await expect(correctOrderPrices(o.id, { [line.id]: 7000 })).rejects.toThrow(/cancelada/);
    expect(await errors()).toEqual([]);
  });
  it('corrigir valor de venda dividida', async () => {
    const d = await startDay('2026-10-31');
    const v = await vid('Broche', 'Poa');
    const o = await sell(d.id, v, 1, 10000, { payments: [{ method: 'pix', amountInCents: 6000 }, { method: 'dinheiro', amountInCents: 4000 }] });
    const [line] = await db.sales.where('orderId').equals(o.id).toArray();
    await correctOrderPrices(o.id, { [line.id]: 2000 }); // devolve 8000: 6000 do pix e 2000 do dinheiro
    const c = await computeCash(d.id);
    expect([c.salesByMethod.pix, c.salesByMethod.dinheiro]).toEqual([0, 2000]);
    expect(await errors()).toEqual([]);
  });
  it('cancelar venda que veio de reserva pode devolver a reserva', async () => {
    const d = await startDay('2026-10-31');
    const v = await vid('Lila', 'Rosa');
    const r = await createReservation({ dailyRecordId: d.id, variantId: v, quantity: 2, customer: 'Ana' });
    const o = await convertReservation({ reservationId: r.id, dailyRecordId: d.id, unitPriceInCents: 7000, paymentMethod: 'pix', orderId: uid() });
    expect((await reservationsOfOrder(o.id)).length).toBe(1);
    await cancelOrder(o.id, { restoreReservations: true });
    expect((await db.reservations.get(r.id))!.status).toBe('active');
    const row = (await loadStockRows(d.id, d.date)).find((x) => x.variant.id === v)!;
    expect([row.item.currentQuantity, row.reserved, row.available]).toEqual([5, 2, 3]);
    await cancelReservation(r.id);
  });
});

describe('cadastro bagunçado', () => {
  it('reativar grupo/variação com nome que já voltou a existir é bloqueado', async () => {
    const plomo = (await db.groups.toArray()).find((g) => g.name === 'Plomo')!;
    await archiveGroup(plomo.id, true);
    await createGroup({ name: 'Plomo' });
    await expect(archiveGroup(plomo.id, false)).rejects.toThrow(/Já existe outro/);
    const v = await vid('Lila', 'Azul');
    await archiveVariant(v, true);
    await createVariant({ groupId: (await db.variants.get(v))!.groupId, name: 'Azul' });
    await expect(archiveVariant(v, false)).rejects.toThrow(/outra/);
  });
  it('transferir variações para grupo com nomes iguais é bloqueado; para o mesmo grupo também', async () => {
    const lila = (await db.groups.toArray()).find((g) => g.name === 'Lila')!;
    const azul = (await db.groups.toArray()).find((g) => g.name === 'Azul')!;
    await expect(transferVariants(lila.id, azul.id)).rejects.toThrow(/já tem/);
    await expect(transferVariants(lila.id, lila.id)).rejects.toThrow();
    await expect(moveVariant(await vid('Lila', 'Verde'), azul.id)).rejects.toThrow(/já tem/);
  });
  it('cadastrar "Broche Rey" pendente quando já existe um grupo com esse nome só liga a seleção', async () => {
    const g = await createGroup({ name: 'Broche Rey' });
    const linked = await registerPendingSellGroup('Broche Rey');
    expect(linked.id).toBe(g.id);
    expect((await getSetting('sellGroups')).some((s) => s.groupId === g.id && !s.pendingName)).toBe(true);
  });
  it('renomear para nome com espaços extras normaliza', async () => {
    const g = (await db.groups.toArray())[0];
    await updateGroup(g.id, { name: '   Plomo    Premium  ' });
    expect((await db.groups.get(g.id))!.name).toBe('Plomo Premium');
  });
});

describe('dias fora de ordem', () => {
  it('lançar um dia antes do primeiro dia usa a carga do cadastro (não zera)', async () => {
    await startDay('2026-10-31');
    const early = await startDay('2026-10-20');
    expect(early.sourceDate).toBeNull();
    expect((await loadStockRows(early.id, early.date)).reduce((s, r) => s + r.item.currentQuantity, 0)).toBe(238);
    expect(await previousDay('2026-10-31')).toBeTruthy();
  });
  it('dia no meio de dois existentes copia do anterior certo', async () => {
    const v = await vid('Broche', 'Branco');
    const d1 = await startDay('2026-10-28');
    await sell(d1.id, v, 5, 7000);
    await startDay('2026-10-31');
    const mid = await startDay('2026-10-29');
    expect(mid.sourceDate).toBe('2026-10-28');
    expect(await qty(mid.id, v)).toBe(25);
  });
});

describe('backup e transferência para outro celular', () => {
  it('transferência completa: tudo chega igual no outro "celular"', async () => {
    const d1 = await startDay('2026-10-30');
    const v = await vid('Plomo', 'Vermelho');
    await sell(d1.id, v, 2, 7000, { customer: 'Ana' });
    await addCashMovement({ dailyRecordId: d1.id, type: 'dar', amountInCents: 5000, person: 'Chico' });
    await closeDay(d1.id, 9000);
    const d2 = await startDay('2026-10-31');
    await sell(d2.id, v, 1, 8500, { payments: [{ method: 'pix', amountInCents: 5000 }, { method: 'dinheiro', amountInCents: 3500 }] });
    await createReservation({ dailyRecordId: d2.id, variantId: v, quantity: 1, customer: 'Bia' });
    const g = await createGroup({ name: 'Novidades' });
    await createVariant({ groupId: g.id, name: 'Roxo', startQuantity: 4, dailyRecordId: d2.id });
    const before = { wa: whatsappReport(d2.date, await daySummary(d2.id, d2.date)), csv: await buildCsv('historico') };
    const file = JSON.stringify(await buildBackup());

    useDatabase(new AppDB(`outro-celular-${Math.random()}`));
    await restoreBackup(JSON.parse(file));
    const day2 = (await db.dailyRecords.where('date').equals('2026-10-31').first())!;
    expect(whatsappReport(day2.date, await daySummary(day2.id, day2.date))).toBe(before.wa);
    expect(await buildCsv('historico')).toBe(before.csv);
    expect(await errors()).toEqual([]);
    // o novo celular continua funcionando: vende e inicia o dia seguinte
    await sell(day2.id, v, 1, 7000);
    const d3 = await startDay('2026-11-01');
    expect((await computeCash(d3.id)).opening).toBe((await computeCash(day2.id)).accumulated);
  });
  it('restauração com lixo nunca altera os dados atuais', async () => {
    const d = await startDay('2026-10-31');
    const ok = await buildBackup();
    const attacks: unknown[] = [
      null, 42, 'texto', [], {}, { format: 'ESTOQUE_BACKUP' }, { ...ok, version: 99 },
      { ...ok, data: { ...ok.data, groups: 'x' } },
      { ...ok, checksum: 'deadbeef' },
      (() => { const b = structuredClone(ok); b.checksum = ''; b.data.dailyStockItems.push({ ...b.data.dailyStockItems[0], id: 'dup' }); b.counts.dailyStockItems++; return b; })(),
      (() => { const b = structuredClone(ok); b.checksum = ''; b.data.dailyRecords[0].date = '31/10/2026'; return b; })(),
      (() => { const b = structuredClone(ok); b.checksum = ''; b.data.cashMovements.push({ id: 'z', dailyRecordId: d.id, amountInCents: 1.5 }); b.counts.cashMovements++; return b; })(),
      (() => { const b = structuredClone(ok); b.checksum = ''; b.data.variants[0].groupId = 'fantasma'; return b; })(),
    ];
    for (const a of attacks) await expect(restoreBackup(a)).rejects.toThrow();
    expect(await db.dailyRecords.count()).toBe(1);
    expect(await db.variants.count()).toBe(51);
    expect(() => validateBackup(ok)).not.toThrow();
  });
  it('backup em texto comprimido: pequeno, colado fora de ordem, com quebras do WhatsApp, e recusa misturado', async () => {
    const d = await startDay('2026-10-31');
    for (let i = 0; i < 20; i++) await sell(d.id, await vid('Broche', 'Branco'), 1, 7000);
    const b = await buildBackup();
    const parts = await encodeTextBackup(b, 3000);
    expect(parts[0]).toMatch(/ gz\n/);
    expect(parts.join('').length).toBeLessThan(JSON.stringify(b).length / 3);
    const messy = [...parts].reverse().map((p) => p.replace(/(.{60})/g, '$1\n')).join('\n\nmensagem qualquer no meio\n\n');
    const back = await decodeTextBackup(messy);
    expect(back.data.orders.length).toBe(20);
    const other = await encodeTextBackup({ ...b, exportedAt: 'outro' }, 3000);
    if (parts.length > 1) await expect(decodeTextBackup(parts[0] + '\n' + other[1])).rejects.toThrow(/diferentes/);
    await expect(decodeTextBackup('oi tudo bem?')).rejects.toThrow(/não reconhecido/);
  });
});

describe('relatórios e planilhas com texto malicioso', () => {
  it('CSV não vira fórmula do Excel; relatório aguenta nomes estranhos', async () => {
    const d = await startDay('2026-10-31');
    const g = await createGroup({ name: '=HYPERLINK("x")' });
    const v = await createVariant({ groupId: g.id, name: '<b>"; DROP', startQuantity: 3, dailyRecordId: d.id });
    await db.variants.toCollection().modify({ forSale: true }); await db.settings.where('key').equals('initialOpening').delete();
    await sell(d.id, v.id, 1, 7000, { customer: '+5511;"Ana"\n' });
    const csv = await buildCsv('vendas');
    expect(csv).toContain(`'=HYPERLINK`);
    expect(csv).not.toMatch(/;=HYPERLINK/);
    const wa = whatsappReport(d.date, await daySummary(d.id, d.date));
    expect(wa).toContain('<b>"; DROP');
  });
  it('números muito grandes formatam sem perder precisão', () => {
    expect(money(99_999_999_999)).toBe('999.999.999,99');
    expect(money(-150)).toBe('-1,50');
  });
});

describe('voltar atrás', () => {
  it('desfazer o início do dia só sem lançamentos; depois escolhe de novo', async () => {
    const { undoStartDay } = await import('../services/days');
    const d = await startDay('2026-10-31', 'blank');
    await undoStartDay(d.id);
    expect(await db.dailyRecords.count()).toBe(0);
    const again = await startDay('2026-10-31', 'copy');
    expect((await loadStockRows(again.id, again.date)).reduce((s, r) => s + r.item.currentQuantity, 0)).toBe(238);
    await sell(again.id, await vid('Lila', 'Azul'), 1, 7000);
    await expect(undoStartDay(again.id)).rejects.toThrow(/já tem lançamentos/);
  });
  it('recebeu dados de outro celular e se arrependeu: volta como estava, e dá para refazer', async () => {
    const { undoLastRestore, getSafetyCopy } = await import('../services/backup');
    const d = await startDay('2026-10-31');
    await sell(d.id, await vid('Lila', 'Azul'), 1, 7000);
    const mine = await buildBackup();
    // "outro celular" com outros dados
    useDatabase(new AppDB(`outro-${Math.random()}`));
    await seedIfNeeded();
    await db.variants.toCollection().modify({ forSale: true }); await db.settings.where('key').equals('initialOpening').delete();
    const o = await startDay('2026-10-25');
    await sell(o.id, await vid('Broche', 'Branco'), 3, 7500);
    const other = await buildBackup();
    // volta para "meu celular" e recebe o do outro
    useDatabase(new AppDB(`meu-${Math.random()}`));
    await restoreBackup(mine, { keepSafety: false });
    await restoreBackup(other);
    expect((await db.dailyRecords.toArray()).map((x) => x.date)).toEqual(['2026-10-25']);
    expect((await getSafetyCopy())?.summary).toContain('1 dia');
    await undoLastRestore();
    expect((await db.dailyRecords.toArray()).map((x) => x.date)).toEqual(['2026-10-31']);
    await undoLastRestore(); // mudou de ideia de novo
    expect((await db.dailyRecords.toArray()).map((x) => x.date)).toEqual(['2026-10-25']);
    expect(await errors()).toEqual([]);
  });
});

describe('peça guardada (fora da venda)', () => {
  it('não aparece para vender, não vende nem reserva; continua no estoque; volta à venda', async () => {
    const { setForSale } = await import('../services/catalog');
    const d = await startDay('2026-10-31');
    const v = await vid('Broche', 'Branco');
    await setForSale([v], false);
    await expect(sell(d.id, v, 1, 7000)).rejects.toThrow(/guardada/);
    await expect(createReservation({ dailyRecordId: d.id, variantId: v, quantity: 1 })).rejects.toThrow(/guardada/);
    expect(await qty(d.id, v)).toBe(30);
    const s = await daySummary(d.id, d.date);
    expect(s.totalUnits).toBe(238); // continua contando no estoque
    await setForSale([v], true);
    await sell(d.id, v, 1, 7000);
    expect(await qty(d.id, v)).toBe(29);
    expect(await errors()).toEqual([]);
  });
  it('reserva feita antes de guardar ainda pode ser convertida', async () => {
    const { setForSale } = await import('../services/catalog');
    const d = await startDay('2026-10-31');
    const v = await vid('Lila', 'Rosa');
    const r = await createReservation({ dailyRecordId: d.id, variantId: v, quantity: 1, customer: 'Ana' });
    await setForSale([v], false);
    await convertReservation({ reservationId: r.id, dailyRecordId: d.id, unitPriceInCents: 7000, paymentMethod: 'pix', orderId: uid() });
    expect(await qty(d.id, v)).toBe(4);
  });
});
