/**
 * 10 dias seguidos de uso intenso. Um "modelo" independente (contas feitas à mão, em memória)
 * acompanha cada operação; no fim de cada dia o app tem de bater com o modelo em tudo:
 * estoque por peça, reservas, caixa total, dinheiro na mão, vendas por forma, relatórios e diagnóstico.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { AppDB, db, useDatabase } from '../db/db';
import { seedIfNeeded } from '../db/seed';
import type { PaymentMethod } from '../db/types';
import { addDays, money, uid } from '../lib/util';
import { archiveVariant, createGroup, createVariant } from '../services/catalog';
import { closeDay, moveStock, reopenDay, resyncFromPrevious, setStock, startDay, undoMovement } from '../services/days';
import { cancelOrder, cancelReservation, convertReservation, correctOrderPrices, createOrder, createReservation } from '../services/sales';
import { addCashMovement, removeCashMovement, setCountedBalance, setOpeningBalance } from '../services/cash';
import { computeCash, daySummary, loadStockRows, syncGap } from '../services/summary';
import { buildBackup, decodeTextBackup, encodeTextBackup, restoreBackup } from '../services/backup';
import { buildCsv } from '../services/csv';
import { runDiagnostics } from '../services/diagnostics';
import { notebookReport, whatsappReport } from '../services/report';

// sorteio determinístico (o teste é sempre igual)
function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const R = rng(20261031);
const pick = <T,>(a: T[]) => a[Math.floor(R() * a.length)];
const chance = (p: number) => R() < p;
const int = (a: number, b: number) => a + Math.floor(R() * (b - a + 1));

// ---------------- modelo independente ----------------
const M = {
  stock: new Map<string, number>(),
  reserved: new Map<string, { id: string; v: string; q: number; customer: string }>(),
  total: 0, // saldo do caixa (todas as formas)
  hand: 0, // dinheiro vivo
  sales: { dinheiro: 0, pix: 0, cartao: 0, debito: 0, outro: 0 } as Record<PaymentMethod, number>,
  orders: [] as { id: string; v: string; q: number; total: number; pays: { method: PaymentMethod; amount: number }[]; lineId?: string }[],
};
const reservedOf = (v: string) => [...M.reserved.values()].filter((r) => r.v === v).reduce((s, r) => s + r.q, 0);
const avail = (v: string) => (M.stock.get(v) ?? 0) - reservedOf(v);
const addMoney = (method: PaymentMethod, amount: number, sale = true) => {
  M.total += amount; if (method === 'dinheiro') M.hand += amount; if (sale) M.sales[method] += amount;
};

const log: string[] = [];
const START = '2026-10-22';

describe('10 dias de uso intenso', () => {
  beforeAll(async () => {
    useDatabase(new AppDB(`dez-dias-${Math.random()}`));
    await seedIfNeeded();
    await db.variants.toCollection().modify({ forSale: true }); await db.settings.where('key').equals('initialOpening').delete();
    for (const v of await db.variants.toArray()) M.stock.set(v.id, v.startQuantity);
  });

  it('cada dia bate com o modelo; dia seguinte começa de onde parou', async () => {
    let prevAccumulated = 0;
    let prevHand = 0;
    let firstDayManualOpening = true;
    let newVariant: string | null = null;

    for (let d = 0; d < 10; d++) {
      const date = addDays(START, d);
      const day = await startDay(date);
      // estoque copiado do dia anterior = modelo
      for (const r of await loadStockRows(day.id, day.date)) expect(r.item.initialQuantity, `${date} início ${r.variant.name}`).toBe(M.stock.get(r.variant.id) ?? 0);
      const c0 = await computeCash(day.id);
      expect(c0.opening, `${date} ontem`).toBe(prevAccumulated);
      expect(c0.openingCash, `${date} dinheiro de ontem`).toBe(prevHand);
      M.sales = { dinheiro: 0, pix: 0, cartao: 0, debito: 0, outro: 0 };
      M.orders = [];

      // 1º dia: caixa já tinha 645 na gaveta (Ontem digitado à mão)
      if (firstDayManualOpening) {
        await setOpeningBalance(day.id, 64500);
        M.total = 64500; M.hand = 64500; firstDayManualOpening = false;
      }

      // dia 5: chega um modelo novo
      if (d === 4) {
        const g = await createGroup({ name: 'Novidades' });
        newVariant = (await createVariant({ groupId: g.id, name: 'Lilás', startQuantity: 10, dailyRecordId: day.id })).id;
        M.stock.set(newVariant, 10);
        await db.variants.toCollection().modify({ forSale: true }); await db.settings.where('key').equals('initialOpening').delete();
        log.push(`${date}: cadastrou Novidades Lilás com 10`);
      }

      // reservas de dias anteriores: converte ou cancela algumas
      for (const r of [...M.reserved.values()]) {
        if (chance(0.4)) {
          const price = pick([7000, 7500]);
          const o = await convertReservation({ reservationId: r.id, dailyRecordId: day.id, unitPriceInCents: price, paymentMethod: 'pix', orderId: uid() });
          M.reserved.delete(r.id);
          M.stock.set(r.v, M.stock.get(r.v)! - r.q);
          addMoney('pix', price * r.q);
          M.orders.push({ id: o.id, v: r.v, q: r.q, total: price * r.q, pays: [{ method: 'pix', amount: price * r.q }] });
        } else if (chance(0.25)) {
          await cancelReservation(r.id);
          M.reserved.delete(r.id);
        }
      }

      // vendas do dia
      const variants = (await db.variants.toArray()).filter((v) => !v.archivedAt).map((v) => v.id);
      const nSales = int(6, 14);
      for (let i = 0; i < nSales; i++) {
        const candidates = variants.filter((v) => avail(v) > 0);
        if (!candidates.length) break;
        const v = pick(candidates);
        const q = Math.min(int(1, 2), avail(v));
        const price = chance(0.05) ? null : pick([7000, 7000, 7000, 7500, 8500]);
        const total = (price ?? 0) * q;
        let pays: { method: PaymentMethod; amount: number }[] = [];
        let method: PaymentMethod = pick(['dinheiro', 'dinheiro', 'pix', 'pix', 'cartao']);
        if (total > 0 && chance(0.15)) {
          const part = Math.floor(total / 2 / 100) * 100;
          pays = [{ method: 'pix', amount: part }, { method: 'dinheiro', amount: total - part }];
          method = pays[0].amount >= pays[1].amount ? 'pix' : 'dinheiro';
        } else if (total > 0) pays = [{ method, amount: total }];
        const orderId = uid();
        // toque duplo em metade das vendas
        const go = () => createOrder({ orderId, dailyRecordId: day.id, paymentMethod: method, customer: chance(0.3) ? pick(['Ana', 'Bia', 'Carla']) : undefined,
          lines: [{ variantId: v, quantity: q, unitPriceInCents: price }],
          payments: pays.length > 1 ? pays.map((p) => ({ method: p.method, amountInCents: p.amount })) : undefined });
        if (chance(0.5)) await Promise.all([go(), go()]); else await go();
        M.stock.set(v, M.stock.get(v)! - q);
        for (const p of pays) addMoney(p.method, p.amount);
        const [line] = await db.sales.where('orderId').equals(orderId).toArray();
        M.orders.push({ id: orderId, v, q, total, pays, lineId: line.id });
      }

      // corrige o preço de uma venda (ou dá preço à que ficou sem)
      const fixable = M.orders.filter((o) => o.lineId);
      if (fixable.length && chance(0.6)) {
        const o = pick(fixable);
        const newPrice = pick([6500, 7000, 8000]);
        const newTotal = newPrice * o.q;
        await correctOrderPrices(o.id, { [o.lineId!]: newPrice });
        const diff = newTotal - o.total;
        // a diferença a mais entra na forma principal da venda (a escolhida na hora de vender)
        const main = (await db.orders.get(o.id))!.paymentMethod;
        if (diff > 0) {
          addMoney(main, diff);
          const p = o.pays.find((x) => x.method === main) ?? (o.pays.push({ method: main, amount: 0 }), o.pays[o.pays.length - 1]);
          p.amount += diff;
        }
        else if (diff < 0) {
          // app devolve da forma principal da venda e depois das outras
          const order = (await db.orders.get(o.id))!;
          let rest = -diff;
          const sorted = [...o.pays].sort((a, b) => (a.method === order.paymentMethod ? -1 : b.method === order.paymentMethod ? 1 : 0));
          for (const p of sorted) { const take = Math.min(p.amount, rest); p.amount -= take; addMoney(p.method, -take); rest -= take; }
        }
        o.total = newTotal;
      }

      // cancela uma venda (às vezes)
      if (M.orders.length && chance(0.5)) {
        const o = M.orders.splice(Math.floor(R() * M.orders.length), 1)[0];
        await cancelOrder(o.id);
        M.stock.set(o.v, M.stock.get(o.v)! + o.q);
        for (const p of o.pays) addMoney(p.method, -p.amount);
      }

      // entrada de mercadoria
      const vIn = pick(variants);
      const nIn = int(1, 6);
      const mvIn = await moveStock(day.id, vIn, nIn, 'entrada');
      M.stock.set(vIn, M.stock.get(vIn)! + nIn);
      // toque errado: entra 1 a mais e desfaz
      if (chance(0.5)) {
        const extra = await moveStock(day.id, vIn, 1, 'entrada');
        await undoMovement(extra.id);
        expect(mvIn.newBalance).toBe(M.stock.get(vIn));
      }
      // perda / saída
      if (chance(0.5)) {
        const c = variants.filter((v) => avail(v) > 0);
        if (c.length) { const v = pick(c); await moveStock(day.id, v, -1, chance(0.5) ? 'perda' : 'saida'); M.stock.set(v, M.stock.get(v)! - 1); }
      }
      // ajuste por contagem
      if (chance(0.4)) {
        const v = pick(variants);
        const to = Math.max(reservedOf(v), (M.stock.get(v) ?? 0) + int(-1, 2));
        await setStock(day.id, v, to);
        M.stock.set(v, to);
      }
      // reserva nova
      if (chance(0.6)) {
        const c = variants.filter((v) => avail(v) >= 1);
        if (c.length) {
          const v = pick(c);
          const r = await createReservation({ dailyRecordId: day.id, variantId: v, quantity: 1, customer: pick(['Ana', 'Bia', 'Dani']) });
          M.reserved.set(r.id, { id: r.id, v, q: 1, customer: r.customer ?? '' });
        }
      }
      // dinheiro: dei, despesa, entrada, retirada; um lançamento errado removido
      if (chance(0.6)) { const a = pick([2000, 5000]); await addCashMovement({ dailyRecordId: day.id, type: 'dar', amountInCents: a, person: 'Chico' }); addMoney('dinheiro', -a, false); }
      if (chance(0.3)) { const a = 1500; await addCashMovement({ dailyRecordId: day.id, type: 'despesa', amountInCents: a, paymentMethod: 'pix' }); addMoney('pix', -a, false); }
      if (chance(0.2)) { const a = 3000; await addCashMovement({ dailyRecordId: day.id, type: 'entrada', amountInCents: a }); addMoney('dinheiro', a, false); }
      if (d % 3 === 2) { const a = 30000; await addCashMovement({ dailyRecordId: day.id, type: 'retirada', amountInCents: a }); addMoney('dinheiro', -a, false); }
      if (chance(0.3)) {
        const wrong = await addCashMovement({ dailyRecordId: day.id, type: 'despesa', amountInCents: 99900 });
        await removeCashMovement(wrong.id);
      }

      // dia 7: arquiva a peça nova que ainda tem estoque (o saldo não pode sumir)
      if (d === 6 && newVariant && !reservedOf(newVariant)) {
        await archiveVariant(newVariant, true);
        log.push(`${date}: arquivou Lilás com ${M.stock.get(newVariant)} peças`);
      }

      // dia 6: descobre que esqueceu uma venda ONTEM; corrige o dia anterior e atualiza hoje
      if (d === 5) {
        const yesterday = (await db.dailyRecords.where('date').equals(addDays(date, -1)).first())!;
        await reopenDay(yesterday.id);
        const v = variants.filter((x) => avail(x) > 0)[0];
        await createOrder({ orderId: uid(), dailyRecordId: yesterday.id, paymentMethod: 'dinheiro', lines: [{ variantId: v, quantity: 1, unitPriceInCents: 7000 }] });
        await closeDay(yesterday.id);
        // hoje: o caixa já acompanha sozinho; o estoque avisa e atualiza com 1 toque
        const gap = await syncGap(day.id);
        expect(gap?.units).toBe(1);
        await resyncFromPrevious(day.id);
        expect(await syncGap(day.id)).toBeNull();
        M.stock.set(v, M.stock.get(v)! - 1);
        M.total += 7000; M.hand += 7000;
        log.push(`${date}: corrigiu ${addDays(date, -1)} (+1 venda) e atualizou`);
      }

      // ---------------- conferência do dia ----------------
      const rows = await loadStockRows(day.id, day.date);
      for (const r of rows) {
        expect(r.item.currentQuantity, `${date} estoque ${r.group.name} ${r.variant.name}`).toBe(M.stock.get(r.variant.id) ?? 0);
        expect(r.reserved, `${date} reservado ${r.variant.name}`).toBe(reservedOf(r.variant.id));
        expect(r.item.currentQuantity).toBeGreaterThanOrEqual(0);
      }
      const c = await computeCash(day.id);
      expect(c.accumulated, `${date} saldo`).toBe(M.total);
      expect(c.cashOnHand, `${date} dinheiro na mão`).toBe(M.hand);
      expect(c.otherBalance).toBe(M.total - M.hand);
      expect(c.salesByMethod, `${date} vendas por forma`).toEqual(M.sales);
      await setCountedBalance(day.id, M.hand);
      expect((await computeCash(day.id)).difference).toBe(0);

      const s = await daySummary(day.id, day.date);
      const nb = notebookReport(day.date, s);
      const wa = whatsappReport(day.date, s);
      expect(nb.split('\n').filter((l) => l.startsWith('☐')).length, `${date} linhas do caderno`).toBe(s.orders.length);
      expect(wa).toContain(`Vendeu: *${money(c.salesTotal)}*`);
      expect(s.restockUnits).toBe(s.restock.reduce((n, r) => n + r.restock, 0));
      const diag = (await runDiagnostics()).findings.filter((f) => f.level === 'erro');
      expect(diag, `${date} diagnóstico`).toEqual([]);

      await closeDay(day.id, M.hand);
      prevAccumulated = M.total;
      prevHand = M.hand;
      log.push(`${date}: ${s.orders.length} vendas, ${s.soldUnits} peças, estoque ${s.totalUnits}, saldo ${M.total / 100}`);
    }
    expect(await db.dailyRecords.count()).toBe(10);
  }, 60000);

  it('no 10º dia passa tudo para "outro celular" e o novo continua igual', async () => {
    const lastDate = addDays(START, 9);
    const day = (await db.dailyRecords.where('date').equals(lastDate).first())!;
    const before = {
      wa: whatsappReport(lastDate, await daySummary(day.id, day.date)),
      hist: await buildCsv('historico'), mov: await buildCsv('movimentacoes'), cash: await buildCsv('caixa'),
    };
    const file = JSON.stringify(await buildBackup());
    const text = (await encodeTextBackup(await buildBackup())).join('\n');

    useDatabase(new AppDB(`celular-novo-${Math.random()}`));
    await restoreBackup(JSON.parse(file));
    const d2 = (await db.dailyRecords.where('date').equals(lastDate).first())!;
    expect(whatsappReport(lastDate, await daySummary(d2.id, d2.date))).toBe(before.wa);
    expect(await buildCsv('historico')).toBe(before.hist);
    expect(await buildCsv('movimentacoes')).toBe(before.mov);
    expect(await buildCsv('caixa')).toBe(before.cash);
    expect((await runDiagnostics()).findings.filter((f) => f.level === 'erro')).toEqual([]);

    // dia 11 no celular novo começa de onde o antigo parou
    const d11 = await startDay(addDays(lastDate, 1));
    expect((await computeCash(d11.id)).opening).toBe(M.total);
    for (const r of await loadStockRows(d11.id, d11.date)) expect(r.item.currentQuantity).toBe(M.stock.get(r.variant.id) ?? 0);

    // e o backup em texto também reconstrói tudo
    useDatabase(new AppDB(`celular-texto-${Math.random()}`));
    await restoreBackup(await decodeTextBackup(text));
    expect(await db.dailyRecords.count()).toBe(10);
    expect(await buildCsv('historico')).toBe(before.hist);
    console.log(log.join('\n'));
  }, 60000);
});
