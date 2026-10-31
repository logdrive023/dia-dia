import { db } from '../db/db';
import type { CashType, PaymentMethod } from '../db/types';
import { isCents, nowIso, PAYMENTS, uid } from '../lib/util';
import { audit } from './audit';
import { UserError } from './catalog';
import { assertOpen } from './days';
import { getSetting } from './settings';

export const CASH_LABEL: Record<CashType, string> = {
  venda: 'Venda',
  entrada: 'Entrada',
  dar: 'Dei dinheiro',
  despesa: 'Despesa',
  retirada: 'Retirada',
  pagamento: 'Pagamento (diária)',
  estorno: 'Estorno de venda',
};

/** Tipos que somam (+) no caixa. */
export const CASH_IN: CashType[] = ['venda', 'entrada'];

export async function addCashMovement(p: {
  dailyRecordId: string; type: Exclude<CashType, 'venda' | 'estorno'>; amountInCents: number;
  paymentMethod?: PaymentMethod; person?: string; description?: string;
  /** pagamento: quantas diárias (ex.: 2 dias = 300) */
  quantity?: number;
}) {
  if (!isCents(p.amountInCents) || p.amountInCents <= 0) throw new UserError('Informe um valor maior que zero.');
  if (!['entrada', 'dar', 'despesa', 'retirada', 'pagamento'].includes(p.type)) throw new UserError('Tipo de lançamento inválido.');
  if (p.quantity !== undefined && (!Number.isInteger(p.quantity) || p.quantity < 1 || p.quantity > 60)) throw new UserError('Quantidade de dias inválida.');
  if (p.paymentMethod && !PAYMENTS.includes(p.paymentMethod)) throw new UserError('Forma de pagamento inválida.');
  return db.transaction('rw', db.dailyRecords, db.cashMovements, async () => {
    await assertOpen(p.dailyRecordId);
    const m = {
      id: uid(), dailyRecordId: p.dailyRecordId, type: p.type, amountInCents: p.amountInCents,
      paymentMethod: p.paymentMethod ?? 'dinheiro', person: p.person?.trim() || undefined,
      description: p.description?.trim() || undefined, relatedOrderId: null, createdAt: nowIso(),
      ...(p.type === 'pagamento' && p.quantity ? { quantity: p.quantity } : {}),
    };
    await db.cashMovements.add(m);
    return m;
  });
}

/** Remove um lançamento manual (vendas só saem cancelando a venda). Fica registrado na auditoria. */
export async function removeCashMovement(id: string) {
  await db.transaction('rw', db.dailyRecords, db.cashMovements, db.auditLogs, async () => {
    const m = await db.cashMovements.get(id);
    if (!m) return;
    // venda do caderno (sem peça) pode ser removida aqui; venda do app se cancela
    if ((m.type === 'venda' && m.relatedOrderId) || m.type === 'estorno') throw new UserError('Para tirar uma venda, cancele a venda.');
    await assertOpen(m.dailyRecordId);
    await db.cashMovements.delete(id);
    await audit('cashMovement', id, 'delete', m, null);
  });
}

/**
 * Lança a diária do dia ("diária de 31/10", em dinheiro), se estiver ligado em Configurações.
 * Não duplica: se o dia já tem a diária dele (ex.: veio do caderno), não faz nada.
 */
export async function ensureDailyPay(dailyRecordId: string) {
  if (!(await getSetting('autoDailyPay'))) return null;
  const cents = await getSetting('dailyPayInCents');
  if (!isCents(cents) || cents <= 0) return null;
  return db.transaction('rw', db.dailyRecords, db.cashMovements, async () => {
    const day = await assertOpen(dailyRecordId);
    const [, mm, dd] = day.date.split('-');
    const description = `diária de ${dd}/${mm}`;
    const has = (await db.cashMovements.where('dailyRecordId').equals(day.id).toArray()).some((m) => m.type === 'pagamento' && m.description === description);
    if (has) return null;
    const m = { id: uid(), dailyRecordId: day.id, type: 'pagamento' as const, amountInCents: cents, paymentMethod: 'dinheiro' as const,
      quantity: 1, description, relatedOrderId: null, createdAt: nowIso(), auto: true };
    await db.cashMovements.add(m);
    return m;
  });
}

/** Corrige uma venda do caderno (sem peça): valor, forma de pagamento e quantas peças. Fica na auditoria. */
export async function updateNotebookSale(id: string, p: { amountInCents: number; paymentMethod: PaymentMethod; quantity: number }) {
  if (!isCents(p.amountInCents) || p.amountInCents <= 0) throw new UserError('Informe um valor maior que zero.');
  if (!PAYMENTS.includes(p.paymentMethod)) throw new UserError('Forma de pagamento inválida.');
  if (!Number.isInteger(p.quantity) || p.quantity < 1 || p.quantity > 9999) throw new UserError('Quantidade inválida.');
  await db.transaction('rw', db.dailyRecords, db.cashMovements, db.auditLogs, async () => {
    const m = await db.cashMovements.get(id);
    if (!m || m.type !== 'venda' || m.relatedOrderId) throw new UserError('Venda não encontrada.');
    await assertOpen(m.dailyRecordId);
    const next = { amountInCents: p.amountInCents, paymentMethod: p.paymentMethod, quantity: p.quantity, description: 'caderno' };
    await db.cashMovements.update(id, next);
    await audit('cashMovement', id, 'update', m, { ...m, ...next });
  });
}

/** Digita o "Ontem" à mão (e quanto dele é dinheiro vivo). `null` volta a calcular a partir do dia anterior. */
export async function setOpeningBalance(dailyRecordId: string, cents: number | null, cashCents: number | null = null) {
  if ((cents !== null && !isCents(cents)) || (cashCents !== null && !isCents(cashCents))) throw new UserError('Valor inválido.');
  if (cents !== null && cashCents !== null && cashCents > cents) throw new UserError('O dinheiro vivo não pode ser maior que o total.');
  await db.transaction('rw', db.dailyRecords, db.cashRecords, db.auditLogs, async () => {
    await assertOpen(dailyRecordId);
    const c = await db.cashRecords.where('dailyRecordId').equals(dailyRecordId).first();
    const patch = { openingBalanceInCents: cents ?? 0, openingManual: cents !== null, openingCashInCents: cents === null ? null : cashCents };
    if (!c) {
      await db.cashRecords.add({ id: uid(), dailyRecordId, countedBalanceInCents: null, status: 'open', ...patch });
      return;
    }
    await db.cashRecords.update(c.id, patch);
    await audit('cash', c.id, 'set_opening', c.openingManual ? c.openingBalanceInCents : 'auto', cents ?? 'auto');
  });
}

export async function setCountedBalance(dailyRecordId: string, cents: number | null) {
  if (cents !== null && !isCents(cents)) throw new UserError('Valor inválido.');
  await db.transaction('rw', db.dailyRecords, db.cashRecords, async () => {
    await assertOpen(dailyRecordId);
    const c = await db.cashRecords.where('dailyRecordId').equals(dailyRecordId).first();
    if (c) await db.cashRecords.update(c.id, { countedBalanceInCents: cents });
  });
}
