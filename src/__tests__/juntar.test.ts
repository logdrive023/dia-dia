/**
 * Juntar celulares — teste maluco: dois celulares (cada um com os próprios identificadores, como na vida real)
 * fazem centenas de ações aleatórias e de tempos em tempos trocam o código (texto base64 de verdade) nos dois sentidos.
 * Depois de cada troca, os dois têm que mostrar exatamente o mesmo caixa, estoque e vendas, sem erro no diagnóstico,
 * e importar o mesmo código de novo não pode mudar nada.
 */
import { describe, expect, it } from 'vitest';
import { AppDB, db, useDatabase } from '../db/db';
import { seedIfNeeded } from '../db/seed';
import type { PaymentMethod } from '../db/types';
import { addDays, uid } from '../lib/util';
import { moveStock, startDay } from '../services/days';
import { cancelOrder, cancelReservation, confirmPix, correctOrderPrices, createOrder, createReservation, pixStatus, swapSaleItem, type CartLine } from '../services/sales';
import { addCashMovement, ensureDailyPay, removeCashMovement } from '../services/cash';
import { UserError } from '../services/catalog';
import { computeCash, loadStockRows } from '../services/summary';
import { runDiagnostics } from '../services/diagnostics';
import { buildBackup, decodeTextBackup, encodeTextBackup } from '../services/backup';
import { mergeBackup } from '../services/sync';

function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const ROUNDS = Number((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.JUNTAR ?? 12);
const METHODS: PaymentMethod[] = ['dinheiro', 'pix', 'cartao', 'debito'];

interface Phone { name: string; db: AppDB; myOrders: Set<string> }
async function newPhone(name: string, notebook = false): Promise<Phone> {
  const p = { name, db: new AppDB(`${name}-${Math.random()}`), myOrders: new Set<string>() };
  useDatabase(p.db);
  await seedIfNeeded();
  await db.variants.toCollection().modify({ forSale: true });
  if (!notebook) await db.settings.where('key').equals('initialOpening').delete();
  return p;
}
const on = (p: Phone) => useDatabase(p.db);

/** Código de um celular → colado no outro (texto de verdade, com as partes). */
async function sync(from: Phone, to: Phone) {
  on(from);
  const code = (await encodeTextBackup(await buildBackup())).join('\n\n');
  on(to);
  return mergeBackup(await decodeTextBackup(code));
}

/** Foto do que a pessoa vê, por nome (cada celular tem identificadores diferentes). */
async function snapshot(p: Phone) {
  on(p);
  const groups = new Map((await db.groups.toArray()).map((g) => [g.id, g.name]));
  const vname = new Map((await db.variants.toArray()).map((v) => [v.id, `${groups.get(v.groupId)} ${v.name}`]));
  const days = (await db.dailyRecords.orderBy('date').toArray());
  const out: Record<string, unknown> = {};
  for (const d of days) {
    const c = await computeCash(d.id);
    out[`caixa ${d.date}`] = [c.opening, c.salesTotal, c.salesByMethod, c.entradas, c.darTotal, c.despesas, c.pagamentos, c.accumulated, c.cashOnHand];
    const st: Record<string, number> = {};
    for (const r of await loadStockRows(d.id, d.date)) if (r.item.currentQuantity || r.item.initialQuantity) st[vname.get(r.variant.id)!] = r.item.currentQuantity;
    out[`estoque ${d.date}`] = st;
  }
  const orders = (await db.orders.toArray()).map((o) => `${o.id}|${o.status}|${o.totalInCents}|${pixStatus(o).kind}`).sort();
  out.vendas = orders;
  out.reservas = (await db.reservations.toArray()).map((r) => `${r.id}|${r.status}`).sort();
  return out;
}
async function noErrors(p: Phone, where: string) {
  on(p);
  const e = (await runDiagnostics()).findings.filter((f) => f.level === 'erro');
  if (e.length) console.log(where, p.name, JSON.stringify(e, null, 1));
  expect(e, `${where} ${p.name}: diagnóstico`).toEqual([]);
}

/** Uma ação aleatória no celular (válida ou recusada com mensagem). */
async function randomAction(p: Phone, rand: () => number, dayId: string) {
  on(p);
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
  const vs = (await db.variants.toArray()).filter((v) => !v.archivedAt);
  const mine = [...p.myOrders];
  const r = rand();
  try {
    if (r < 0.35 || !mine.length) {
      const each = rand() < 0.4;
      const lines: CartLine[] = Array.from({ length: 1 + Math.floor(rand() * 3) }, () => ({
        variantId: pick(vs).id, quantity: 1 + Math.floor(rand() * 2), unitPriceInCents: rand() < 0.1 ? null : 5000 + Math.floor(rand() * 4000),
        ...(each ? { paymentMethod: pick(METHODS) } : {}),
      }));
      const o = await createOrder({ orderId: uid(), dailyRecordId: dayId, paymentMethod: pick(METHODS), lines });
      p.myOrders.add(o.id);
    } else if (r < 0.43) {
      await cancelOrder(pick(mine));
    } else if (r < 0.5) {
      const id = pick(mine);
      const ls = await db.sales.where('orderId').equals(id).toArray();
      await correctOrderPrices(id, Object.fromEntries(ls.filter(() => rand() < 0.6).map((l) => [l.id, 4000 + Math.floor(rand() * 6000)])));
    } else if (r < 0.56) {
      const id = pick(mine);
      const l = pick((await db.sales.where('orderId').equals(id).toArray()).filter((x) => x.status === 'ok'));
      if (l) await swapSaleItem(l.id, pick(vs).id, 1);
    } else if (r < 0.62) {
      await confirmPix(pick(mine));
    } else if (r < 0.75) {
      await addCashMovement({ dailyRecordId: dayId, type: pick(['dar', 'entrada', 'despesa', 'pagamento'] as const), amountInCents: 1000 + Math.floor(rand() * 9000), person: 'Chico', quantity: 1 });
    } else if (r < 0.8) {
      const manual = (await db.cashMovements.where('dailyRecordId').equals(dayId).toArray()).filter((m) => !m.relatedOrderId);
      if (manual.length) await removeCashMovement(pick(manual).id);
    } else if (r < 0.86) {
      await moveStock(dayId, pick(vs).id, rand() < 0.5 ? 1 : -1, rand() < 0.5 ? 'entrada' : 'saida');
    } else if (r < 0.92) {
      await createReservation({ dailyRecordId: dayId, variantId: pick(vs).id, quantity: 1, customer: 'Ana' });
    } else if (r < 0.96) {
      const res = (await db.reservations.toArray()).filter((x) => x.status === 'active');
      if (res.length) await cancelReservation(pick(res).id, dayId);
    } else {
      await ensureDailyPay(dayId, (await db.dailyRecords.get(dayId))!.date);
    }
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
  }
}

describe('juntar celulares', () => {
  it('exemplo: Samsung vende 3, iPhone vende 2 → juntando nos dois sentidos, os dois mostram as 5', async () => {
    const sam = await newPhone('samsung'), iph = await newPhone('iphone');
    on(sam); const ds = await startDay('2026-11-01');
    const vS = (await db.variants.toArray()).find((v) => v.startQuantity >= 5)!;
    for (let i = 0; i < 3; i++) await createOrder({ orderId: uid(), dailyRecordId: ds.id, paymentMethod: 'dinheiro', lines: [{ variantId: vS.id, quantity: 1, unitPriceInCents: 7000 }] });
    on(iph); const di = await startDay('2026-11-01');
    const vI = (await db.variants.toArray()).find((v) => v.name === vS.name && v.startQuantity === vS.startQuantity)!;
    for (let i = 0; i < 2; i++) await createOrder({ orderId: uid(), dailyRecordId: di.id, paymentMethod: 'pix', lines: [{ variantId: vI.id, quantity: 1, unitPriceInCents: 7000 }] });
    await sync(sam, iph);
    await sync(iph, sam);
    for (const p of [sam, iph]) {
      on(p);
      const d = (await db.dailyRecords.toArray())[0];
      const c = await computeCash(d.id);
      expect([await db.orders.count(), c.salesByMethod.dinheiro, c.salesByMethod.pix], p.name).toEqual([5, 21000, 14000]);
      await noErrors(p, 'exemplo');
    }
    expect(await snapshot(sam)).toEqual(await snapshot(iph));
    // importar de novo não muda nada
    const again = await sync(sam, iph);
    expect([again.orders, again.cash, again.days, again.moves]).toEqual([0, 0, 0, 0]);
  });

  it('caderno e diária nos dois celulares não duplicam; o que foi apagado (✕) não volta', async () => {
    const a = await newPhone('a', true), b = await newPhone('b', true);
    on(a); const da = await startDay('2026-11-01'); await ensureDailyPay(da.id, '2026-11-01');
    on(b); const dbb = await startDay('2026-11-01'); await ensureDailyPay(dbb.id, '2026-11-01');
    // b não recebeu a diária de hoje: tira no ✕
    const diaria = (await db.cashMovements.toArray()).find((m) => m.description === 'diária de 01/11')!;
    await removeCashMovement(diaria.id);
    await sync(a, b); await sync(b, a);
    for (const p of [a, b]) {
      on(p);
      const d31 = (await db.dailyRecords.where('date').equals('2026-10-31').first())!;
      const c31 = await computeCash(d31.id);
      expect([c31.notebookCount, c31.pagamentos, c31.cashOnHand], `${p.name} 31/10`).toEqual([11, 30000, 123000]);
      await noErrors(p, 'caderno');
    }
    // a diária de 01/11: o b apagou, mas a do a é outro lançamento (o a recebeu): fica uma, não duas
    const pays = async (p: Phone) => { on(p); const d = (await db.dailyRecords.where('date').equals('2026-11-01').first())!; return (await computeCash(d.id)).pagamentos; };
    expect(await pays(a)).toBe(await pays(b));
    expect(await pays(a)).toBeLessThanOrEqual(15000);
    expect(await snapshot(a)).toEqual(await snapshot(b));
  });

  it('venda feita num celular e cancelada no outro: fica cancelada nos dois', async () => {
    const a = await newPhone('a2'), b = await newPhone('b2');
    on(a); const da = await startDay('2026-11-01');
    const v = (await db.variants.toArray()).find((x) => x.startQuantity >= 3)!;
    const o = await createOrder({ orderId: uid(), dailyRecordId: da.id, paymentMethod: 'pix', lines: [{ variantId: v.id, quantity: 1, unitPriceInCents: 7000 }] });
    on(b); await startDay('2026-11-01');
    await sync(a, b);
    on(b); await cancelOrder(o.id);
    await sync(b, a);
    on(a); expect((await db.orders.get(o.id))!.status).toBe('cancelled');
    expect(await snapshot(a)).toEqual(await snapshot(b));
    await noErrors(a, 'cancelada'); await noErrors(b, 'cancelada');
  });

  it(`teste maluco: ${ROUNDS} rodadas de ações aleatórias nos dois celulares, juntando nos dois sentidos`, async () => {
    const rand = rng(20261101);
    const a = await newPhone('maluco-a'), b = await newPhone('maluco-b');
    let date = '2026-11-01';
    const dayOf = async (p: Phone) => { on(p); return (await db.dailyRecords.where('date').equals(date).first())?.id ?? (await startDay(date)).id; };
    let actions = 0;
    for (let round = 0; round < ROUNDS; round++) {
      // novo dia de vez em quando (logo depois de juntar, como na vida real)
      if (round > 0 && rand() < 0.3) date = addDays(date, 1);
      const da = await dayOf(a), dbb = await dayOf(b);
      const n = 20 + Math.floor(rand() * 30);
      // cada ação acontece num dos celulares, no dia daquele celular
      for (let i = 0; i < n; i++) { const onA = rand() < 0.5; await randomAction(onA ? a : b, rand, onA ? da : dbb); actions++; }
      await sync(a, b);
      await sync(b, a);
      await noErrors(a, `rodada ${round}`);
      await noErrors(b, `rodada ${round}`);
      expect(await snapshot(a), `rodada ${round}: os dois celulares iguais`).toEqual(await snapshot(b));
      const again = await sync(a, b);
      expect([again.orders, again.cash, again.moves, again.days], `rodada ${round}: importar de novo não muda`).toEqual([0, 0, 0, 0]);
    }
    console.log(`juntar: ${ROUNDS} rodadas · ${actions} ações aleatórias · ${(await snapshot(a)).vendas instanceof Array ? ((await snapshot(a)).vendas as string[]).length : 0} vendas iguais nos dois celulares`);
  }, 600_000);
});
