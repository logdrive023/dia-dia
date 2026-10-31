import { db } from '../db/db';
import type { CashMovement, Order, Payment, PaymentMethod, Reservation, Sale } from '../db/types';
import { isCents, isQty, MAX_QTY, nowIso, PAYMENTS, uid } from '../lib/util';
import { audit } from './audit';
import { UserError } from './catalog';
import { applyStockDelta, assertOpen, ensureItem } from './days';

export interface CartLine {
  variantId: string;
  quantity: number;
  unitPriceInCents: number | null;
  reservationId?: string;
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
  db.dailyRecords, db.dailyStockItems, db.stockMovements, db.variants, db.orders, db.sales,
  db.cashMovements, db.reservations, db.auditLogs,
];

function validateLine(l: CartLine) {
  if (!isQty(l.quantity)) throw new UserError(`Quantidade inválida (de 1 a ${MAX_QTY}).`);
  if (l.unitPriceInCents !== null && !isCents(l.unitPriceInCents)) throw new UserError('Preço inválido.');
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
}): Promise<Order> {
  const lines = params.lines.filter((l) => l.quantity !== 0);
  if (!lines.length) throw new UserError('Adicione pelo menos uma peça.');
  lines.forEach(validateLine);
  const total = lines.reduce((s, l) => s + (l.unitPriceInCents ?? 0) * l.quantity, 0);
  if (!isCents(total)) throw new UserError('Total da venda inválido.');
  const pays = normalizePayments(total, params.paymentMethod, params.payments);
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
      const v = await db.variants.get(variantId);
      if (!v) throw new UserError('Uma das peças não existe mais no cadastro.');
      if (v.forSale === false && !lines.some((l) => l.variantId === variantId && l.reservationId))
        throw new UserError(`${v.name} está guardada (fora da venda). Coloque à venda no Estoque.`);
      const item = await ensureItem(day.id, variantId);
      const available = item.currentQuantity - (reserved.get(variantId) ?? 0);
      if (qty > available) throw new UserError(`Só há ${Math.max(0, available)} disponível de ${v.name}.`);
    }

    const now = nowIso();
    const main = pays.slice().sort((a, b) => b.amountInCents - a.amountInCents)[0]?.method ?? params.paymentMethod;
    const order: Order = {
      id: params.orderId, dailyRecordId: day.id, customer: params.customer?.trim().slice(0, 80) || undefined,
      paymentMethod: main, payments: pays.length > 1 ? pays : undefined, totalInCents: total,
      itemCount: lines.reduce((s, l) => s + l.quantity, 0), status: 'ok', cashMovementId: null,
      createdAt: now, notes: params.notes,
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
    await db.orders.add(order);
    const sales: Sale[] = lines.map((l) => ({
      id: uid(), orderId: order.id, dailyRecordId: day.id, variantId: l.variantId, quantity: l.quantity,
      unitPriceInCents: l.unitPriceInCents, totalInCents: (l.unitPriceInCents ?? 0) * l.quantity,
      paymentMethod: main, createdAt: now, cashMovementId: order.cashMovementId, status: 'ok',
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
export async function cancelOrder(orderId: string, opts: { restoreReservations?: boolean } = {}) {
  return db.transaction('rw', SALE_TABLES(), async () => {
    const order = await db.orders.get(orderId);
    if (!order) throw new UserError('Venda não encontrada.');
    if (order.status === 'cancelled') return;
    await assertOpen(order.dailyRecordId);
    const sales = await db.sales.where('orderId').equals(orderId).toArray();
    for (const s of sales) {
      await applyStockDelta(order.dailyRecordId, s.variantId, s.quantity, 'cancelamento', { orderId, description: 'Venda cancelada' });
      await db.sales.update(s.id, { status: 'cancelled' });
    }
    for (const [method, amount] of await orderCashByMethod(orderId))
      if (amount > 0)
        await db.cashMovements.add({
          id: uid(), dailyRecordId: order.dailyRecordId, type: 'estorno', amountInCents: amount,
          paymentMethod: method, relatedOrderId: orderId, createdAt: nowIso(), description: 'Venda cancelada',
        });
    await db.orders.update(orderId, { status: 'cancelled' });
    if (opts.restoreReservations)
      for (const r of await db.reservations.filter((x) => x.orderId === orderId && x.status === 'converted').toArray())
        await db.reservations.update(r.id, { status: 'active', orderId: null, updatedAt: nowIso() });
    await audit('order', orderId, 'cancel', null, { restoreReservations: !!opts.restoreReservations });
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
    const received = [...net.values()].reduce((a, b) => a + b, 0);
    let diff = total - received;
    const now = nowIso();
    const add = (type: CashMovement['type'], amount: number, method: PaymentMethod) => db.cashMovements.add({
      id: uid(), dailyRecordId: order.dailyRecordId, type, amountInCents: amount, paymentMethod: method,
      relatedOrderId: orderId, createdAt: now, description: 'Correção de valor',
    });
    if (diff > 0) await add('venda', diff, order.paymentMethod);
    // devolução: tira primeiro da forma principal, depois das outras, sem deixar nenhuma negativa
    const order_ = [order.paymentMethod, ...PAYMENTS.filter((m) => m !== order.paymentMethod)];
    for (const m of order_) {
      if (diff >= 0) break;
      const take = Math.min(net.get(m) ?? 0, -diff);
      if (take > 0) { await add('estorno', take, m); diff += take; }
    }
    await db.orders.update(orderId, { totalInCents: total });
    await audit('order', orderId, 'correct_prices', order.totalInCents, { total, changes });
    return { ...order, totalInCents: total };
  });
}

// ---------------- reservas ----------------

export async function createReservation(p: { dailyRecordId: string; variantId: string; quantity: number; customer?: string; notes?: string }) {
  if (!isQty(p.quantity)) throw new UserError('Quantidade inválida.');
  return db.transaction('rw', SALE_TABLES(), async () => {
    const day = await assertOpen(p.dailyRecordId);
    const pv = await db.variants.get(p.variantId);
    if (!pv) throw new UserError('Peça não encontrada.');
    if (pv.forSale === false) throw new UserError(`${pv.name} está guardada (fora da venda). Coloque à venda no Estoque.`);
    const item = await ensureItem(day.id, p.variantId);
    const reserved = (await activeReservedByVariant(day.date)).get(p.variantId) ?? 0;
    if (p.quantity > item.currentQuantity - reserved)
      throw new UserError(`Só há ${Math.max(0, item.currentQuantity - reserved)} disponível para reservar.`);
    const now = nowIso();
    const r: Reservation = {
      id: uid(), dailyRecordId: day.id, date: day.date, variantId: p.variantId, quantity: p.quantity,
      customer: p.customer?.trim().slice(0, 80) || undefined, notes: p.notes?.slice(0, 200), status: 'active', createdAt: now, updatedAt: now,
    };
    await db.reservations.add(r);
    // registro informativo: reserva não muda o estoque físico (quantity 0)
    await db.stockMovements.add({
      id: uid(), dailyRecordId: day.id, variantId: p.variantId, type: 'reserva', quantity: 0,
      previousBalance: item.currentQuantity, newBalance: item.currentQuantity, createdAt: now,
      description: `Reserva de ${p.quantity}${r.customer ? ' — ' + r.customer : ''}`,
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
}) {
  const r = await db.reservations.get(p.reservationId);
  if (!r || r.status !== 'active') throw new UserError('Reserva não está ativa.');
  return createOrder({
    orderId: p.orderId, dailyRecordId: p.dailyRecordId, paymentMethod: p.paymentMethod, customer: r.customer,
    lines: [{ variantId: r.variantId, quantity: r.quantity, unitPriceInCents: p.unitPriceInCents, reservationId: r.id }],
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
    const v = await db.variants.get(newVariantId);
    if (!v || v.archivedAt) throw new UserError('Essa peça não existe mais no cadastro.');
    const item = await ensureItem(day.id, newVariantId);
    const available = item.currentQuantity - ((await activeReservedByVariant(day.date)).get(newVariantId) ?? 0);
    if (qty > available) throw new UserError(`Só há ${Math.max(0, available)} disponível de ${v.name}.`);

    const old = await db.variants.get(s.variantId);
    const note = `Troca: era ${old?.name ?? 'outra peça'}, foi ${v.name}`;
    await applyStockDelta(day.id, s.variantId, qty, 'venda', { orderId: order.id, description: note });
    await applyStockDelta(day.id, newVariantId, -qty, 'venda', { orderId: order.id, description: note });

    // a linha da peça errada diminui (ou some); a da certa aumenta (junta com uma igual, se houver)
    const lines = await db.sales.where('orderId').equals(order.id).toArray();
    const same = lines.find((l) => l.id !== s.id && l.status === 'ok' && l.variantId === newVariantId && l.unitPriceInCents === s.unitPriceInCents);
    const total = (n: number) => (s.unitPriceInCents ?? 0) * n;
    if (qty === s.quantity && !same) await db.sales.update(s.id, { variantId: newVariantId });
    else {
      if (qty === s.quantity) await db.sales.delete(s.id);
      else await db.sales.update(s.id, { quantity: s.quantity - qty, totalInCents: total(s.quantity - qty) });
      if (same) await db.sales.update(same.id, { quantity: same.quantity + qty, totalInCents: total(same.quantity + qty) });
      else await db.sales.add({ ...s, id: uid(), variantId: newVariantId, quantity: qty, totalInCents: total(qty) });
    }
    await audit('order', order.id, 'swapItem', { saleId, variantId: s.variantId, quantity: qty }, { variantId: newVariantId });
  });
}
