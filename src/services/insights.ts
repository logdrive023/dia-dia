/**
 * Consultas que ajudam a decidir (não mexem em nada): mais vendidas, paradas, lucro, contagem da loja
 * e o recibo da venda para mandar à cliente.
 */
import { db } from '../db/db';
import type { Group, Order, Sale, Variant } from '../db/types';
import { addDays, fmtDate, money, nowIso, PAYMENT_LABEL, todayStr } from '../lib/util';
import { variantLabel } from './catalog';
import { applyStockDelta, assertOpen } from './days';
import { audit } from './audit';
import { UserError } from './catalog';

const isOld = (v?: Variant, g?: Group) => !v || !!(v.archivedAt || v.deletedAt || g?.archivedAt);

export interface InsightRow { variant: Variant; group: Group; qty: number; revenue: number; cost: number | null; stock: number; lastSale: string | null }

/**
 * Período de `days` dias até hoje: mais vendidas (peças), paradas (tem peça e não vendeu nada no período) e lucro.
 * Lucro = vendido − custo, só das peças com custo cadastrado (as sem custo aparecem à parte, nunca como lucro 100%).
 */
export async function salesInsights(days: number, today = todayStr()) {
  const from = addDays(today, -(days - 1));
  const [records, variants, groups, sales] = await Promise.all([
    db.dailyRecords.toArray(), db.variants.toArray(), db.groups.toArray(), db.sales.toArray(),
  ]);
  const dateOf = new Map(records.map((r) => [r.id, r.date]));
  const vMap = new Map(variants.map((v) => [v.id, v]));
  const gMap = new Map(groups.map((g) => [g.id, g]));
  const ok = sales.filter((s) => s.status === 'ok' && s.quantity > 0);
  const lastSale = new Map<string, string>();
  for (const s of ok) { const d = dateOf.get(s.dailyRecordId) ?? ''; if (d > (lastSale.get(s.variantId) ?? '')) lastSale.set(s.variantId, d); }
  // estoque de agora: o último dia registrado
  const lastDay = [...records].sort((a, b) => b.date.localeCompare(a.date))[0];
  const stock = new Map(lastDay ? (await db.dailyStockItems.where('dailyRecordId').equals(lastDay.id).toArray()).map((i) => [i.variantId, i.currentQuantity]) : []);

  const by = new Map<string, InsightRow>();
  let revenue = 0, costKnown = 0, revenueWithCost = 0, piecesNoCost = 0, pieces = 0;
  for (const s of ok) {
    const d = dateOf.get(s.dailyRecordId);
    if (!d || d < from || d > today) continue;
    const v = vMap.get(s.variantId); const g = v && gMap.get(v.groupId);
    if (!v || !g) continue;
    const unitCost = s.costInCents ?? v.costInCents ?? null;
    const row = by.get(v.id) ?? { variant: v, group: g, qty: 0, revenue: 0, cost: 0, stock: stock.get(v.id) ?? 0, lastSale: lastSale.get(v.id) ?? null };
    row.qty += s.quantity; row.revenue += s.totalInCents;
    if (unitCost === null) row.cost = null; else if (row.cost !== null) row.cost += unitCost * s.quantity;
    by.set(v.id, row);
    pieces += s.quantity; revenue += s.totalInCents;
    if (unitCost === null) piecesNoCost += s.quantity; else { costKnown += unitCost * s.quantity; revenueWithCost += s.totalInCents; }
  }
  const top = [...by.values()].sort((a, b) => b.qty - a.qty || b.revenue - a.revenue);
  const stale = variants
    .filter((v) => !isOld(v, gMap.get(v.groupId)) && (stock.get(v.id) ?? 0) > 0 && !by.has(v.id))
    .map((v) => ({ variant: v, group: gMap.get(v.groupId)!, qty: 0, revenue: 0, cost: null, stock: stock.get(v.id) ?? 0, lastSale: lastSale.get(v.id) ?? null }))
    .sort((a, b) => (a.lastSale ?? '').localeCompare(b.lastSale ?? '') || b.stock - a.stock);
  return {
    from, to: today, pieces, revenue, top, stale,
    profit: { revenueWithCost, cost: costKnown, profit: revenueWithCost - costKnown, piecesNoCost },
  };
}

// ---------------- contagem da loja ----------------

/** Peças que estão fora da loja em condicional (a cliente levou para provar), por cor. */
export async function condicionalByVariant() {
  const m = new Map<string, number>();
  for (const r of await db.reservations.where('status').equals('active').toArray())
    if (r.kind === 'condicional') m.set(r.variantId, (m.get(r.variantId) ?? 0) + r.quantity);
  return m;
}

/**
 * Contagem da loja: para cada cor contada, o estoque passa a ser “o que contou na loja” + “o que está em condicional”
 * (fora da loja, mas é da loja). Cor não contada (vazia) não muda. Cada diferença vira um ajuste “Contagem da loja”.
 * Uma transação só: ou grava tudo, ou nada.
 */
export async function applyCount(dailyRecordId: string, counts: { variantId: string; counted: number }[]) {
  return db.transaction('rw', [db.dailyRecords, db.dailyStockItems, db.stockMovements, db.variants, db.groups, db.reservations, db.auditLogs], async () => {
    await assertOpen(dailyRecordId);
    const out = await condicionalByVariant();
    const changes: { variantId: string; from: number; to: number }[] = [];
    for (const c of counts) {
      if (!Number.isInteger(c.counted) || c.counted < 0) throw new UserError('Contagem inválida.');
      const v = await db.variants.get(c.variantId);
      if (!v || v.archivedAt || v.deletedAt) continue;
      const item = await db.dailyStockItems.where('[dailyRecordId+variantId]').equals([dailyRecordId, c.variantId]).first();
      const now = item?.currentQuantity ?? 0;
      const to = c.counted + (out.get(c.variantId) ?? 0);
      if (to === now) continue;
      await applyStockDelta(dailyRecordId, c.variantId, to - now, 'ajuste', { description: 'Contagem da loja' });
      changes.push({ variantId: c.variantId, from: now, to });
    }
    if (changes.length) await audit('day', dailyRecordId, 'count', null, { at: nowIso(), changes });
    return changes;
  });
}

// ---------------- recibo ----------------

/** Recibo simples da venda para mandar à cliente (WhatsApp ou outro app). */
export function receiptText(o: Order, lines: Sale[], name: (variantId: string) => string, dateIso = o.createdAt) {
  const d = new Date(dateIso);
  const L = [`🧾 *Recibo* · ${fmtDate(todayStr(d), false)} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`];
  if (o.customer) L.push(`👩 ${o.customer}`);
  L.push('');
  for (const l of lines.filter((x) => x.quantity > 0))
    L.push(`• ${l.quantity}× ${name(l.variantId)}${l.unitPriceInCents !== null ? ` — ${money(l.totalInCents)}` : ''}`);
  L.push('', `*Total: ${money(o.totalInCents)}*`);
  if (o.fiado) L.push('📒 Fiado (paga depois)');
  else {
    if (o.valeInCents) L.push(`🎟️ Vale: ${money(o.valeInCents)}`);
    const pays = o.payments?.length ? o.payments : [{ method: o.paymentMethod, amountInCents: o.totalInCents - (o.valeInCents ?? 0) }];
    for (const p of pays) if (p.amountInCents > 0) L.push(`${PAYMENT_LABEL[p.method]}: ${money(p.amountInCents)}`);
  }
  if (o.status !== 'ok') L.push('✖️ Venda cancelada');
  L.push('', 'Obrigada pela compra! 💖');
  return L.join('\n');
}

export { variantLabel };
