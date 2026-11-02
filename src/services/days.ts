import { db } from '../db/db';
import type { DailyRecord, DailyStockItem, MovementType, PaymentMethod, StockMovement } from '../db/types';
import { isQty, MAX_QTY, money, nowIso, todayStr, uid } from '../lib/util';
import { audit } from './audit';
import { UserError } from './catalog';
import { addTombstones } from './sync';

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
export function isValidDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return y >= 2000 && y <= 2100 && dt.getMonth() === m - 1 && dt.getDate() === d;
}

export async function startDay(date: string, mode: 'copy' | 'blank' = 'copy'): Promise<DailyRecord> {
  if (!isValidDate(date)) throw new UserError('Data inválida.');
  return db.transaction('rw',
    [db.dailyRecords, db.dailyStockItems, db.variants, db.cashRecords, db.cashMovements, db.auditLogs, db.settings],
    async () => {
      const existing = await getDayByDate(date);
      if (existing) return existing;
      const firstDay = !(await db.dailyRecords.count());
      // primeiro dia do app: os dias do caderno que vêm antes entram encerrados no histórico
      if (firstDay && mode === 'copy') await addNotebookDaysBefore(date);
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
          // quantidade do cadastro: no primeiro dia registrado (inclusive um dia lançado antes de todos)
          // ou para variação que ainda não apareceu em nenhum dia
          else if (!prev || !(await db.dailyStockItems.where('variantId').equals(v.id).count())) q = v.startQuantity;
        }
        push(v.id, q);
      }
      // variações arquivadas que ainda tinham saldo continuam no dia (não some estoque silenciosamente)
      if (mode === 'copy') for (const i of prevItems) if (i.currentQuantity !== 0) push(i.variantId, i.currentQuantity);
      await db.dailyStockItems.bulkAdd(items);

      // "Ontem" é calculado sempre a partir do dia anterior (ver cashChain); em branco começa em 0.
      await db.cashRecords.add({
        id: uid(), dailyRecordId: day.id, openingBalanceInCents: 0, openingManual: mode === 'blank', countedBalanceInCents: null, status: 'open',
      });
      // primeiro dia do app no dia do caderno: as vendas anotadas já entram no caixa
      if (firstDay && mode === 'copy') await addNotebookLines(day, (await notebook())?.days.find((d) => d.date === date)?.lines);
      await audit('day', day.id, 'start', null, { date, mode, sourceDate: day.sourceDate });
      return day;
    });
}

type NotebookLine = import('../db/seed').NotebookLine;
type Notebook = { source: string; days: { date: string; lines: NotebookLine[] }[] };

async function notebook() {
  const v = (await db.settings.where('key').equals('initialOpening').first())?.value as Notebook | undefined;
  return v && Array.isArray(v.days) ? v : undefined;
}

/** Dias do caderno antes de `date`: encerrados, com a lista do estoque intacta e o dinheiro anotado. */
async function addNotebookDaysBefore(date: string) {
  const nb = await notebook();
  if (!nb) return;
  const variants = (await db.variants.toArray()).filter((x) => !x.archivedAt);
  for (const d of nb.days.filter((x) => isValidDate(x.date) && x.date < date).sort((x, y) => x.date.localeCompare(y.date))) {
    const now = nowIso();
    const day: DailyRecord = { id: uid(), date: d.date, sourceDate: null, status: 'closed', notes: nb.source, closedAt: now, createdAt: now, updatedAt: now };
    await db.dailyRecords.add(day);
    await db.dailyStockItems.bulkAdd(variants.map((x) => ({
      id: uid(), dailyRecordId: day.id, variantId: x.id, initialQuantity: x.startQuantity, currentQuantity: x.startQuantity,
    })));
    await db.cashRecords.add({ id: uid(), dailyRecordId: day.id, openingBalanceInCents: 0, openingManual: false, countedBalanceInCents: null, status: 'closed' });
    await addNotebookLines(day, d.lines);
  }
}

/** Lança no caixa do dia as linhas do caderno, na ordem e com horários espaçados. Não mexe no estoque. */
async function addNotebookLines(day: DailyRecord, lines?: NotebookLine[]) {
  if (!lines?.length) return;
  const at = (i: number) => new Date(`${day.date}T${String(9 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}:00`).toISOString();
  await db.cashMovements.bulkAdd(lines.map((l, i) => {
    const base = { id: uid(), dailyRecordId: day.id, relatedOrderId: null, createdAt: at(i), paymentMethod: 'dinheiro' as PaymentMethod };
    if (l.kind === 'venda') return { ...base, type: 'venda' as const, amountInCents: l.cents, paymentMethod: l.method, quantity: l.qty,
      description: l.qty > 1 && l.cents % l.qty === 0 ? `${l.qty}× ${money(l.cents / l.qty)} · caderno` : 'caderno' };
    if (l.kind === 'dar') return { ...base, type: 'dar' as const, amountInCents: l.cents, person: l.person, description: 'caderno' };
    return { ...base, type: 'pagamento' as const, amountInCents: l.cents, quantity: l.days, description: l.ref ? `diária de ${l.ref}` : 'caderno' };
  }));
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

const STOCK_TABLES = () => [db.dailyRecords, db.dailyStockItems, db.stockMovements, db.variants, db.reservations];

/** Redução que deixaria menos peças físicas do que as reservadas: a tela pergunta antes de seguir. */
export class ReservedError extends UserError {
  constructor(public reserved: number, public customers: string[]) {
    super(`${reserved} ${reserved === 1 ? 'peça está reservada' : 'peças estão reservadas'}${customers.length ? ` para ${customers.join(', ')}` : ''}.`);
  }
}

async function checkReserved(date: string, variantId: string, newBalance: number) {
  const res = (await db.reservations.where('variantId').equals(variantId).toArray())
    .filter((r) => r.status === 'active' && r.date <= date);
  const reserved = res.reduce((s, r) => s + r.quantity, 0);
  // estoque negativo é recusado em applyStockDelta (mensagem própria); aqui só reserva de verdade
  if (reserved > 0 && newBalance >= 0 && newBalance < reserved) throw new ReservedError(reserved, res.map((r) => r.customer).filter(Boolean) as string[]);
}

export interface StockOpts { allowBelowReserved?: boolean }

export async function moveStock(dailyRecordId: string, variantId: string, delta: number, type: MovementType, description?: string, opts: StockOpts = {}) {
  if (!isQty(Math.abs(delta))) throw new UserError('Quantidade inválida.');
  if (!['entrada', 'saida', 'perda', 'ajuste', 'correcao'].includes(type)) throw new UserError('Tipo de movimento inválido.');
  if ((type === 'entrada' && delta < 0) || ((type === 'saida' || type === 'perda') && delta > 0)) throw new UserError('Quantidade inválida.');
  return db.transaction('rw', STOCK_TABLES(), async () => {
    const day = await assertOpen(dailyRecordId);
    if (!(await db.variants.get(variantId))) throw new UserError('Peça não encontrada.');
    if (delta < 0 && !opts.allowBelowReserved) {
      const item = await ensureItem(dailyRecordId, variantId);
      await checkReserved(day.date, variantId, item.currentQuantity + delta);
    }
    return applyStockDelta(dailyRecordId, variantId, delta, type, { description });
  });
}

/** Edição direta da quantidade: gera um ajuste com a diferença (ajuste não é venda). */
export async function setStock(dailyRecordId: string, variantId: string, quantity: number, description = 'Ajuste manual', opts: StockOpts = {}) {
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > MAX_QTY) throw new UserError('Quantidade inválida.');
  return db.transaction('rw', STOCK_TABLES(), async () => {
    const day = await assertOpen(dailyRecordId);
    if (!(await db.variants.get(variantId))) throw new UserError('Peça não encontrada.');
    const item = await ensureItem(dailyRecordId, variantId);
    const delta = quantity - item.currentQuantity;
    if (delta === 0) return null;
    if (delta < 0 && !opts.allowBelowReserved) await checkReserved(day.date, variantId, quantity);
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
    if (!mv.quantity) throw new UserError('Este registro não mexe no estoque.');
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

/** Dia começou errado (do zero x continuar)? Enquanto nada foi lançado, dá para desfazer e escolher de novo. */
export async function dayIsEmpty(dailyRecordId: string) {
  const [m, o, c, r] = await Promise.all([
    db.stockMovements.where('dailyRecordId').equals(dailyRecordId).count(),
    db.orders.where('dailyRecordId').equals(dailyRecordId).count(),
    db.cashMovements.where('dailyRecordId').equals(dailyRecordId).filter((x) => !x.auto).count(),
    db.reservations.where('dailyRecordId').equals(dailyRecordId).count(),
  ]);
  return m + o + c + r === 0;
}

export async function undoStartDay(dailyRecordId: string) {
  return db.transaction('rw', [db.dailyRecords, db.dailyStockItems, db.cashRecords, db.stockMovements, db.orders, db.cashMovements, db.reservations, db.auditLogs], async () => {
    const day = await assertOpen(dailyRecordId);
    if (!(await dayIsEmpty(day.id))) throw new UserError('Este dia já tem lançamentos. Para corrigir, use Desfazer nos movimentos ou cancele as vendas.');
    await db.dailyStockItems.where('dailyRecordId').equals(day.id).delete();
    await db.cashMovements.where('dailyRecordId').equals(day.id).delete(); // só a diária automática (o dia está vazio)
    await db.cashRecords.where('dailyRecordId').equals(day.id).delete();
    await db.dailyRecords.delete(day.id);
    await audit('day', day.id, 'undo_start', { date: day.date, sourceDate: day.sourceDate }, null);
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

/**
 * Virou a data: encerra sozinho os dias que ficaram abertos antes de hoje (o caixa contado fica como estava).
 * Dia reaberto de propósito (para corrigir) não fecha de novo. Devolve as datas encerradas.
 */
export async function autoCloseOldDays(today = todayStr()) {
  const open = (await db.dailyRecords.where('status').equals('open').toArray())
    .filter((d) => d.date < today && !d.reopenedAt);
  for (const d of open) {
    await closeDay(d.id);
    await db.dailyRecords.update(d.id, { autoClosedAt: nowIso() });
  }
  return open.map((d) => d.date).sort();
}

export async function reopenDay(dailyRecordId: string) {
  await db.transaction('rw', db.dailyRecords, db.cashRecords, db.auditLogs, async () => {
    const now = nowIso();
    await db.dailyRecords.update(dailyRecordId, { status: 'open', closedAt: null, autoClosedAt: null, reopenedAt: now, updatedAt: now });
    const cash = await db.cashRecords.where('dailyRecordId').equals(dailyRecordId).first();
    if (cash) await db.cashRecords.update(cash.id, { status: 'open' });
    await audit('day', dailyRecordId, 'reopen');
  });
}

export async function setDayNotes(dailyRecordId: string, notes: string) {
  await db.dailyRecords.update(dailyRecordId, { notes, updatedAt: nowIso() });
}

/**
 * Conserta dados gravados antes: a quantidade do cadastro era lançada como "entrada" (aparecia em
 * "Entrou no estoque"). Vira o estoque com que a cor começou o dia. O estoque final não muda.
 * Roda uma vez (marca em configurações); roda de novo sem efeito.
 */
export async function migrateCadastroEntries() {
  return db.transaction('rw', [db.stockMovements, db.dailyStockItems, db.settings], async () => {
    if (await db.settings.where('key').equals('migrCadastroV1').first()) return 0;
    const all = await db.stockMovements.where('type').equals('entrada').toArray();
    const undone = new Set((await db.stockMovements.toArray()).map((m) => m.reversedMovementId).filter(Boolean));
    let n = 0;
    const ids: string[] = [];
    for (const m of all) {
      if (m.description !== 'Quantidade inicial do cadastro' || undone.has(m.id)) continue;
      const it = await db.dailyStockItems.where('[dailyRecordId+variantId]').equals([m.dailyRecordId, m.variantId]).first();
      if (!it) continue;
      await db.dailyStockItems.update(it.id, { initialQuantity: it.initialQuantity + m.quantity });
      await db.stockMovements.delete(m.id);
      ids.push(m.id); n++;
    }
    await addTombstones(ids);
    await db.settings.add({ id: uid(), key: 'migrCadastroV1', value: { at: nowIso(), fixed: n } });
    return n;
  });
}
