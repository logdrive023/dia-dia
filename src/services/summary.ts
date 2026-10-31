import { db } from '../db/db';
import type { CashMovement, DailyStockItem, Group, MovementType, Order, PaymentMethod, Sale, StockMovement, Variant } from '../db/types';
import { money, todayStr } from '../lib/util';

export interface CashSummary {
  opening: number;
  salesByMethod: Record<PaymentMethod, number>;
  salesTotal: number;
  entradas: number;
  dar: CashMovement[];
  darTotal: number;
  despesas: number;
  retiradas: number;
  /** Pagamento das diárias (ex.: 300 = 2 × 150). Sai depois do "Ontem + hoje", como a retirada. */
  pagamentos: number;
  /** Quantas diárias foram pagas no dia. */
  pagamentoDias: number;
  /** Só dinheiro vivo, antes de retirada/pagamento ("935 - 50 = 885" do caderno). */
  cashToday: number;
  /** Vendas + entradas - dei - despesas ("935 - 50 = 885") */
  todayNet: number;
  /** Ontem + hoje */
  subtotal: number;
  /** Ontem + hoje - retiradas - pagamentos, somando todas as formas de pagamento. */
  accumulated: number;
  /** Dinheiro vivo que deveria estar em mãos (só lançamentos em dinheiro). É o que se confere contando. */
  cashOnHand: number;
  /** Dinheiro vivo que veio do dia anterior. */
  openingCash: number;
  /** Parte do saldo que não é dinheiro vivo (Pix, Cartão, Outro). */
  otherBalance: number;
  counted: number | null;
  /** Vendas copiadas do caderno (sem peça): quantas e quantas peças. */
  notebookCount: number;
  notebookUnits: number;
  /** Resultado do dia com todas as saídas (vendas + entradas − dei − despesas − pagamento − retirada) = saldo − ontem. */
  dayResult: number;
  /** Contado - dinheiro em mãos */
  difference: number | null;
  /** true quando o "Ontem" foi digitado à mão em vez de vir do dia anterior */
  openingManual: boolean;
  movements: CashMovement[];
}

/**
 * Caixa de todos os dias até `uptoDate`, em ordem: o "Ontem" de cada dia é o saldo final do dia
 * registrado anterior (a menos que tenha sido digitado à mão). Assim, corrigir um dia passado
 * atualiza a conta dos dias seguintes.
 */
export async function cashChain(uptoDate?: string): Promise<Map<string, CashSummary>> {
  const days = uptoDate
    ? await db.dailyRecords.where('date').belowOrEqual(uptoDate).sortBy('date')
    : await db.dailyRecords.orderBy('date').toArray();
  // uma leitura de cada tabela (bem mais rápido que buscar dia por dia quando há meses de uso)
  const ids = new Set(days.map((d) => d.id));
  const [allRecs, allMoves] = await Promise.all([db.cashRecords.toArray(), db.cashMovements.toArray()]);
  const recs = allRecs.filter((r) => ids.has(r.dailyRecordId));
  const moves = allMoves.filter((m) => ids.has(m.dailyRecordId));
  const recBy = new Map(recs.map((r) => [r.dailyRecordId, r]));
  const movesBy = new Map<string, CashMovement[]>();
  for (const m of moves.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))) {
    const list = movesBy.get(m.dailyRecordId);
    if (list) list.push(m); else movesBy.set(m.dailyRecordId, [m]);
  }
  const out = new Map<string, CashSummary>();
  let prev = 0, prevCash = 0;
  for (const d of days) {
    const rec = recBy.get(d.id);
    const manual = !!rec?.openingManual;
    const opening = manual ? rec!.openingBalanceInCents : prev;
    // "Ontem" digitado à mão sem dizer quanto é dinheiro: considera tudo dinheiro
    const openingCash = manual ? (rec!.openingCashInCents ?? rec!.openingBalanceInCents) : prevCash;
    const s = summarizeCash(opening, openingCash, manual, rec?.countedBalanceInCents ?? null, movesBy.get(d.id) ?? []);
    out.set(d.id, s);
    prev = s.accumulated;
    prevCash = s.cashOnHand;
  }
  return out;
}

export async function computeCash(dailyRecordId: string): Promise<CashSummary> {
  const day = await db.dailyRecords.get(dailyRecordId);
  const s = day && (await cashChain(day.date)).get(day.id);
  return s ?? summarizeCash(0, 0, false, null, []);
}

function summarizeCash(opening: number, openingCash: number, openingManual: boolean, counted: number | null, movements: CashMovement[]): CashSummary {
  const salesByMethod: Record<PaymentMethod, number> = { dinheiro: 0, pix: 0, cartao: 0, debito: 0, outro: 0 };
  let entradas = 0, darTotal = 0, despesas = 0, retiradas = 0, pagamentos = 0, pagamentoDias = 0, cashToday = 0;
  const dar: CashMovement[] = [];
  let cashDelta = 0;
  for (const m of movements) {
    if (m.paymentMethod === 'dinheiro') {
      const v = ['venda', 'entrada'].includes(m.type) ? m.amountInCents : -m.amountInCents;
      cashDelta += v;
      if (m.type !== 'retirada' && m.type !== 'pagamento') cashToday += v;
    }
    switch (m.type) {
      case 'venda': salesByMethod[m.paymentMethod] += m.amountInCents; break;
      case 'estorno': salesByMethod[m.paymentMethod] -= m.amountInCents; break;
      case 'entrada': entradas += m.amountInCents; break;
      case 'dar': darTotal += m.amountInCents; dar.push(m); break;
      case 'despesa': despesas += m.amountInCents; break;
      case 'retirada': retiradas += m.amountInCents; break;
      case 'pagamento': pagamentos += m.amountInCents; pagamentoDias += m.quantity ?? 0; break;
    }
  }
  const salesTotal = Object.values(salesByMethod).reduce((a, b) => a + b, 0);
  const notebook = movements.filter((m) => m.type === 'venda' && !m.relatedOrderId);
  const todayNet = salesTotal + entradas - darTotal - despesas;
  const subtotal = opening + todayNet;
  const accumulated = subtotal - retiradas - pagamentos;
  const cashOnHand = openingCash + cashDelta;
  return {
    opening, salesByMethod, salesTotal, entradas, dar, darTotal, despesas, retiradas, pagamentos, pagamentoDias, cashToday, todayNet, subtotal,
    accumulated, cashOnHand, openingCash, otherBalance: accumulated - cashOnHand,
    counted, difference: counted === null ? null : counted - cashOnHand, openingManual, movements,
    dayResult: accumulated - opening,
    notebookCount: notebook.length, notebookUnits: notebook.reduce((n, m) => n + (m.quantity ?? 1), 0),
  };
}

export interface StockRow {
  item: DailyStockItem;
  variant: Variant;
  group: Group;
  reserved: number;
  available: number;
  /** estoque ideal (cadastro ou definido à mão) */
  ideal: number;
  /** quantas peças faltam para chegar no ideal */
  restock: number;
  /** falta repor, mas ainda tem peça */
  low: boolean;
  out: boolean;
}

/** Estoque ideal da variação: o que foi definido à mão ou, se não, a quantidade do cadastro. */
export const idealOf = (v: Variant) => v.idealStock ?? v.startQuantity;

export async function loadStockRows(dailyRecordId: string, date: string): Promise<StockRow[]> {
  const [items, variants, groups, res] = await Promise.all([
    db.dailyStockItems.where('dailyRecordId').equals(dailyRecordId).toArray(),
    db.variants.toArray(),
    db.groups.toArray(),
    db.reservations.where('status').equals('active').toArray(),
  ]);
  const vMap = new Map(variants.map((v) => [v.id, v]));
  const gMap = new Map(groups.map((g) => [g.id, g]));
  const reserved = new Map<string, number>();
  for (const r of res) if (r.date <= date) reserved.set(r.variantId, (reserved.get(r.variantId) ?? 0) + r.quantity);
  // variações cadastradas depois que o dia começou aparecem com 0 (o registro é criado na primeira mudança)
  const has = new Set(items.map((i) => i.variantId));
  const all = [...items];
  for (const v of variants)
    if (!has.has(v.id) && !v.archivedAt && todayStr(new Date(v.createdAt)) <= date)
      all.push({ id: `virtual-${v.id}`, dailyRecordId, variantId: v.id, initialQuantity: 0, currentQuantity: 0 });
  const rows: StockRow[] = [];
  for (const item of all) {
    const variant = vMap.get(item.variantId);
    const group = variant && gMap.get(variant.groupId);
    if (!variant || !group) continue;
    const r = reserved.get(variant.id) ?? 0;
    const ideal = idealOf(variant);
    const available = item.currentQuantity - r;
    const restock = Math.max(0, ideal - item.currentQuantity);
    rows.push({ item, variant, group, reserved: r, available, ideal, restock, out: available <= 0, low: available > 0 && restock > 0 });
  }
  rows.sort((a, b) => a.group.displayOrder - b.group.displayOrder || a.variant.displayOrder - b.variant.displayOrder);
  return rows;
}

export interface DaySummary {
  totalUnits: number;
  initialUnits: number;
  soldUnits: number;
  enteredUnits: number;
  outUnits: number;
  adjustUnits: number;
  orders: Order[];
  sales: Sale[];
  soldByVariant: { variant: Variant; group: Group; qty: number }[];
  enteredByVariant: { variant: Variant; group: Group; qty: number }[];
  /** variações para repor (falta peça para o ideal, ou esgotadas) */
  restock: StockRow[];
  /** vendas do dia (inclui as do caderno) */
  salesCount: number;
  /** total de peças para repor */
  restockUnits: number;
  cash: CashSummary;
}

export async function daySummary(dailyRecordId: string, date: string): Promise<DaySummary> {
  const [rows, movements, orders, sales, cash] = await Promise.all([
    loadStockRows(dailyRecordId, date),
    db.stockMovements.where('dailyRecordId').equals(dailyRecordId).toArray(),
    db.orders.where('dailyRecordId').equals(dailyRecordId).sortBy('createdAt'),
    db.sales.where('dailyRecordId').equals(dailyRecordId).toArray(),
    computeCash(dailyRecordId),
  ]);
  const byVariant = new Map(rows.map((r) => [r.variant.id, r]));
  const okOrders = orders.filter((o) => o.status === 'ok');
  const okSales = sales.filter((s) => s.status === 'ok');
  const sold = new Map<string, number>();
  for (const s of okSales) sold.set(s.variantId, (sold.get(s.variantId) ?? 0) + s.quantity);
  const entered = new Map<string, number>();
  let enteredUnits = 0, outUnits = 0, adjustUnits = 0;
  for (const m of effectiveMovements(movements)) {
    if (m.type === 'entrada') { enteredUnits += m.quantity; entered.set(m.variantId, (entered.get(m.variantId) ?? 0) + m.quantity); }
    if (m.type === 'saida' || m.type === 'perda') outUnits += -m.quantity;
    if (m.type === 'ajuste' || m.type === 'correcao') adjustUnits += m.quantity;
  }
  const toList = (m: Map<string, number>) =>
    [...m.entries()].filter(([, q]) => q).map(([id, qty]) => ({ ...byVariant.get(id)!, qty }))
      .filter((x) => x.variant)
      .sort((a, b) => a.group.displayOrder - b.group.displayOrder || a.variant.displayOrder - b.variant.displayOrder)
      .map(({ variant, group, qty }) => ({ variant, group, qty }));
  return {
    totalUnits: rows.reduce((s, r) => s + r.item.currentQuantity, 0),
    initialUnits: rows.reduce((s, r) => s + r.item.initialQuantity, 0),
    soldUnits: okSales.reduce((s, x) => s + x.quantity, 0) + cash.notebookUnits,
    salesCount: okOrders.length + cash.notebookCount,
    enteredUnits, outUnits, adjustUnits,
    orders: okOrders, sales: okSales,
    soldByVariant: toList(sold),
    enteredByVariant: toList(entered),
    restock: rows.filter((r) => !r.variant.archivedAt && r.variant.active && !r.group.archivedAt && r.group.active && (r.restock > 0 || r.out)),
    restockUnits: rows.filter((r) => !r.variant.archivedAt && r.variant.active && !r.group.archivedAt && r.group.active).reduce((s, r) => s + r.restock, 0),
    cash,
  };
}

/** Tira do resumo os movimentos desfeitos e os estornos deles (uma entrada desfeita não “entrou”). */
export function effectiveMovements(moves: StockMovement[]) {
  const undone = new Set(moves.map((m) => m.reversedMovementId).filter(Boolean));
  return moves.filter((m) => !m.reversedMovementId && !undone.has(m.id));
}

// ---------------- dia anterior alterado ----------------

export interface SyncGap {
  prevDate: string;
  diffs: { variantId: string; expected: number; initial: number }[];
  units: number;
}

/**
 * Dias são independentes: o estoque inicial é uma cópia feita quando o dia começou.
 * Se o dia anterior foi corrigido depois, isto mostra a diferença para a usuária decidir.
 */
export async function syncGap(dailyRecordId: string): Promise<SyncGap | null> {
  const day = await db.dailyRecords.get(dailyRecordId);
  if (!day || !day.sourceDate) return null; // criado em branco: não compara
  const prev = await db.dailyRecords.where('date').below(day.date).last();
  if (!prev) return null;
  const [prevItems, items] = await Promise.all([
    db.dailyStockItems.where('dailyRecordId').equals(prev.id).toArray(),
    db.dailyStockItems.where('dailyRecordId').equals(day.id).toArray(),
  ]);
  const expected = new Map(prevItems.map((i) => [i.variantId, i.currentQuantity]));
  const initial = new Map(items.map((i) => [i.variantId, i.initialQuantity]));
  const diffs: SyncGap['diffs'] = [];
  for (const id of new Set([...expected.keys(), ...initial.keys()])) {
    const e = expected.get(id) ?? 0, i = initial.get(id) ?? 0;
    if (e !== i) diffs.push({ variantId: id, expected: e, initial: i });
  }
  if (!diffs.length) return null;
  return { prevDate: prev.date, diffs, units: diffs.reduce((s, d) => s + Math.abs(d.expected - d.initial), 0) };
}

// ---------------- comparação entre dias ----------------

export interface CompareRow {
  variant: Variant;
  group: Group;
  a: number;
  b: number;
  diff: number;
  byType: Partial<Record<MovementType, number>>;
  explained: number;
  unexplained: number;
}

/** Compara saldo final de A com o de B e explica a diferença pelas movimentações registradas entre as datas. */
export async function compareDays(dateA: string, dateB: string): Promise<CompareRow[]> {
  const [from, to] = dateA <= dateB ? [dateA, dateB] : [dateB, dateA];
  const days = await db.dailyRecords.where('date').between(from, to, true, true).toArray();
  const dayA = days.find((d) => d.date === from);
  const dayB = days.find((d) => d.date === to);
  if (!dayA || !dayB) return [];
  const between = new Set(days.filter((d) => d.date > from).map((d) => d.id));
  const [itemsA, itemsB, variants, groups, movements] = await Promise.all([
    db.dailyStockItems.where('dailyRecordId').equals(dayA.id).toArray(),
    db.dailyStockItems.where('dailyRecordId').equals(dayB.id).toArray(),
    db.variants.toArray(), db.groups.toArray(),
    db.stockMovements.where('dailyRecordId').anyOf([...between]).toArray(),
  ]);
  const gMap = new Map(groups.map((g) => [g.id, g]));
  const a = new Map(itemsA.map((i) => [i.variantId, i.currentQuantity]));
  const b = new Map(itemsB.map((i) => [i.variantId, i.currentQuantity]));
  const effective = effectiveMovements(movements);
  const rows: CompareRow[] = [];
  for (const v of variants) {
    if (!a.has(v.id) && !b.has(v.id)) continue;
    const g = gMap.get(v.groupId);
    if (!g) continue;
    const byType: Partial<Record<MovementType, number>> = {};
    let explained = 0;
    for (const m of effective) if (m.variantId === v.id && m.quantity) {
      byType[m.type] = (byType[m.type] ?? 0) + m.quantity;
      explained += m.quantity;
    }
    const qa = a.get(v.id) ?? 0, qb = b.get(v.id) ?? 0;
    rows.push({ variant: v, group: g, a: qa, b: qb, diff: qb - qa, byType, explained, unexplained: qb - qa - explained });
  }
  rows.sort((x, y) => x.group.displayOrder - y.group.displayOrder || x.variant.displayOrder - y.variant.displayOrder);
  return rows;
}

// ---------------- conta do caixa (mesmo padrão na tela e no WhatsApp) ----------------

export interface StatementLine { sign: '+' | '-'; icon: string; label: string; cents: number }

/**
 * A conta do dia, linha por linha, sempre na mesma ordem:
 * vendas por forma (Dinheiro, Pix, Crédito, Débito), entradas, dei, despesas, pagamento da diária, retiradas.
 * Somando tudo dá `dayResult`; ontem + dayResult = saldo.
 */
export function cashStatement(c: CashSummary): StatementLine[] {
  const L: StatementLine[] = [];
  const MAIN: PaymentMethod[] = ['dinheiro', 'pix', 'cartao', 'debito'];
  const LABEL: Record<PaymentMethod, string> = { dinheiro: 'Dinheiro', pix: 'Pix', cartao: 'Crédito', debito: 'Débito', outro: 'Outro' };
  const EMOJI: Record<PaymentMethod, string> = { dinheiro: '💵', pix: '⚡', cartao: '💳', debito: '🏧', outro: '🔹' };
  for (const m of [...MAIN, 'outro' as const]) {
    if (m === 'outro' && !c.salesByMethod.outro) continue;
    L.push({ sign: '+', icon: EMOJI[m], label: `Vendas no ${LABEL[m]}`, cents: c.salesByMethod[m] });
  }
  const of = (t: CashMovement['type']) => c.movements.filter((m) => m.type === t);
  const extra = (m: CashMovement) => (m.description && m.description !== 'caderno' ? ` (${m.description})` : '');
  for (const m of of('entrada')) L.push({ sign: '+', icon: '➕', label: `Entrada${extra(m)}`, cents: m.amountInCents });
  for (const m of of('dar')) L.push({ sign: '-', icon: '🤝', label: `Dei a ${m.person || m.description || 'alguém'}`, cents: m.amountInCents });
  for (const m of of('despesa')) L.push({ sign: '-', icon: '🧾', label: `Despesa${extra(m)}`, cents: m.amountInCents });
  for (const m of of('pagamento')) {
    // uma diária por lançamento, com o dia que ela paga ("Pagamento da diária de 30/10")
    if (m.description?.startsWith('diária de ')) { L.push({ sign: '-', icon: '💼', label: `Pagamento da ${m.description}`, cents: m.amountInCents }); continue; }
    const n = m.quantity ?? 0;
    const days = n > 1 && m.amountInCents % n === 0 ? ` (${n} dias × ${money(m.amountInCents / n)})` : n > 1 ? ` (${n} dias)` : '';
    L.push({ sign: '-', icon: '💼', label: `Pagamento da diária${days}${extra(m)}`, cents: m.amountInCents });
  }
  for (const m of of('retirada')) L.push({ sign: '-', icon: '🏦', label: `Retirada${extra(m)}`, cents: m.amountInCents });
  return L;
}
