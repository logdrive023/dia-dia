import type { PaymentMethod } from '../db/types';
import { fmtDate, money, PAYMENT_EMOJI, PAYMENT_LABEL, PAYMENTS } from '../lib/util';
import type { DaySummary } from './summary';

type Opts = { symbol?: string; title?: string };

/** Linha do caderno para uma venda: "2x70 = 140 Dinheiro" ou "1x70 + 1x85 = 155 Pix". */
export function orderLine(lines: { quantity: number; unitPriceInCents: number | null }[], total: number, method: PaymentMethod,
  payments?: { method: PaymentMethod; amountInCents: number }[]) {
  const byPrice = new Map<number, number>();
  for (const l of lines) {
    const k = l.unitPriceInCents ?? -1;
    byPrice.set(k, (byPrice.get(k) ?? 0) + l.quantity);
  }
  const parts = [...byPrice.entries()].sort((a, b) => (a[0] < 0 ? 1 : b[0] < 0 ? -1 : a[0] - b[0]))
    .map(([p, q]) => `${q}x${p < 0 ? '?' : money(p)}`);
  const how = payments && payments.length > 1
    ? `(${payments.map((p) => `${PAYMENT_LABEL[p.method]} ${money(p.amountInCents)}`).join(' + ')})`
    : PAYMENT_LABEL[method];
  return `${parts.join(' + ')} = ${money(total)} ${how}`;
}

function cashLines(s: DaySummary, extraSymbol = '') {
  const c = s.cash;
  const out: string[] = [];
  const parts = [money(c.salesTotal)];
  if (c.entradas) parts.push(`+ ${money(c.entradas)}`);
  const minus = c.darTotal + c.despesas;
  if (minus) parts.push(`- ${money(minus)}`);
  out.push(parts.length > 1 ? `${parts.join(' ')} = ${money(c.todayNet)}${extraSymbol}` : `Hoje = ${money(c.todayNet)}${extraSymbol}`);
  let ontem = `Ontem ${money(c.opening)} + ${money(c.todayNet)} = ${money(c.subtotal)}`;
  if (c.retiradas) ontem += ` - ${money(c.retiradas)} = ${money(c.accumulated)}`;
  out.push(ontem);
  return out;
}

/** Relatório no mesmo formato do caderno (Check List). */
export function notebookReport(date: string, s: DaySummary, opts: Opts = {}) {
  const L: string[] = [];
  L.push(`${opts.title || 'Check List'}`);
  L.push(`date: ${fmtDate(date)}`);
  L.push('');
  const salesByOrder = new Map<string, typeof s.sales>();
  for (const x of s.sales) salesByOrder.set(x.orderId, [...(salesByOrder.get(x.orderId) ?? []), x]);
  for (const o of s.orders) L.push(`☐ ${orderLine(salesByOrder.get(o.id) ?? [], o.totalInCents, o.paymentMethod, o.payments)}`);
  if (!s.orders.length) L.push('(sem vendas)');
  if (s.cash.dar.length) {
    L.push('');
    for (const d of s.cash.dar) L.push(`${d.person || d.description || 'Dei'}: ${money(d.amountInCents)} — eu dei`);
  }
  if (s.cash.despesas) L.push(`Despesas: ${money(s.cash.despesas)}`);
  if (s.cash.entradas) L.push(`Entradas: ${money(s.cash.entradas)}`);
  L.push('──────────');
  L.push(...cashLines(s));
  return L.join('\n');
}

/** Agrupa por grupo: título do grupo (com ícone) e as cores embaixo, uma por linha. */
function byGroup<T extends { group: { name: string; icon?: string }; variant: { name: string } }>(list: T[], line: (x: T) => string) {
  const map = new Map<string, { icon?: string; items: string[] }>();
  for (const x of list) {
    const g = map.get(x.group.name) ?? { icon: x.group.icon, items: [] };
    g.items.push(line(x));
    map.set(x.group.name, g);
  }
  const out: string[] = [];
  for (const [name, g] of map) {
    out.push(`${g.icon ?? '📦'} *${name}*`);
    for (const it of g.items) out.push(`   • ${it}`);
  }
  return out;
}

const WEEK_LONG = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

/** Relatório para WhatsApp: seções em lista, uma informação por linha. */
export function whatsappReport(date: string, s: DaySummary, opts: Opts = {}) {
  const $ = (v: number) => `${opts.symbol ? opts.symbol + ' ' : ''}${money(v)}`;
  const c = s.cash;
  const [y, m, d] = date.split('-').map(Number);
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const L: string[] = [];
  const section = (title: string) => { L.push(''); L.push(title); };

  L.push(`📒 *Fechamento — ${WEEK_LONG[new Date(y, m - 1, d).getDay()]}, ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}*`);

  // vendas
  section('💰 *Vendas*');
  L.push(`• Vendeu: *${$(c.salesTotal)}*`);
  L.push(`• ${plural(s.salesCount, 'venda', 'vendas')} · ${plural(s.soldUnits, 'peça', 'peças')}`);
  for (const p of PAYMENTS) if (p !== 'outro' || c.salesByMethod[p]) L.push(`• ${PAYMENT_EMOJI[p]} ${PAYMENT_LABEL[p]}: ${$(c.salesByMethod[p])}`);

  // dinheiro que saiu/entrou fora das vendas
  if (c.dar.length || c.despesas || c.entradas) {
    section('🤝 *Outros lançamentos*');
    for (const x of c.dar) L.push(`• Dei a ${x.person || x.description || 'alguém'}: ${$(x.amountInCents)}`);
    if (c.despesas) L.push(`• Despesas: ${$(c.despesas)}`);
    if (c.entradas) L.push(`• Outras entradas: +${$(c.entradas)}`);
  }

  // caixa
  section('🧮 *Caixa*');
  L.push(`• Ontem: ${$(c.opening)}`);
  const minus = c.darTotal + c.despesas;
  const how = minus || c.entradas
    ? ` (vendas ${money(c.salesTotal)}${c.entradas ? ` + ${money(c.entradas)}` : ''}${minus ? ` - ${money(minus)}` : ''})` : '';
  L.push(`• Hoje: ${c.todayNet >= 0 ? '+' : ''}${$(c.todayNet)}${how}`);
  if (c.retiradas) L.push(`• Retirada: -${$(c.retiradas)}`);
  L.push(`• ✅ *Saldo: ${$(c.accumulated)}*`);
  L.push(`• 💵 Na mão: ${$(c.cashOnHand)}`);
  L.push(`• 🏦 No banco (Pix/cartão): ${$(c.otherBalance)}`);
  if (c.counted !== null)
    L.push(c.difference === 0 ? `• 🔎 Contado: ${$(c.counted)} — bateu ✅` : `• 🔎 Contado: ${$(c.counted)} — diferença ${c.difference! > 0 ? '+' : ''}${$(c.difference!)}`);

  // peças que saíram (vendidas)
  section(`🛍️ *O que saiu (${plural(s.soldUnits, 'peça', 'peças')})*`);
  if (s.soldByVariant.length) L.push(...byGroup(s.soldByVariant, (x) => `Cor ${x.variant.name}: ${x.qty}`));
  else L.push('• Nenhuma peça vendida');

  // entrou
  section(`📦 *Entrou no estoque${s.enteredUnits ? ` (${plural(s.enteredUnits, 'peça', 'peças')})` : ''}*`);
  if (s.enteredByVariant.length) L.push(...byGroup(s.enteredByVariant, (x) => `Cor ${x.variant.name}: +${x.qty}`));
  else L.push('• Nenhuma peça');

  // repor
  const toRestock = s.restock.filter((r) => r.restock > 0);
  const soldOut = s.restock.filter((r) => r.out && r.restock === 0);
  if (toRestock.length) {
    section(`🔁 *Precisa repor (${plural(s.restockUnits, 'peça', 'peças')})*`);
    L.push(...byGroup(toRestock, (r) => `Cor ${r.variant.name}: repor ${r.restock} (tem ${r.item.currentQuantity} de ${r.ideal})`));
  }
  if (soldOut.length) {
    section(`🚫 *Esgotados (${soldOut.length})*`);
    L.push(...byGroup(soldOut, (r) => `Cor ${r.variant.name}`));
  }

  section(`📊 Estoque no fim do dia: *${plural(s.totalUnits, 'peça', 'peças')}*`);
  return L.join('\n');
}

export async function shareText(text: string, title = 'Relatório') {
  if (navigator.share) {
    try { await navigator.share({ title, text }); return 'shared'; } catch (e) {
      if ((e as Error).name === 'AbortError') return 'aborted';
    }
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  return 'whatsapp';
}

export function openWhatsApp(text: string) {
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
}

export async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove(); return ok;
  }
}
