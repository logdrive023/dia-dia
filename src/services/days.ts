import { db } from '../db/db';
import type { DailyRecord, DailyStockItem, EntryKind, MovementType, PaymentMethod, StockMovement } from '../db/types';
import { isQty, MAX_QTY, money, nowIso, todayStr, uid } from '../lib/util';
import { audit } from './audit';
import { UserError } from './catalog';
import { addTombstones } from './sync';
import { actor } from '../lib/actor';

export async function getDayByDate(date: string) {
  return db.dailyRecords.where('date').equals(date).first();
}

/** Último dia registrado antes da data informada. */
export async function previousDay(date: string) {
  return db.dailyRecords.where('date').below(date).last();
}

/** O dia de HOJE, se já começou e está aberto (o cadastro com quantidade entra nele). */
export async function todayOpenDay() {
  const d = await db.dailyRecords.where('date').equals(todayStr()).first();
  return d && d.status === 'open' ? d : null;
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
      // cor antiga (arquivada ou excluída) que ainda tinha peças continua no dia: nunca some estoque sem registro.
      // Ela fica fora do total, com o aviso “cor antiga ainda tem peças” e o botão Resolver (passar ou zerar).
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
  extra: Partial<Pick<StockMovement, 'description' | 'orderId' | 'reversedMovementId' | 'entryKind' | 'importId'>> = {},
) {
  const item = await ensureItem(dailyRecordId, variantId);
  const newBalance = item.currentQuantity + delta;
  if (newBalance < 0) throw new UserError('O estoque não pode ficar negativo.');
  await db.dailyStockItems.update(item.id, { currentQuantity: newBalance });
  const mv: StockMovement = {
    id: uid(), dailyRecordId, variantId, type, quantity: delta, previousBalance: item.currentQuantity,
    newBalance, createdAt: nowIso(), by: actor(), ...extra,
  };
  await db.stockMovements.add(mv);
  return mv;
}

const STOCK_TABLES = () => [db.dailyRecords, db.dailyStockItems, db.stockMovements, db.variants, db.groups, db.reservations];

/**
 * A cor pode receber venda, entrada, saída, reserva ou troca? Cor antiga (arquivada/excluída, ou grupo arquivado) não:
 * as peças dela se resolvem pelo “Resolver” do Estoque (passar para a cor certa ou zerar). Regra do serviço, não só da tela.
 */
export async function assertLiveVariant(variantId: string) {
  const v = await db.variants.get(variantId);
  if (!v) throw new UserError('Peça não encontrada.');
  const g = await db.groups.get(v.groupId);
  if (v.deletedAt || v.archivedAt || g?.archivedAt)
    throw new UserError(`“${v.name}” é uma cor antiga (${v.deletedAt ? 'excluída' : 'arquivada'}). No Estoque, toque em “Resolver” para passar as peças para a cor certa ou zerar.`);
  return v;
}

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

export interface StockOpts {
  allowBelowReserved?: boolean;
  /** entrada: mercadoria nova ou reposição. Em setStock, subir a quantidade com isto vira ENTRADA (chegou mercadoria), não ajuste. */
  entryKind?: EntryKind;
}

export async function moveStock(dailyRecordId: string, variantId: string, delta: number, type: MovementType, description?: string, opts: StockOpts = {}) {
  if (!isQty(Math.abs(delta))) throw new UserError('Quantidade inválida.');
  if (!['entrada', 'saida', 'perda', 'ajuste', 'correcao'].includes(type)) throw new UserError('Tipo de movimento inválido.');
  if ((type === 'entrada' && delta < 0) || ((type === 'saida' || type === 'perda') && delta > 0)) throw new UserError('Quantidade inválida.');
  return db.transaction('rw', STOCK_TABLES(), async () => {
    const day = await assertOpen(dailyRecordId);
    await assertLiveVariant(variantId);
    if (delta < 0 && !opts.allowBelowReserved) {
      const item = await ensureItem(dailyRecordId, variantId);
      await checkReserved(day.date, variantId, item.currentQuantity + delta);
    }
    return applyStockDelta(dailyRecordId, variantId, delta, type, { description, ...(type === 'entrada' ? { entryKind: opts.entryKind ?? null } : {}) });
  });
}

/** Edição direta da quantidade: gera um ajuste com a diferença (ajuste não é venda). */
export async function setStock(dailyRecordId: string, variantId: string, quantity: number, description = 'Ajuste manual', opts: StockOpts = {}) {
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > MAX_QTY) throw new UserError('Quantidade inválida.');
  return db.transaction('rw', STOCK_TABLES(), async () => {
    const day = await assertOpen(dailyRecordId);
    await assertLiveVariant(variantId);
    const item = await ensureItem(dailyRecordId, variantId);
    const delta = quantity - item.currentQuantity;
    if (delta === 0) return null;
    if (delta < 0 && !opts.allowBelowReserved) await checkReserved(day.date, variantId, quantity);
    // subiu porque chegou mercadoria: é entrada (nova ou reposição), não ajuste
    if (delta > 0 && opts.entryKind) return applyStockDelta(dailyRecordId, variantId, delta, 'entrada', { entryKind: opts.entryKind, description: description === 'Ajuste manual' ? undefined : description });
    return applyStockDelta(dailyRecordId, variantId, delta, 'ajuste', { description });
  });
}

/**
 * Cor antiga (arquivada/excluída) que ainda tem peças no dia: passa o saldo para outra cor
 * (a "nova" com o mesmo nome, por exemplo) ou zera. Fica registrado como ajuste nas duas cores.
 */
export async function settleRetiredStock(dailyRecordId: string, variantId: string, toVariantId: string | null) {
  return db.transaction('rw', STOCK_TABLES(), async () => {
    await assertOpen(dailyRecordId);
    const v = await db.variants.get(variantId);
    if (!v) throw new UserError('Peça não encontrada.');
    const item = await ensureItem(dailyRecordId, variantId);
    const n = item.currentQuantity;
    if (n === 0) return 0;
    if (toVariantId) {
      const to = await db.variants.get(toVariantId);
      if (!to || to.archivedAt || to.id === variantId) throw new UserError('Escolha uma cor ativa para receber as peças.');
      await applyStockDelta(dailyRecordId, variantId, -n, 'ajuste', { description: `Passou ${n} para “${to.name}” (cor antiga)` });
      await applyStockDelta(dailyRecordId, toVariantId, n, 'ajuste', { description: `Veio ${n} de “${v.name}” (cor antiga)` });
    } else {
      await applyStockDelta(dailyRecordId, variantId, -n, 'ajuste', { description: `Cor antiga zerada: ${n} não existiam (estavam repetidas)` });
    }
    return n;
  });
}

/**
 * Desfaz uma movimentação de estoque com uma movimentação inversa (nunca apaga).
 * Movimento de um dia já encerrado: o desfazimento entra no dia de HOJE, ligado ao original
 * (o dia encerrado não muda).
 */
export async function undoMovement(movementId: string) {
  return db.transaction('rw', STOCK_TABLES(), async () => {
    const mv = await db.stockMovements.get(movementId);
    if (!mv) throw new UserError('Movimentação não encontrada.');
    if (mv.orderId) throw new UserError('Esta movimentação é de uma venda. Cancele a venda.');
    if (mv.reversedMovementId) throw new UserError('Esta movimentação já é um estorno.');
    if (!mv.quantity) throw new UserError('Este registro não mexe no estoque.');
    const already = await db.stockMovements.filter((m) => m.reversedMovementId === movementId).count();
    if (already) throw new UserError('Esta movimentação já foi desfeita.');
    const origDay = await db.dailyRecords.get(mv.dailyRecordId);
    let dayId = mv.dailyRecordId;
    if (origDay?.status === 'closed') {
      const today = await todayOpenDay();
      if (!today) throw new UserError('Este movimento é de um dia encerrado. Inicie o dia de hoje para desfazer (o desfazimento entra hoje).');
      dayId = today.id;
    } else await assertOpen(mv.dailyRecordId);
    return applyStockDelta(dayId, mv.variantId, -mv.quantity, 'correcao', {
      reversedMovementId: mv.id, description: origDay?.status === 'closed' ? `Desfazer movimentação de ${origDay.date.split('-').reverse().join('/')}` : 'Desfazer movimentação',
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
    // a correção anda pela cadeia inteira: se 02/11 foi corrigido, 03/11 (mesmo encerrado) e hoje acompanham.
    // Para no dia que começou “do zero” (ele não copiou do anterior). Cada dia mantém os próprios movimentos.
    const all = (await db.dailyRecords.orderBy('date').toArray()).filter((d) => d.date <= day.date);
    let first = all.length - 1;
    while (first > 0 && all[first].sourceDate) first--;
    let total = 0;
    for (let k = Math.max(first, 1); k < all.length; k++) {
      if (!all[k].sourceDate) continue;
      total += await resyncOne(all[k - 1], all[k]);
    }
    return total;
  });
}

/** Começou de `day` = terminou de `prev`, só para as cores que existiam em `prev` (cor nova do dia fica com o cadastro). */
async function resyncOne(prev: DailyRecord, day: DailyRecord) {
  const prevItems = await db.dailyStockItems.where('dailyRecordId').equals(prev.id).toArray();
  const changes: { variantId: string; from: number; to: number }[] = [];
  // só as cores que existiam ontem: cor cadastrada hoje (não estava no dia anterior) começa com a
  // quantidade do cadastro. Antes ela ia para 0 aqui (caso real: Dorado › Azul 5 → 0 em 03/11).
  for (const p of prevItems) {
    const item = await ensureItem(day.id, p.variantId);
    const to = p.currentQuantity;
    const delta = to - item.initialQuantity;
    if (!delta) continue;
    if (item.currentQuantity + delta < 0)
      throw new UserError(`A correção deixaria um estoque negativo em ${day.date.split('-').reverse().join('/')}. Revise as vendas desse dia.`);
    await db.dailyStockItems.update(item.id, { initialQuantity: to, currentQuantity: item.currentQuantity + delta });
    changes.push({ variantId: p.variantId, from: item.initialQuantity, to });
  }
  if (!changes.length) return 0;
  await db.dailyRecords.update(day.id, { sourceDate: prev.date, updatedAt: nowIso() });
  await audit('day', day.id, 'resync', null, { from: prev.date, changes });
  return changes.length;
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
