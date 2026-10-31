import type { PaymentMethod } from '../db/types';
import { fmtDate, money, PAYMENT_EMOJI, PAYMENT_LABEL, PAYMENTS } from '../lib/util';
import type { DaySummary } from './summary';

type Opts = { symbol?: string; title?: string };

/** Linha do caderno para uma venda: "2x70 = 140 Dinheiro" ou "1x70 + 1x85 = 155 Pix". */
export function orderLine(lines: { quantity: number; unitPriceInCents: number | null }[], total: number, method: PaymentMethod) {
  const byPrice = new Map<number, number>();
  for (const l of lines) {
    const k = l.unitPriceInCents ?? -1;
    byPrice.set(k, (byPrice.get(k) ?? 0) + l.quantity);
  }
  const parts = [...byPrice.entries()].sort((a, b) => (a[0] < 0 ? 1 : b[0] < 0 ? -1 : a[0] - b[0]))
    .map(([p, q]) => `${q}x${p < 0 ? '?' : money(p)}`);
  return `${parts.join(' + ')} = ${money(total)} ${PAYMENT_LABEL[method]}`;
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
  for (const o of s.orders) L.push(`☐ ${orderLine(salesByOrder.get(o.id) ?? [], o.totalInCents, o.paymentMethod)}`);
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

/** Relatório curto e bonito para WhatsApp: entrou, vendeu, precisa repor. */
export function whatsappReport(date: string, s: DaySummary, opts: Opts = {}) {
  const sym = opts.symbol ? `${opts.symbol} ` : '';
  const c = s.cash;
  const L: string[] = [];
  L.push(`📒 *Fechamento — ${fmtDate(date)}*`);
  L.push('');
  L.push(`💰 *Vendeu: ${sym}${money(c.salesTotal)}*  (${s.orders.length} ${s.orders.length === 1 ? 'venda' : 'vendas'} · ${s.soldUnits} ${s.soldUnits === 1 ? 'peça' : 'peças'})`);
  for (const p of PAYMENTS) if (c.salesByMethod[p]) L.push(`${PAYMENT_EMOJI[p]} ${PAYMENT_LABEL[p]}: ${sym}${money(c.salesByMethod[p])}`);
  if (c.entradas) L.push(`➕ Outras entradas: ${sym}${money(c.entradas)}`);
  for (const d of c.dar) L.push(`🤝 Dei a ${d.person || d.description || 'alguém'}: ${sym}${money(d.amountInCents)}`);
  if (c.despesas) L.push(`🧾 Despesas: ${sym}${money(c.despesas)}`);
  L.push('');
  L.push('🧮 *Caixa*');
  L.push(...cashLines(s).map((x) => '  ' + x));
  L.push(`  ✅ *Saldo: ${sym}${money(c.accumulated)}*`);
  if (c.counted !== null) L.push(`  Contado: ${sym}${money(c.counted)} (dif. ${money(c.difference)})`);

  if (s.soldByVariant.length) {
    L.push('');
    L.push(`🛍️ *Vendido (${s.soldUnits})*`);
    for (const x of s.soldByVariant) L.push(`• ${x.group.name} ${x.variant.name} ×${x.qty}`);
  }
  L.push('');
  L.push(`📦 *Entrou no estoque: ${s.enteredUnits} ${s.enteredUnits === 1 ? 'peça' : 'peças'}*`);
  for (const x of s.enteredByVariant) L.push(`• ${x.group.name} ${x.variant.name} +${x.qty}`);
  if (s.restock.length) {
    L.push('');
    L.push(`🔁 *Precisa repor (${s.restock.length})*`);
    for (const r of s.restock) L.push(`• ${r.group.name} ${r.variant.name} — ${r.out ? 'esgotado' : `restam ${r.available}`}`);
  }
  L.push('');
  L.push(`📊 Estoque no fim do dia: ${s.totalUnits} peças`);
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
