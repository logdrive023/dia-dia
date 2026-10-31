import { db } from '../db/db';
import type { Order, PaymentMethod, Reservation, Sale } from '../db/types';
import { nowIso, uid } from '../lib/util';
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

/**
 * Registra uma venda (uma pessoa, várias peças). `orderId` é gerado quando o carrinho abre:
 * repetir o toque com o mesmo id não duplica a venda nem o recebimento.
 */
export async function createOrder(params: {
  orderId: string; dailyRecordId: string; lines: CartLine[]; paymentMethod: PaymentMethod;
  customer?: string; notes?: string;
}): Promise<Order> {
  const lines = params.lines.filter((l) => l.quantity > 0);
  if (!lines.length) throw new UserError('Adicione pelo menos uma peça.');
  for (const l of lines) if (!Number.isInteger(l.quantity)) throw new UserError('Quantidade inválida.');
  return db.transaction('rw', SALE_TABLES(), async () => {
    const dup = await db.orders.get(params.orderId);
    if (dup) return dup;
    const day = await assertOpen(params.dailyRecordId);

    // disponibilidade: físico do dia - reservas ativas (as reservas que estão sendo convertidas não contam)
    const converting = lines.map((l) => l.reservationId).filter(Boolean) as string[];
    const reserved = await activeReservedByVariant(day.date, converting);
    const need = new Map<string, number>();
    for (const l of lines) need.set(l.variantId, (need.get(l.variantId) ?? 0) + l.quantity);
    for (const [variantId, qty] of need) {
      const item = await ensureItem(day.id, variantId);
      const available = item.currentQuantity - (reserved.get(variantId) ?? 0);
      if (qty > available) {
        const v = await db.variants.get(variantId);
        throw new UserError(`Só há ${Math.max(0, available)} disponível de ${v?.name ?? 'item'}.`);
      }
    }

    const now = nowIso();
    const total = lines.reduce((s, l) => s + (l.unitPriceInCents ?? 0) * l.quantity, 0);
    const order: Order = {
      id: params.orderId, dailyRecordId: day.id, customer: params.customer?.trim() || undefined,
      paymentMethod: params.paymentMethod, totalInCents: total,
      itemCount: lines.reduce((s, l) => s + l.quantity, 0), status: 'ok', cashMovementId: null,
      createdAt: now, notes: params.notes,
    };
    // venda sem valor não gera receita fictícia
    if (total > 0) {
      order.cashMovementId = uid();
      await db.cashMovements.add({
        id: order.cashMovementId, dailyRecordId: day.id, type: 'venda', amountInCents: total,
        paymentMethod: params.paymentMethod, relatedOrderId: order.id, createdAt: now,
        description: order.customer ? `Venda — ${order.customer}` : 'Venda',
      });
    }
    await db.orders.add(order);
    const sales: Sale[] = lines.map((l) => ({
      id: uid(), orderId: order.id, dailyRecordId: day.id, variantId: l.variantId, quantity: l.quantity,
      unitPriceInCents: l.unitPriceInCents, totalInCents: (l.unitPriceInCents ?? 0) * l.quantity,
      paymentMethod: params.paymentMethod, createdAt: now, cashMovementId: order.cashMovementId, status: 'ok',
    }));
    await db.sales.bulkAdd(sales);
    for (const l of lines)
      await applyStockDelta(day.id, l.variantId, -l.quantity, 'venda', { orderId: order.id, description: order.customer });
    for (const rid of converting) await db.reservations.update(rid, { status: 'converted', updatedAt: now });
    return order;
  });
}

/** Cancela a venda: devolve as peças e estorna o recebimento. Nada é apagado. */
export async function cancelOrder(orderId: string) {
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
    if (order.totalInCents > 0)
      await db.cashMovements.add({
        id: uid(), dailyRecordId: order.dailyRecordId, type: 'estorno', amountInCents: order.totalInCents,
        paymentMethod: order.paymentMethod, relatedOrderId: orderId, createdAt: nowIso(), description: 'Venda cancelada',
      });
    await db.orders.update(orderId, { status: 'cancelled' });
    await audit('order', orderId, 'cancel');
  });
}

// ---------------- reservas ----------------

export async function createReservation(p: { dailyRecordId: string; variantId: string; quantity: number; customer?: string; notes?: string }) {
  if (!Number.isInteger(p.quantity) || p.quantity <= 0) throw new UserError('Quantidade inválida.');
  return db.transaction('rw', SALE_TABLES(), async () => {
    const day = await assertOpen(p.dailyRecordId);
    const item = await ensureItem(day.id, p.variantId);
    const reserved = (await activeReservedByVariant(day.date)).get(p.variantId) ?? 0;
    if (p.quantity > item.currentQuantity - reserved)
      throw new UserError(`Só há ${Math.max(0, item.currentQuantity - reserved)} disponível para reservar.`);
    const now = nowIso();
    const r: Reservation = {
      id: uid(), dailyRecordId: day.id, date: day.date, variantId: p.variantId, quantity: p.quantity,
      customer: p.customer?.trim() || undefined, notes: p.notes, status: 'active', createdAt: now, updatedAt: now,
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

export async function cancelReservation(id: string) {
  await db.transaction('rw', db.reservations, db.auditLogs, async () => {
    const r = await db.reservations.get(id);
    if (!r || r.status !== 'active') return;
    await db.reservations.update(id, { status: 'cancelled', updatedAt: nowIso() });
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
