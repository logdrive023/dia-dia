/**
 * Histórico de movimentações: a vida de cada cor/produto desde o cadastro, montada só com o que já
 * está gravado (estoque de cada dia, movimentos, vendas, reservas, registro de alterações).
 * Nada é inventado: se a conta não fecha, aparece como DIVERGÊNCIA (nunca vira um ajuste).
 */
import { db } from '../db/db';
import type { AuditLog, DailyRecord, DailyStockItem, Group, StockMovement, Variant } from '../db/types';

export type HistKind =
  | 'inicial' | 'nova' | 'reposicao' | 'entrada' | 'importacao' | 'venda' | 'reserva' | 'cancelamento'
  | 'ajuste' | 'saida' | 'perda' | 'desfazer' | 'cadastro' | 'divergencia';

export const KIND_LABEL: Record<HistKind, string> = {
  inicial: 'Estoque inicial', nova: 'Entrada · mercadoria nova', reposicao: 'Entrada · reposição', entrada: 'Entrada',
  importacao: 'Importação', venda: 'Venda', reserva: 'Reserva', cancelamento: 'Cancelamento', ajuste: 'Ajuste manual',
  saida: 'Saída', perda: 'Perda', desfazer: 'Desfazimento', cadastro: 'Alteração no cadastro', divergencia: 'Divergência não explicada',
};
export const KIND_ICON: Record<HistKind, string> = {
  inicial: '🌅', nova: '📦', reposicao: '🔁', entrada: '📥', importacao: '📋', venda: '🛍️', reserva: '📌', cancelamento: '✖️',
  ajuste: '✏️', saida: '📤', perda: '💔', desfazer: '↩️', cadastro: '🗂️', divergencia: '⚠️',
};

/** Quem fez: o app sozinho (efeito de uma venda/reserva), a usuária (à mão) ou registro antigo sem essa informação. */
export type HistOrigin = 'sistema' | 'usuaria' | 'antigo';

export interface HistEvent {
  id: string;
  at: string;
  /** data do dia em que entrou */
  date: string;
  variantId: string;
  kind: HistKind;
  /** texto curto: “Venda de 2”, “Ajuste manual −3”… */
  text: string;
  before?: number;
  delta?: number;
  after?: number;
  origin: HistOrigin;
  by?: string | null;
  /** o registro de origem (para localizar) */
  ref?: { type: 'venda' | 'reserva' | 'movimento' | 'importacao'; id: string };
  reason?: string;
  movementId?: string;
  /** dá para desfazer pelo histórico */
  undoable?: boolean;
  /** já foi desfeito (o original fica; o desfazimento aparece como outro registro) */
  undone?: boolean;
}

export interface DayLine {
  date: string;
  status: DailyRecord['status'];
  start: number;
  end: number;
  /** começou − terminou do dia anterior (≠ 0 = o dia começou diferente do que terminou ontem) */
  carryGap: number;
  /** começou + movimentos − terminou (≠ 0 = divergência no dia) */
  gap: number;
  events: HistEvent[];
}

const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');

type Timed = { at: string; before?: number; after?: number };

/**
 * Do mais antigo para o mais novo. Mesmo horário (dois toques no mesmo milissegundo): monta a corrente
 * do saldo — “8 → 36”, depois “36 → 40”, depois “40 → 37” (o id do registro é sorteado e não diz a ordem).
 */
export function sortChronological<T extends Timed>(list: T[]): T[] {
  const sorted = [...list].sort((a, b) => a.at.localeCompare(b.at));
  const out: T[] = [];
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j < sorted.length && sorted[j].at === sorted[i].at) j++;
    const rest = sorted.slice(i, j);
    const chain: T[] = [];
    while (rest.length) {
      const last = chain[chain.length - 1];
      // continua do último saldo; senão, começa por quem não continua nenhum outro do grupo
      let k = last && last.after !== undefined ? rest.findIndex((e) => e.before === last.after) : -1;
      if (k < 0) k = rest.findIndex((e) => !rest.some((o) => o !== e && o.after !== undefined && o.after === e.before && o.before !== e.after));
      if (k < 0) k = 0;
      chain.push(rest.splice(k, 1)[0]);
    }
    out.push(...chain);
    i = j;
  }
  return out;
}

/** Converte um movimento gravado em um registro do histórico. */
export function movementEvent(m: StockMovement, date: string, undoneIds: Set<string>): HistEvent {
  const n = Math.abs(m.quantity);
  const base = {
    id: m.id, at: m.createdAt, date, variantId: m.variantId, before: m.previousBalance, delta: m.quantity, after: m.newBalance,
    by: m.by ?? null, movementId: m.id, reason: m.description && !/^(Ajuste manual|Desfazer movimentação|Venda cancelada)$/.test(m.description) ? m.description : undefined,
  };
  // legado: sem “quem” gravado
  const manual = (by: string | null | undefined): HistOrigin => (by ? 'usuaria' : m.by === undefined ? 'antigo' : 'usuaria');
  const undone = undoneIds.has(m.id);
  switch (m.type) {
    case 'venda':
      return { ...base, kind: 'venda', text: `Venda de ${n}`, origin: 'sistema', ref: m.orderId ? { type: 'venda', id: m.orderId } : undefined };
    case 'cancelamento':
      return { ...base, kind: 'cancelamento', text: `Venda cancelada: ${n} ${n === 1 ? 'voltou' : 'voltaram'}`, origin: 'sistema', ref: m.orderId ? { type: 'venda', id: m.orderId } : undefined };
    case 'reserva':
      return { ...base, kind: 'reserva', text: m.description || 'Reserva', origin: 'sistema', ref: { type: 'reserva', id: m.id } };
    case 'entrada': {
      const kind: HistKind = m.importId ? 'importacao' : m.entryKind === 'nova' ? 'nova' : m.entryKind === 'reposicao' ? 'reposicao' : 'entrada';
      return { ...base, kind, text: `${KIND_LABEL[kind]} ${signed(m.quantity)}`, origin: manual(m.by), ref: m.importId ? { type: 'importacao', id: m.importId } : undefined, undoable: !undone, undone };
    }
    case 'ajuste':
      return { ...base, kind: 'ajuste', text: `Ajuste manual ${signed(m.quantity)} (${m.previousBalance} → ${m.newBalance})`, origin: manual(m.by), undoable: !undone, undone };
    case 'saida':
      return { ...base, kind: 'saida', text: `Saída de ${n}`, origin: manual(m.by), undoable: !undone, undone };
    case 'perda':
      return { ...base, kind: 'perda', text: `Perda de ${n}`, origin: manual(m.by), undoable: !undone, undone };
    case 'correcao':
      return { ...base, kind: 'desfazer', text: m.reversedMovementId ? `Desfeito ${signed(m.quantity)}` : `Correção ${signed(m.quantity)}`, origin: manual(m.by), ref: m.reversedMovementId ? { type: 'movimento', id: m.reversedMovementId } : undefined };
  }
}

const AUDIT_TEXT: Record<string, (a: AuditLog) => string> = {
  create: () => 'Cadastrada',
  rename: (a) => `Nome: ${a.oldValue} → ${a.newValue}`,
  set_idealStock: (a) => `Estoque ideal (meta): ${a.oldValue ?? 'do cadastro'} → ${a.newValue ?? 'do cadastro'} · não muda o estoque`,
  set_minimumStock: (a) => `Estoque mínimo: ${a.oldValue ?? 'sem'} → ${a.newValue ?? 'sem'}`,
  set_restockOff: (a) => (a.newValue ? 'Deixou de usar estoque ideal (repor)' : 'Passou a usar estoque ideal (repor)'),
  set_optionalPriceInCents: () => 'Preço alterado',
  set_size: (a) => `Tamanho: ${a.oldValue ?? 'sem'} → ${a.newValue ?? 'sem'}`,
  set_productType: (a) => `Tipo: ${a.oldValue ?? 'sem'} → ${a.newValue ?? 'sem'}`,
  archive: () => 'Arquivada', unarchive: () => 'Reativada', delete_soft: () => 'Excluída (histórico guardado)',
  for_sale_on: () => 'Colocada à venda', for_sale_off: () => 'Guardada (fora da venda)', move: () => 'Mudou de grupo',
  activate: () => 'Ativada', deactivate: () => 'Desativada',
};

export function auditEvent(a: AuditLog, date: string): HistEvent {
  const by = (a as AuditLog & { by?: string | null }).by ?? (a.newValue as { by?: string } | null)?.by ?? null;
  return { id: a.id, at: a.createdAt, date, variantId: a.entityId, kind: 'cadastro', text: (AUDIT_TEXT[a.action] ?? (() => a.action))(a), origin: by ? 'usuaria' : 'antigo', by };
}

interface Data {
  variants: Variant[]; groups: Group[]; days: DailyRecord[]; items: DailyStockItem[]; moves: StockMovement[]; audits: AuditLog[];
}

async function load(variantIds?: string[]): Promise<Data> {
  const [variants, groups, days] = await Promise.all([db.variants.toArray(), db.groups.toArray(), db.dailyRecords.orderBy('date').toArray()]);
  const only = variantIds ? new Set(variantIds) : null;
  const [items, moves, audits] = await Promise.all([
    only ? db.dailyStockItems.where('variantId').anyOf([...only]).toArray() : db.dailyStockItems.toArray(),
    only ? db.stockMovements.where('variantId').anyOf([...only]).toArray() : db.stockMovements.toArray(),
    db.auditLogs.where('entityType').equals('variant').toArray(),
  ]);
  return { variants, groups, days, items, moves, audits: only ? audits.filter((a) => only.has(a.entityId)) : audits };
}

/** Vida de uma cor: dia a dia, do primeiro registro até hoje, com divergências apontadas. */
export async function productTimeline(variantId: string): Promise<{ variant: Variant | undefined; group: Group | undefined; days: DayLine[] }> {
  const d = await load([variantId]);
  const variant = d.variants.find((v) => v.id === variantId);
  const group = d.groups.find((g) => g.id === variant?.groupId);
  const undoneIds = new Set(d.moves.map((m) => m.reversedMovementId).filter(Boolean) as string[]);
  const dayOf = new Map(d.days.map((x) => [x.id, x]));
  const out: DayLine[] = [];
  let prevEnd: number | null = null;
  for (const day of d.days) {
    const item = d.items.find((i) => i.dailyRecordId === day.id);
    const moves = sortChronological(d.moves.filter((m) => m.dailyRecordId === day.id)
      .map((m) => ({ m, at: m.createdAt, before: m.previousBalance, after: m.newBalance }))).map((x) => x.m);
    if (!item && !moves.length) continue;
    const start = item?.initialQuantity ?? 0;
    const end = item?.currentQuantity ?? 0;
    const sum = moves.reduce((n, m) => n + m.quantity, 0);
    const events: HistEvent[] = [];
    const created = variant && out.length === 0;
    events.push({
      id: `ini-${day.id}`, at: `${day.date}T00:00:00`, date: day.date, variantId, kind: 'inicial', after: start,
      text: created ? `Estoque inicial: ${start} (cadastro${variant?.origin === 'importacao' ? ' por importação' : variant?.origin === 'vender' ? ' pela tela Vender' : ''})`
        : `Começou o dia com ${start}`,
      origin: created ? (variant?.createdBy ? 'usuaria' : 'antigo') : 'sistema', by: created ? variant?.createdBy ?? null : null,
    });
    for (const m of moves) events.push(movementEvent(m, dayOf.get(m.dailyRecordId)?.date ?? day.date, undoneIds));
    const carryGap = prevEnd === null ? 0 : start - prevEnd;
    const gap = start + sum - end;
    if (carryGap) events.splice(1, 0, { id: `gapc-${day.id}`, at: `${day.date}T00:00:01`, date: day.date, variantId, kind: 'divergencia', origin: 'sistema', delta: carryGap,
      text: `Divergência não explicada: começou com ${start}, mas o dia anterior terminou com ${prevEnd} (${signed(carryGap)})` });
    if (gap) events.push({ id: `gap-${day.id}`, at: `${day.date}T23:59:59`, date: day.date, variantId, kind: 'divergencia', origin: 'sistema', delta: -gap,
      text: `Divergência não explicada: ${start} ${signed(sum)} deveria dar ${start + sum}, mas está ${end} (${signed(end - start - sum)})` });
    out.push({ date: day.date, status: day.status, start, end, carryGap, gap, events });
    prevEnd = end;
  }
  // alterações de cadastro no dia em que aconteceram (não mexem no estoque)
  for (const a of d.audits) {
    const date = new Date(a.createdAt);
    const local = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const line = out.find((l) => l.date === local) ?? out.filter((l) => l.date <= local).slice(-1)[0];
    if (line && a.action !== 'create') line.events.push(auditEvent(a, line.date));
  }
  for (const l of out) l.events = [...l.events.filter((e) => e.kind === 'inicial'), ...sortChronological(l.events.filter((e) => e.kind !== 'inicial'))];
  return { variant, group, days: out };
}

export interface HistoryFilter {
  from?: string; to?: string; groupId?: string; variantId?: string; kinds?: HistKind[]; by?: string; origin?: HistOrigin;
}

/** Todos os registros (de todas as cores) que passam nos filtros, do mais novo para o mais antigo. */
export async function historyEvents(f: HistoryFilter = {}) {
  const d = await load(f.variantId ? [f.variantId] : undefined);
  const dayOf = new Map(d.days.map((x) => [x.id, x]));
  const vOf = new Map(d.variants.map((v) => [v.id, v]));
  const undoneIds = new Set(d.moves.map((m) => m.reversedMovementId).filter(Boolean) as string[]);
  const ev: HistEvent[] = [];
  for (const m of d.moves) { const day = dayOf.get(m.dailyRecordId); if (day) ev.push(movementEvent(m, day.date, undoneIds)); }
  for (const a of d.audits) {
    const dt = new Date(a.createdAt);
    ev.push(auditEvent(a, `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`));
  }
  // do mais novo para o mais antigo
  const list = sortChronological(ev.filter((e) => {
    const v = vOf.get(e.variantId);
    if (f.from && e.date < f.from) return false;
    if (f.to && e.date > f.to) return false;
    if (f.groupId && v?.groupId !== f.groupId) return false;
    if (f.kinds?.length && !f.kinds.includes(e.kind)) return false;
    if (f.by && e.by !== f.by) return false;
    if (f.origin && e.origin !== f.origin) return false;
    return true;
  })).reverse();
  const users = [...new Set(ev.map((e) => e.by).filter(Boolean) as string[])].sort();
  return { events: list, users, variants: d.variants, groups: d.groups };
}
