import { db } from '../db/db';
import type { CashMovement, Credit, Order, Payment, PaymentMethod, Reservation, Sale } from '../db/types';
import { isCents, isQty, MAX_QTY, normalize, nowIso, PAYMENTS, uid } from '../lib/util';
import { audit } from './audit';
import { UserError } from './catalog';
import { applyStockDelta, assertLiveVariant, assertOpen, ensureItem, todayOpenDay } from './days';
import { fmtDate } from '../lib/util';
import { addTombstones } from './sync';
import { actor } from '../lib/actor';

export interface CartLine {
  variantId: string;
  quantity: number;
  unitPriceInCents: number | null;
  reservationId?: string;
  /** Forma de pagamento só desta peça (ex.: uma no Pix, outra no dinheiro). Vazio = a da venda. */
  paymentMethod?: PaymentMethod;
}

/** Soma das reservas ativas que pesam sobre uma data (criadas nesta data ou antes). */
export async function activeReservedByVariant(date: string, exceptIds: string[] = []) {
  const res = await db.reservations.where('status').equals('active').toArray();
  const map = new Map<string, number>();
  for (const r of res)
    if (r.date <= date && !exceptIds.includes(r.id)) map.set(r.variantId, (map.get(r.variantId) ?? 0) + r.quantity);
  return map;
}

const SALE_TABLES = () => [
  db.dailyRecords, db.dailyStockItems, db.stockMovements, db.variants, db.groups, db.orders, db.sales,
  db.cashMovements, db.reservations, db.auditLogs, db.settings, db.credits,
];

// ---------------- vale (crédito da cliente) ----------------

const customerKey = (name: string) => normalize(name.trim());

/** Saldo de vale da cliente (pelo nome). */
export async function creditBalance(customer: string | undefined | null) {
  const key = customer?.trim() ? customerKey(customer) : '';
  if (!key) return 0;
  return (await db.credits.where('customerKey').equals(key).toArray()).reduce((s, c) => s + c.amountInCents, 0);
}

/** Todas as clientes com vale (saldo > 0), maior primeiro. */
export async function creditBalances() {
  const by = new Map<string, { customer: string; cents: number }>();
  for (const c of await db.credits.toArray()) {
    const e = by.get(c.customerKey) ?? { customer: c.customer, cents: 0 };
    e.cents += c.amountInCents; by.set(c.customerKey, e);
  }
  return [...by.values()].filter((e) => e.cents > 0).sort((a, b) => b.cents - a.cents);
}

async function addCredit(customer: string | undefined, cents: number, dailyRecordId: string, orderId: string | null, note: string) {
  if (!cents) return;
  if (!customer?.trim()) throw new UserError('Para virar vale, a venda precisa ter o nome da cliente.');
  const c: Credit = { id: uid(), customer: customer.trim(), customerKey: customerKey(customer), amountInCents: cents, orderId, dailyRecordId, createdAt: nowIso(), note, by: actor() };
  await db.credits.add(c);
}

/**
 * O que a cliente já pagou nesta venda (dinheiro que ficou no caixa + vale usado − vale que ela ganhou de volta).
 * Venda normal: pago = total. Fiado: pago ≤ total (o resto ela deve).
 */
async function paidOf(orderId: string) {
  const cash = [...(await orderCashByMethod(orderId)).values()].reduce((a, b) => a + b, 0);
  const cr = await db.credits.where('orderId').equals(orderId).toArray();
  const used = -cr.filter((c) => c.amountInCents < 0).reduce((s, c) => s + c.amountInCents, 0);
  const issued = cr.filter((c) => c.amountInCents > 0).reduce((s, c) => s + c.amountInCents, 0);
  return { cash, used, issued, paid: cash - issued + used };
}

/** Fiado: quanto a cliente ainda deve desta venda. */
export async function owedOf(order: Order) {
  if (!order.fiado || order.status !== 'ok') return 0;
  return Math.max(0, order.totalInCents - (await paidOf(order.id)).paid);
}

/** Vendas fiado com saldo devedor (para a lista “Fiado a receber”). */
export async function openFiado() {
  const list: { order: Order; owed: number }[] = [];
  for (const o of await db.orders.filter((x) => !!x.fiado && x.status === 'ok').toArray()) {
    const owed = await owedOf(o);
    if (owed > 0) list.push({ order: o, owed });
  }
  return list.sort((a, b) => a.order.createdAt.localeCompare(b.order.createdAt));
}

/**
 * Devolve `cents` à cliente: primeiro abate o que ela ainda devia (fiado), depois vale (se escolheu) ou dinheiro
 * (na forma da peça, depois nas outras). O que não couber no dinheiro (venda paga com vale) volta como vale.
 */
async function refund(order: Order, cents: number, dayId: string, what: string, how: 'dinheiro' | 'vale', firstMethod?: PaymentMethod) {
  let rest = cents;
  if (order.fiado) rest -= Math.min(rest, await owedOf(order));
  if (rest <= 0) return;
  if (how === 'vale') { await addCredit(order.customer, rest, dayId, order.id, what); return; }
  const net = await orderCashByMethod(order.id);
  for (const m of [...new Set([...(firstMethod ? [firstMethod] : []), order.paymentMethod, ...PAYMENTS])]) {
    const take = Math.min(net.get(m) ?? 0, rest);
    if (take <= 0) continue;
    await db.cashMovements.add({ id: uid(), dailyRecordId: dayId, type: 'estorno', amountInCents: take, paymentMethod: m, relatedOrderId: order.id, createdAt: nowIso(), description: what });
    rest -= take;
    if (!rest) return;
  }
  if (rest > 0) await addCredit(order.customer, rest, dayId, order.id, `${what} (era vale)`);
}

function validateLine(l: CartLine) {
  if (!isQty(l.quantity)) throw new UserError(`Quantidade inválida (de 1 a ${MAX_QTY}).`);
  if (l.unitPriceInCents !== null && !isCents(l.unitPriceInCents)) throw new UserError('Preço inválido.');
  if (l.paymentMethod !== undefined && !PAYMENTS.includes(l.paymentMethod)) throw new UserError('Forma de pagamento inválida.');
}

/** Soma por forma quando cada peça tem a sua (só peças com preço entram no caixa). */
function paymentsByLine(lines: CartLine[], fallback: PaymentMethod): Payment[] {
  const sum = new Map<PaymentMethod, number>();
  for (const l of lines) {
    const m = l.paymentMethod ?? fallback;
    sum.set(m, (sum.get(m) ?? 0) + (l.unitPriceInCents ?? 0) * l.quantity);
  }
  return [...sum.entries()].filter(([, v]) => v > 0).map(([method, amountInCents]) => ({ method, amountInCents }));
}

/** Confere e normaliza o pagamento: uma forma só, ou dividido somando exatamente o total. */
function normalizePayments(total: number, method: PaymentMethod, payments?: Payment[]): Payment[] {
  if (!PAYMENTS.includes(method)) throw new UserError('Forma de pagamento inválida.');
  const list = (payments ?? []).filter((p) => p.amountInCents > 0);
  if (!list.length) return total > 0 ? [{ method, amountInCents: total }] : [];
  for (const p of list) {
    if (!PAYMENTS.includes(p.method) || !isCents(p.amountInCents)) throw new UserError('Pagamento dividido inválido.');
  }
  const sum = list.reduce((s, p) => s + p.amountInCents, 0);
  if (sum !== total) throw new UserError('A soma das formas de pagamento precisa dar o total da venda.');
  // junta formas repetidas (ex.: dois "Pix")
  const merged = new Map<PaymentMethod, number>();
  for (const p of list) merged.set(p.method, (merged.get(p.method) ?? 0) + p.amountInCents);
  return [...merged.entries()].map(([m, a]) => ({ method: m, amountInCents: a }));
}

/**
 * Registra uma venda (uma pessoa, várias peças). `orderId` é gerado quando o carrinho abre:
 * repetir o toque com o mesmo id não duplica a venda nem o recebimento.
 */
export async function createOrder(params: {
  orderId: string; dailyRecordId: string; lines: CartLine[]; paymentMethod: PaymentMethod;
  payments?: Payment[]; customer?: string; notes?: string;
  /** a cliente leva e paga depois (nada entra no caixa agora) */
  fiado?: boolean;
  /** quanto do total ela paga com o vale que tem */
  valeInCents?: number;
}): Promise<Order> {
  const lines = params.lines.filter((l) => l.quantity !== 0);
  if (!lines.length) throw new UserError('Adicione pelo menos uma peça.');
  lines.forEach(validateLine);
  const total = lines.reduce((s, l) => s + (l.unitPriceInCents ?? 0) * l.quantity, 0);
  if (!isCents(total)) throw new UserError('Total da venda inválido.');
  const vale = params.valeInCents ?? 0;
  const who = params.customer?.trim();
  if ((params.fiado || vale) && !who) throw new UserError(params.fiado ? 'Fiado precisa do nome da cliente.' : 'Para usar vale, diga o nome da cliente.');
  if (params.fiado && vale) throw new UserError('Fiado e vale na mesma venda não: escolha um.');
  if (vale && (!isCents(vale) || vale > total)) throw new UserError('Valor do vale inválido.');
  // cada peça com a sua forma: o pagamento é a soma por forma (o dividido manual não se aplica)
  const byLine = lines.some((l) => l.paymentMethod && l.paymentMethod !== params.paymentMethod);
  if (byLine && (params.fiado || vale)) throw new UserError('Fiado ou vale: use “Pagou tudo numa forma só”.');
  const pays = params.fiado ? [] : byLine
    ? normalizePayments(total, params.paymentMethod, paymentsByLine(lines, params.paymentMethod))
    : normalizePayments(total - vale, params.paymentMethod, params.payments);
  return db.transaction('rw', SALE_TABLES(), async () => {
    const dup = await db.orders.get(params.orderId);
    if (dup) return dup;
    const day = await assertOpen(params.dailyRecordId);

    // reservas sendo convertidas precisam existir, estar ativas e ser da mesma peça
    const converting = lines.map((l) => l.reservationId).filter(Boolean) as string[];
    for (const l of lines) if (l.reservationId) {
      const r = await db.reservations.get(l.reservationId);
      if (!r || r.status !== 'active') throw new UserError('Esta reserva não está mais ativa.');
      if (r.variantId !== l.variantId || l.quantity > r.quantity) throw new UserError('A venda não confere com a reserva.');
    }
    // disponibilidade: físico do dia - reservas ativas (as que estão sendo convertidas não contam)
    const reserved = await activeReservedByVariant(day.date, converting);
    const need = new Map<string, number>();
    for (const l of lines) need.set(l.variantId, (need.get(l.variantId) ?? 0) + l.quantity);
    for (const [variantId, qty] of need) {
      if (!(await db.variants.get(variantId))) throw new UserError('Uma das peças não existe mais no cadastro.');
      const v = await assertLiveVariant(variantId);
      if (v.forSale === false && !lines.some((l) => l.variantId === variantId && l.reservationId))
        throw new UserError(`${v.name} está guardada (fora da venda). Coloque à venda no Estoque.`);
      const item = await ensureItem(day.id, variantId);
      const available = item.currentQuantity - (reserved.get(variantId) ?? 0);
      if (qty > available) throw new UserError(`Só há ${Math.max(0, available)} disponível de ${v.name}.`);
    }

    if (vale && (await creditBalance(who)) < vale) throw new UserError(`${who} não tem esse valor de vale.`);
    const now = nowIso();
    const main = params.fiado ? 'dinheiro' : pays.slice().sort((a, b) => b.amountInCents - a.amountInCents)[0]?.method ?? params.paymentMethod;
    const order: Order = {
      id: params.orderId, dailyRecordId: day.id, customer: who?.slice(0, 80) || undefined,
      paymentMethod: main, payments: pays.length > 1 ? pays : undefined, totalInCents: total, ...(byLine ? { payByLine: true } : {}),
      itemCount: lines.reduce((s, l) => s + l.quantity, 0), status: 'ok', cashMovementId: null,
      createdAt: now, notes: params.notes,
      ...(params.fiado ? { fiado: true } : {}), ...(vale ? { valeInCents: vale } : {}),
    };
    // venda sem valor não gera receita fictícia; dividido = um recebimento por forma
    for (const p of pays) {
      const id = uid();
      if (!order.cashMovementId) order.cashMovementId = id;
      await db.cashMovements.add({
        id, dailyRecordId: day.id, type: 'venda', amountInCents: p.amountInCents, paymentMethod: p.method,
        relatedOrderId: order.id, createdAt: now, description: order.customer ? `Venda — ${order.customer}` : 'Venda',
      });
    }
    await db.orders.add({ ...order, by: actor() });
    if (vale) await addCredit(who, -vale, day.id, order.id, 'Usou na compra');
    const cost = new Map((await db.variants.bulkGet([...need.keys()])).map((v) => [v?.id, v?.costInCents ?? null]));
    const sales: Sale[] = lines.map((l) => ({
      id: uid(), orderId: order.id, dailyRecordId: day.id, variantId: l.variantId, quantity: l.quantity,
      unitPriceInCents: l.unitPriceInCents, totalInCents: (l.unitPriceInCents ?? 0) * l.quantity,
      paymentMethod: byLine ? l.paymentMethod ?? params.paymentMethod : main, createdAt: now, cashMovementId: order.cashMovementId, status: 'ok',
      ...(cost.get(l.variantId) != null ? { costInCents: cost.get(l.variantId) } : {}),
    }));
    await db.sales.bulkAdd(sales);
    for (const l of lines)
      await applyStockDelta(day.id, l.variantId, -l.quantity, 'venda', { orderId: order.id, description: order.customer });
    for (const rid of converting) await db.reservations.update(rid, { status: 'converted', orderId: order.id, updatedAt: now });
    return order;
  });
}

/** Saldo que a venda ainda tem no caixa, por forma de pagamento (recebido - estornado). */
async function orderCashByMethod(orderId: string) {
  const moves = await db.cashMovements.where('relatedOrderId').equals(orderId).toArray();
  const net = new Map<PaymentMethod, number>();
  for (const m of moves) {
    if (m.type === 'venda') net.set(m.paymentMethod, (net.get(m.paymentMethod) ?? 0) + m.amountInCents);
    if (m.type === 'estorno') net.set(m.paymentMethod, (net.get(m.paymentMethod) ?? 0) - m.amountInCents);
  }
  return net;
}

/**
 * Cancela a venda: devolve as peças e estorna o que entrou no caixa. Nada é apagado.
 * `restoreReservations`: se a venda veio de reserva, a reserva volta a valer.
 */
export async function cancelOrder(orderId: string, opts: { restoreReservations?: boolean; refund?: 'dinheiro' | 'vale' } = {}) {
  return db.transaction('rw', SALE_TABLES(), async () => {
    const order = await db.orders.get(orderId);
    if (!order) throw new UserError('Venda não encontrada.');
    if (order.status === 'cancelled') return;
    const day = await returnDay(order.dailyRecordId);
    const what = await returnLabel(order.dailyRecordId, day.id, 'Venda cancelada');
    const sales = await db.sales.where('orderId').equals(orderId).toArray();
    for (const s of sales) {
      if (s.quantity) await applyStockDelta(day.id, s.variantId, s.quantity, 'cancelamento', { orderId, description: what });
      await db.sales.update(s.id, { status: 'cancelled' });
    }
    // devolve tudo o que ela pagou: em vale (se escolheu) ou no dinheiro de cada forma; vale que ela usou volta como vale
    const { paid, cash } = await paidOf(orderId);
    if (opts.refund === 'vale') await addCredit(order.customer, paid, day.id, orderId, what);
    else {
      for (const [method, amount] of await orderCashByMethod(orderId))
        if (amount > 0)
          await db.cashMovements.add({
            id: uid(), dailyRecordId: day.id, type: 'estorno', amountInCents: amount,
            paymentMethod: method, relatedOrderId: orderId, createdAt: nowIso(), description: what,
          });
      if (paid - cash > 0) await addCredit(order.customer, paid - cash, day.id, orderId, `${what} (vale volta)`);
    }
    await db.orders.update(orderId, { status: 'cancelled' });
    if (opts.restoreReservations)
      for (const r of await db.reservations.filter((x) => x.orderId === orderId && x.status === 'converted').toArray())
        await db.reservations.update(r.id, { status: 'active', orderId: null, updatedAt: nowIso() });
    await audit('order', orderId, 'cancel', null, { restoreReservations: !!opts.restoreReservations });
  });
}

/**
 * Onde entra a devolução/cancelamento: no dia da venda, se ainda está aberto; senão no dia de HOJE
 * (a peça e o dinheiro voltam hoje). O dia encerrado não muda — igual ao Desfazer movimento.
 */
async function returnDay(orderDayId: string) {
  const d = await db.dailyRecords.get(orderDayId);
  if (d && d.status === 'open') return d;
  const today = await todayOpenDay();
  if (!today) throw new UserError('Esta venda é de um dia encerrado. Inicie o dia de hoje: a peça e o dinheiro voltam hoje.');
  return today;
}
async function returnLabel(orderDayId: string, dayId: string, base: string) {
  if (orderDayId === dayId) return base;
  const d = await db.dailyRecords.get(orderDayId);
  return `${base} (venda de ${d ? fmtDate(d.date, false) : 'outro dia'})`;
}

/** `payments` da venda acompanha o que ficou no caixa por forma (depois de corrigir valor ou devolver peça). */
async function syncPayments(orderId: string) {
  const net = await orderCashByMethod(orderId);
  const pays = [...net.entries()].filter(([, v]) => v > 0).map(([method, amountInCents]) => ({ method, amountInCents }));
  await db.orders.update(orderId, { payments: pays.length > 1 ? pays : undefined });
}

/**
 * Devolução de parte da venda (ex.: levou 3, devolveu 1): a peça volta ao estoque e o valor dela sai do caixa
 * (na forma em que essa peça foi paga; se não der, nas outras). Venda de dia encerrado: entra hoje.
 * Devolver tudo = Cancelar venda.
 */
export async function returnSaleItem(saleId: string, quantity: number, how: 'dinheiro' | 'vale' = 'dinheiro') {
  return db.transaction('rw', SALE_TABLES(), async () => {
    const s = await db.sales.get(saleId);
    if (!s || s.status !== 'ok') throw new UserError('Venda não encontrada.');
    const order = await db.orders.get(s.orderId);
    if (!order || order.status !== 'ok') throw new UserError('Venda cancelada não tem o que devolver.');
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > s.quantity) throw new UserError('Quantidade inválida para devolver.');
    const left = (await db.sales.where('orderId').equals(order.id).toArray()).filter((l) => l.status === 'ok').reduce((n, l) => n + l.quantity, 0) - quantity;
    if (left <= 0) throw new UserError('É a venda inteira: use “Cancelar venda”.');
    const day = await returnDay(order.dailyRecordId);
    const what = await returnLabel(order.dailyRecordId, day.id, `Devolução de ${quantity}`);
    await applyStockDelta(day.id, s.variantId, quantity, 'cancelamento', { orderId: order.id, description: what });
    const value = (s.unitPriceInCents ?? 0) * quantity;
    await db.sales.update(s.id, {
      quantity: s.quantity - quantity, totalInCents: (s.unitPriceInCents ?? 0) * (s.quantity - quantity),
      returnedQuantity: (s.returnedQuantity ?? 0) + quantity,
    });
    if (value > 0) await refund(order, value, day.id, what, how, s.paymentMethod);
    await db.orders.update(order.id, { totalInCents: order.totalInCents - value, itemCount: order.itemCount - quantity });
    await syncPayments(order.id);
    await audit('order', order.id, 'return_item', { saleId, variantId: s.variantId, quantity }, { dayId: day.id, cents: value });
  });
}

/** Reservas que viraram esta venda (para perguntar se voltam ao cancelar). */
export async function reservationsOfOrder(orderId: string) {
  return db.reservations.filter((r) => r.orderId === orderId && r.status === 'converted').toArray();
}

/**
 * Corrige os preços de uma venda já feita. A diferença entra no caixa como novo recebimento
 * (ou estorno), na forma principal da venda; o lançamento original não é apagado.
 */
export async function correctOrderPrices(orderId: string, prices: Record<string, number | null>) {
  return db.transaction('rw', SALE_TABLES(), async () => {
    const order = await db.orders.get(orderId);
    if (!order) throw new UserError('Venda não encontrada.');
    if (order.status !== 'ok') throw new UserError('Venda cancelada não pode ser corrigida.');
    await assertOpen(order.dailyRecordId);
    const sales = await db.sales.where('orderId').equals(orderId).toArray();
    let total = 0;
    const changes: { saleId: string; from: number | null; to: number | null }[] = [];
    for (const s of sales) {
      const p = s.id in prices ? prices[s.id] : s.unitPriceInCents;
      if (p !== null && !isCents(p)) throw new UserError('Preço inválido.');
      total += (p ?? 0) * s.quantity;
      if (p !== s.unitPriceInCents) {
        changes.push({ saleId: s.id, from: s.unitPriceInCents, to: p });
        await db.sales.update(s.id, { unitPriceInCents: p, totalInCents: (p ?? 0) * s.quantity });
      }
    }
    if (!changes.length) return order;
    if (!isCents(total)) throw new UserError('Total inválido.');
    const net = await orderCashByMethod(orderId);
    // o que ela já pagou (dinheiro + vale); no fiado, aumentar o valor só aumenta o que ela deve
    const received = (await paidOf(orderId)).paid;
    let diff = order.fiado ? Math.min(0, total - received) : total - received;
    const now = nowIso();
    const add = (type: CashMovement['type'], amount: number, method: PaymentMethod) => db.cashMovements.add({
      id: uid(), dailyRecordId: order.dailyRecordId, type, amountInCents: amount, paymentMethod: method,
      relatedOrderId: orderId, createdAt: now, description: 'Correção de valor',
    });
    if (order.payByLine) {
      // cada forma tem que ficar com a soma das suas peças
      const want = new Map<PaymentMethod, number>();
      for (const x of await db.sales.where('orderId').equals(orderId).toArray())
        want.set(x.paymentMethod, (want.get(x.paymentMethod) ?? 0) + x.totalInCents);
      for (const m of PAYMENTS) {
        const d = (want.get(m) ?? 0) - (net.get(m) ?? 0);
        if (d > 0) await add('venda', d, m);
        if (d < 0) await add('estorno', -d, m);
      }
      const pays = [...want.entries()].filter(([, v]) => v > 0).map(([method, amountInCents]) => ({ method, amountInCents }));
      await db.orders.update(orderId, { totalInCents: total, payments: pays.length > 1 ? pays : undefined });
      await audit('order', orderId, 'correct_prices', order.totalInCents, { total, changes });
      return { ...order, totalInCents: total };
    }
    if (diff > 0) await add('venda', diff, order.paymentMethod);
    // devolução: tira primeiro da forma principal, depois das outras, sem deixar nenhuma negativa
    const order_ = [order.paymentMethod, ...PAYMENTS.filter((m) => m !== order.paymentMethod)];
    for (const m of order_) {
      if (diff >= 0) break;
      const take = Math.min(net.get(m) ?? 0, -diff);
      if (take > 0) { await add('estorno', take, m); diff += take; }
    }
    // pagou com vale e o valor baixou além do dinheiro: a diferença volta como vale
    if (diff < 0) await addCredit(order.customer, -diff, order.dailyRecordId, orderId, 'Correção de valor');
    await db.orders.update(orderId, { totalInCents: total });
    // pagamento dividido: as formas passam a ser o que ficou no caixa (antes o Pix conferido olhava o valor antigo)
    if (order.payments?.length) await syncPayments(orderId);
    await audit('order', orderId, 'correct_prices', order.totalInCents, { total, changes });
    return { ...order, totalInCents: total };
  });
}

// ---------------- reservas ----------------

export async function createReservation(p: {
  dailyRecordId: string; variantId: string; quantity: number; customer?: string; notes?: string;
  /** 'condicional' = levou para provar em casa (precisa do nome e do prazo) */
  kind?: 'reserva' | 'condicional'; dueDate?: string | null;
}) {
  if (!isQty(p.quantity)) throw new UserError('Quantidade inválida.');
  const cond = p.kind === 'condicional';
  if (cond && !p.customer?.trim()) throw new UserError('Condicional precisa do nome da cliente.');
  if (cond && (!p.dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(p.dueDate))) throw new UserError('Diga até quando ela devolve ou paga.');
  return db.transaction('rw', SALE_TABLES(), async () => {
    const day = await assertOpen(p.dailyRecordId);
    const pv = await assertLiveVariant(p.variantId);
    if (pv.forSale === false) throw new UserError(`${pv.name} está guardada (fora da venda). Coloque à venda no Estoque.`);
    const item = await ensureItem(day.id, p.variantId);
    const reserved = (await activeReservedByVariant(day.date)).get(p.variantId) ?? 0;
    if (p.quantity > item.currentQuantity - reserved)
      throw new UserError(`Só há ${Math.max(0, item.currentQuantity - reserved)} disponível para reservar.`);
    const now = nowIso();
    const r: Reservation = {
      id: uid(), dailyRecordId: day.id, date: day.date, variantId: p.variantId, quantity: p.quantity,
      customer: p.customer?.trim().slice(0, 80) || undefined, notes: p.notes?.slice(0, 200), status: 'active', createdAt: now, updatedAt: now,
      ...(cond ? { kind: 'condicional' as const, dueDate: p.dueDate } : {}),
    };
    await db.reservations.add({ ...r, by: actor() });
    // registro informativo: reserva não muda o estoque físico (quantity 0)
    await db.stockMovements.add({
      id: uid(), dailyRecordId: day.id, variantId: p.variantId, type: 'reserva', quantity: 0,
      previousBalance: item.currentQuantity, newBalance: item.currentQuantity, createdAt: now,
      description: `${cond ? 'Condicional (levou para provar)' : 'Reserva'} de ${p.quantity}${r.customer ? ' — ' + r.customer : ''}`,
    });
    return r;
  });
}

/** Cancela a reserva. Com `dailyRecordId` (dia aberto na tela), fica registrado nos Movimentos do dia. */
export async function cancelReservation(id: string, dailyRecordId?: string) {
  await db.transaction('rw', SALE_TABLES(), async () => {
    const r = await db.reservations.get(id);
    if (!r || r.status !== 'active') return;
    await db.reservations.update(id, { status: 'cancelled', updatedAt: nowIso() });
    const day = dailyRecordId ? await db.dailyRecords.get(dailyRecordId) : undefined;
    if (day && day.status === 'open') {
      const item = await ensureItem(day.id, r.variantId);
      await db.stockMovements.add({
        id: uid(), dailyRecordId: day.id, variantId: r.variantId, type: 'reserva', quantity: 0,
        previousBalance: item.currentQuantity, newBalance: item.currentQuantity, createdAt: nowIso(),
        description: `Reserva cancelada${r.customer ? ' — ' + r.customer : ''} (${r.quantity} volta${r.quantity > 1 ? 'm' : ''} à venda)`,
      });
    }
    await audit('reservation', id, 'cancel');
  });
}

export async function convertReservation(p: {
  reservationId: string; dailyRecordId: string; unitPriceInCents: number | null; paymentMethod: PaymentMethod; orderId: string;
  /** condicional: quantas ela ficou (as outras voltam para a venda). Sem = todas. */
  quantity?: number;
  fiado?: boolean;
}) {
  return db.transaction('rw', SALE_TABLES(), async () => {
    const r = await db.reservations.get(p.reservationId);
    if (!r || r.status !== 'active') throw new UserError('Reserva não está ativa.');
    const q = p.quantity ?? r.quantity;
    if (!Number.isInteger(q) || q < 1 || q > r.quantity) throw new UserError('Quantidade inválida.');
    if ((await db.orders.get(p.orderId))) return (await db.orders.get(p.orderId))!;
    if (q < r.quantity) {
      // ficou com parte: as outras voltam para a venda (registrado nos movimentos do dia)
      await db.reservations.update(r.id, { quantity: q, updatedAt: nowIso() });
      const item = await ensureItem(p.dailyRecordId, r.variantId);
      await db.stockMovements.add({
        id: uid(), dailyRecordId: p.dailyRecordId, variantId: r.variantId, type: 'reserva', quantity: 0,
        previousBalance: item.currentQuantity, newBalance: item.currentQuantity, createdAt: nowIso(),
        description: `${r.kind === 'condicional' ? 'Condicional' : 'Reserva'}${r.customer ? ' — ' + r.customer : ''}: ficou ${q}, ${r.quantity - q} ${r.quantity - q === 1 ? 'voltou' : 'voltaram'} à venda`,
      });
    }
    return createOrder({
      orderId: p.orderId, dailyRecordId: p.dailyRecordId, paymentMethod: p.paymentMethod, customer: r.customer, fiado: p.fiado,
      lines: [{ variantId: r.variantId, quantity: q, unitPriceInCents: p.unitPriceInCents, reservationId: r.id }],
    });
  });
}

/**
 * Fiado pago: a cliente pagou o que devia. Entra TUDO no caixa de hoje, na forma escolhida (sem pagamento em partes).
 * Tocar de novo não recebe duas vezes (depois de pago, não deve mais nada).
 */
export async function receiveFiado(orderId: string, dailyRecordId: string, method: PaymentMethod) {
  return db.transaction('rw', SALE_TABLES(), async () => {
    const day = await assertOpen(dailyRecordId);
    const o = await db.orders.get(orderId);
    if (!o || !o.fiado || o.status !== 'ok') throw new UserError('Fiado não encontrado.');
    if (!PAYMENTS.includes(method)) throw new UserError('Forma de pagamento inválida.');
    const owed = await owedOf(o);
    if (owed <= 0) return 0;
    await db.cashMovements.add({
      id: uid(), dailyRecordId: day.id, type: 'venda', amountInCents: owed, paymentMethod: method, relatedOrderId: o.id,
      createdAt: nowIso(), description: `Fiado pago${o.customer ? ' — ' + o.customer : ''}`,
    });
    await audit('order', o.id, 'fiado_paid', null, { cents: owed, method, dayId: day.id });
    return owed;
  });
}

/**
 * Troca a peça de uma venda já feita (vendeu Branco, mas era Vermelho): a peça errada volta ao estoque
 * e a certa sai. `quantity` menor que a linha troca só parte dela. Preço e caixa não mudam.
 */
export async function swapSaleItem(saleId: string, newVariantId: string, quantity?: number) {
  return db.transaction('rw', SALE_TABLES(), async () => {
    const s = await db.sales.get(saleId);
    if (!s || s.status !== 'ok') throw new UserError('Venda não encontrada.');
    const order = await db.orders.get(s.orderId);
    if (!order || order.status !== 'ok') throw new UserError('Venda cancelada não pode ser trocada.');
    const day = await assertOpen(s.dailyRecordId);
    const qty = quantity ?? s.quantity;
    if (!Number.isInteger(qty) || qty < 1 || qty > s.quantity) throw new UserError('Quantidade inválida para trocar.');
    if (newVariantId === s.variantId) throw new UserError('Escolha uma peça diferente.');
    if (!(await db.variants.get(newVariantId))) throw new UserError('Essa peça não existe mais no cadastro.');
    const v = await assertLiveVariant(newVariantId);
    if (v.forSale === false) throw new UserError(`${v.name} está guardada (fora da venda). Coloque à venda no Estoque.`);
    const item = await ensureItem(day.id, newVariantId);
    const available = item.currentQuantity - ((await activeReservedByVariant(day.date)).get(newVariantId) ?? 0);
    if (qty > available) throw new UserError(`Só há ${Math.max(0, available)} disponível de ${v.name}.`);

    const old = await db.variants.get(s.variantId);
    const note = `Troca: era ${old?.name ?? 'outra peça'}, foi ${v.name}`;
    await applyStockDelta(day.id, s.variantId, qty, 'venda', { orderId: order.id, description: note });
    await applyStockDelta(day.id, newVariantId, -qty, 'venda', { orderId: order.id, description: note });

    // a linha da peça errada diminui (ou some); a da certa aumenta (junta com uma igual, se houver)
    const lines = await db.sales.where('orderId').equals(order.id).toArray();
    const same = lines.find((l) => l.id !== s.id && l.status === 'ok' && l.variantId === newVariantId && l.unitPriceInCents === s.unitPriceInCents && l.paymentMethod === s.paymentMethod);
    const total = (n: number) => (s.unitPriceInCents ?? 0) * n;
    if (qty === s.quantity && !same) await db.sales.update(s.id, { variantId: newVariantId });
    else {
      if (qty === s.quantity) { await db.sales.delete(s.id); await addTombstones([s.id]); }
      else await db.sales.update(s.id, { quantity: s.quantity - qty, totalInCents: total(s.quantity - qty) });
      if (same) await db.sales.update(same.id, { quantity: same.quantity + qty, totalInCents: total(same.quantity + qty) });
      else await db.sales.add({ ...s, id: uid(), variantId: newVariantId, quantity: qty, totalInCents: total(qty) });
    }
    await audit('order', order.id, 'swapItem', { saleId, variantId: s.variantId, quantity: qty }, { variantId: newVariantId });
  });
}

/** Quanto da venda foi no Pix (0 = não tem Pix). */
export function pixAmountOf(o: Pick<Order, 'paymentMethod' | 'payments' | 'totalInCents'> & Partial<Pick<Order, 'fiado' | 'valeInCents'>>) {
  if (o.fiado) return 0; // fiado: o Pix (se vier) é conferido quando ela pagar
  if (o.payments?.length) return o.payments.filter((p) => p.method === 'pix').reduce((n, p) => n + p.amountInCents, 0);
  return o.paymentMethod === 'pix' ? o.totalInCents - (o.valeInCents ?? 0) : 0;
}

/**
 * Situação do Pix da venda: sem Pix · a conferir · conferido · valor mudou depois de conferido
 * (ex.: conferiu 70 e depois corrigiu para 90 → precisa conferir de novo).
 */
export function pixStatus(o: Pick<Order, 'paymentMethod' | 'payments' | 'totalInCents' | 'status' | 'pixConfirmedAt' | 'pixConfirmedCents'> & Partial<Pick<Order, 'fiado' | 'valeInCents'>>):
  { kind: 'none' } | { kind: 'pending'; cents: number } | { kind: 'ok'; cents: number } | { kind: 'changed'; cents: number; was: number } {
  const cents = pixAmountOf(o);
  if (o.status !== 'ok' || !cents) return { kind: 'none' };
  if (!o.pixConfirmedAt) return { kind: 'pending', cents };
  const was = o.pixConfirmedCents ?? cents; // conferido antes desta versão: vale o valor atual
  return was === cents ? { kind: 'ok', cents } : { kind: 'changed', cents, was };
}

/** Marca que o Pix desta venda caiu na conta (ou desmarca). */
export async function confirmPix(orderId: string, confirmed = true) {
  await db.transaction('rw', db.orders, db.auditLogs, async () => {
    const o = await db.orders.get(orderId);
    if (!o) throw new UserError('Venda não encontrada.');
    if (o.status !== 'ok') throw new UserError('Venda cancelada.');
    if (!pixAmountOf(o)) throw new UserError('Esta venda não tem Pix.');
    await db.orders.update(orderId, { pixConfirmedAt: confirmed ? nowIso() : null, pixConfirmedCents: confirmed ? pixAmountOf(o) : null });
    await audit('order', orderId, confirmed ? 'pix_ok' : 'pix_undo', null, null);
  });
}
