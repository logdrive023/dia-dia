import { db } from '../db/db';
import type { DailyRecord, DailyStockItem, MovementType, StockMovement } from '../db/types';
import { nowIso, uid } from '../lib/util';
import { audit } from './audit';
import { UserError } from './catalog';

export async function getDayByDate(date: string) {
  return db.dailyRecords.where('date').equals(date).first();
}

/** Último dia registrado antes da data informada. */
export async function previousDay(date: string) {
  return db.dailyRecords.where('date').below(date).last();
}

export async function assertOpen(dailyRecordId: string) {
  const day = await db.dailyRecords.get(dailyRecordId);
  if (!day) throw new UserError('Dia não encontrado.');
  if (day.status === 'closed') throw new UserError('Este dia está encerrado. Reabra para alterar.');
  return day;
}

/**
 * "Iniciar o dia": cria o registro da data copiando o saldo final do último dia anterior
 * (ou em branco). Idempotente: se já existir, devolve o existente sem mudar nada.
 */
export async function startDay(date: string, mode: 'copy' | 'blank' = 'copy'): Promise<DailyRecord> {
  return db.transaction('rw',
    [db.dailyRecords, db.dailyStockItems, db.variants, db.cashRecords, db.auditLogs],
    async () => {
      const existing = await getDayByDate(date);
      if (existing) return existing;
      const prev = mode === 'copy' ? await previousDay(date) : undefined;
      const now = nowIso();
      const day: DailyRecord = {
        id: uid(), date, sourceDate: prev?.date ?? null, status: 'open', createdAt: now, updatedAt: now,
      };
      await db.dailyRecords.add(day);

      const variants = (await db.variants.toArray()).filter((v) => !v.archivedAt);
      const prevItems = prev ? await db.dailyStockItems.where('dailyRecordId').equals(prev.id).toArray() : [];
      const prevMap = new Map(prevItems.map((i) => [i.variantId, i.currentQuantity]));
      const ids = new Set<string>();
      const items: DailyStockItem[] = [];
      const push = (variantId: string, qty: number) => {
        if (ids.has(variantId)) return;
        ids.add(variantId);
        items.push({ id: uid(), dailyRecordId: day.id, variantId, initialQuantity: qty, currentQuantity: qty });
      };
      for (const v of variants) {
        let q = 0;
        if (mode === 'copy') {
          if (prevMap.has(v.id)) q = prevMap.get(v.id)!;
          // quantidade do cadastro só vale se a variação ainda não apareceu em nenhum dia
          else if (!(await db.dailyStockItems.where('variantId').equals(v.id).count())) q = v.startQuantity;
        }
        push(v.id, q);
      }
      // variações arquivadas que ainda tinham saldo continuam no dia (não some estoque silenciosamente)
      if (mode === 'copy') for (const i of prevItems) if (i.currentQuantity !== 0) push(i.variantId, i.currentQuantity);
      await db.dailyStockItems.bulkAdd(items);

      // "Ontem" é calculado sempre a partir do dia anterior (ver cashChain); em branco começa em 0
      await db.cashRecords.add({
        id: uid(), dailyRecordId: day.id, openingBalanceInCents: 0, openingManual: mode === 'blank', countedBalanceInCents: null, status: 'open',
      });
      await audit('day', day.id, 'start', null, { date, mode, sourceDate: day.sourceDate });
      return day;
    });
}

export async function ensureItem(dailyRecordId: string, variantId: string) {
  let item = await db.dailyStockItems.where('[dailyRecordId+variantId]').equals([dailyRecordId, variantId]).first();
  if (!item) {
    item = { id: uid(), dailyRecordId, variantId, initialQuantity: 0, currentQuantity: 0 };
    await db.dailyStockItems.add(item);
  }
  return item;
}

/** Aplica um delta no estoque físico do dia, registrando a movimentação. Use dentro de transação. */
export async function applyStockDelta(
  dailyRecordId: string, variantId: string, delta: number, type: MovementType,
  extra: Partial<Pick<StockMovement, 'description' | 'orderId' | 'reversedMovementId'>> = {},
) {
  const item = await ensureItem(dailyRecordId, variantId);
  const newBalance = item.currentQuantity + delta;
  if (newBalance < 0) throw new UserError('O estoque não pode ficar negativo.');
  await db.dailyStockItems.update(item.id, { currentQuantity: newBalance });
  const mv: StockMovement = {
    id: uid(), dailyRecordId, variantId, type, quantity: delta, previousBalance: item.currentQuantity,
    newBalance, createdAt: nowIso(), ...extra,
  };
  await db.stockMovements.add(mv);
  return mv;
}

const STOCK_TABLES = () => [db.dailyRecords, db.dailyStockItems, db.stockMovements, db.variants];

export async function moveStock(dailyRecordId: string, variantId: string, delta: number, type: MovementType, description?: string) {
  if (!Number.isInteger(delta) || delta === 0) throw new UserError('Quantidade inválida.');
  return db.transaction('rw', STOCK_TABLES(), async () => {
    await assertOpen(dailyRecordId);
    return applyStockDelta(dailyRecordId, variantId, delta, type, { description });
  });
}

/** Edição direta da quantidade: gera um ajuste com a diferença (ajuste não é venda). */
export async function setStock(dailyRecordId: string, variantId: string, quantity: number, description = 'Ajuste manual') {
  if (!Number.isInteger(quantity) || quantity < 0) throw new UserError('Quantidade inválida.');
  return db.transaction('rw', STOCK_TABLES(), async () => {
    await assertOpen(dailyRecordId);
    const item = await ensureItem(dailyRecordId, variantId);
    const delta = quantity - item.currentQuantity;
    if (delta === 0) return null;
    return applyStockDelta(dailyRecordId, variantId, delta, 'ajuste', { description });
  });
}

/** Desfaz uma movimentação de estoque com uma movimentação inversa (nunca apaga). */
export async function undoMovement(movementId: string) {
  return db.transaction('rw', STOCK_TABLES(), async () => {
    const mv = await db.stockMovements.get(movementId);
    if (!mv) throw new UserError('Movimentação não encontrada.');
    if (mv.orderId) throw new UserError('Esta movimentação é de uma venda. Cancele a venda.');
    if (mv.reversedMovementId) throw new UserError('Esta movimentação já é um estorno.');
    const already = await db.stockMovements.filter((m) => m.reversedMovementId === movementId).count();
    if (already) throw new UserError('Esta movimentação já foi desfeita.');
    await assertOpen(mv.dailyRecordId);
    return applyStockDelta(mv.dailyRecordId, mv.variantId, -mv.quantity, 'correcao', {
      reversedMovementId: mv.id, description: 'Desfazer movimentação',
    });
  });
}

/**
 * Traz para este dia as correções feitas depois no dia anterior: o estoque inicial passa a ser
 * o saldo final do dia anterior e o saldo atual muda na mesma diferença (vendas do dia ficam).
 */
export async function resyncFromPrevious(dailyRecordId: string) {
  return db.transaction('rw', [db.dailyRecords, db.dailyStockItems, db.auditLogs], async () => {
    const day = await assertOpen(dailyRecordId);
    const prev = await previousDay(day.date);
    if (!prev) return 0;
    const [prevItems, items] = await Promise.all([
      db.dailyStockItems.where('dailyRecordId').equals(prev.id).toArray(),
      db.dailyStockItems.where('dailyRecordId').equals(day.id).toArray(),
    ]);
    const expected = new Map(prevItems.map((i) => [i.variantId, i.currentQuantity]));
    const changes: { variantId: string; from: number; to: number }[] = [];
    for (const id of new Set([...expected.keys(), ...items.map((i) => i.variantId)])) {
      const item = await ensureItem(day.id, id);
      const to = expected.get(id) ?? 0;
      const delta = to - item.initialQuantity;
      if (!delta) continue;
      if (item.currentQuantity + delta < 0) throw new UserError('A correção deixaria um estoque negativo. Revise as vendas do dia.');
      await db.dailyStockItems.update(item.id, { initialQuantity: to, currentQuantity: item.currentQuantity + delta });
      changes.push({ variantId: id, from: item.initialQuantity, to });
    }
    await db.dailyRecords.update(day.id, { sourceDate: prev.date, updatedAt: nowIso() });
    await audit('day', day.id, 'resync', null, { from: prev.date, changes });
    return changes.length;
  });
}

export async function closeDay(dailyRecordId: string, countedBalanceInCents?: number | null) {
  await db.transaction('rw', db.dailyRecords, db.cashRecords, db.auditLogs, async () => {
    const day = await db.dailyRecords.get(dailyRecordId);
    if (!day) throw new UserError('Dia não encontrado.');
    if (day.status === 'closed') return;
    const now = nowIso();
    await db.dailyRecords.update(day.id, { status: 'closed', closedAt: now, updatedAt: now });
    const cash = await db.cashRecords.where('dailyRecordId').equals(day.id).first();
    if (cash) await db.cashRecords.update(cash.id, {
      status: 'closed', ...(countedBalanceInCents !== undefined ? { countedBalanceInCents } : {}),
    });
    await audit('day', day.id, 'close', null, { countedBalanceInCents });
  });
}

export async function reopenDay(dailyRecordId: string) {
  await db.transaction('rw', db.dailyRecords, db.cashRecords, db.auditLogs, async () => {
    const now = nowIso();
    await db.dailyRecords.update(dailyRecordId, { status: 'open', closedAt: null, updatedAt: now });
    const cash = await db.cashRecords.where('dailyRecordId').equals(dailyRecordId).first();
    if (cash) await db.cashRecords.update(cash.id, { status: 'open' });
    await audit('day', dailyRecordId, 'reopen');
  });
}

export async function setDayNotes(dailyRecordId: string, notes: string) {
  await db.dailyRecords.update(dailyRecordId, { notes, updatedAt: nowIso() });
}
