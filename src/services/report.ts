import type { PaymentMethod } from '../db/types';
import { fmtDate, money, PAYMENT_LABEL } from '../lib/util';
import { cashStatement, type DaySummary } from './summary';
import { setPendingParts } from '../lib/pendingParts';

type Opts = { symbol?: string; title?: string; /** mostrar o estoque de agora (cor por cor) na mensagem do WhatsApp */ showStock?: boolean;
  /** em “Precisa repor”, mostrar “(tem 14 de 15)” ao lado do número */ restockDetail?: boolean;
  /** no “Estoque agora”, cada cor com “começou 3 → terminou 2” */ stockStartEnd?: boolean;
  /** no fim: total no estoque, total para repor e começo → final do dia */ totals?: boolean;
  /** linha de divisão entre os grupos (Plomo ┈┈┈ Lila) */ dividers?: boolean };

/** divisão entre os grupos na mensagem do WhatsApp */
export const DIVIDER = '- - - - - - - -'; // só traço e espaço: ocupa pouco no link do WhatsApp

/** Linha do caderno para uma venda: "2x70 = 140 Dinheiro" ou "1x70 + 1x85 = 155 Pix". */
export function orderLine(lines: { quantity: number; unitPriceInCents: number | null; paymentMethod?: PaymentMethod }[], total: number, method: PaymentMethod,
  payments?: { method: PaymentMethod; amountInCents: number }[]) {
  // cada peça com a sua forma: "1x70 Dinheiro + 1x70 Pix = 140"
  if (new Set(lines.map((l) => l.paymentMethod ?? method)).size > 1) {
    const by = new Map<string, number>();
    for (const l of lines) {
      const k = `${l.unitPriceInCents ?? -1}|${l.paymentMethod ?? method}`;
      by.set(k, (by.get(k) ?? 0) + l.quantity);
    }
    const parts = [...by.entries()].map(([k, q]) => {
      const [p, m] = k.split('|');
      return `${q}x${Number(p) < 0 ? '?' : money(Number(p))} ${PAYMENT_LABEL[m as PaymentMethod]}`;
    });
    return `${parts.join(' + ')} = ${money(total)}`;
  }
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

/** "bateu ✅" · "faltam 50" · "sobram 20" (contado − o que deveria ter em dinheiro vivo). */
function countedText(c: DaySummary['cash']) {
  const d = c.difference ?? 0;
  return d === 0 ? 'bateu ✅' : d < 0 ? `faltam ${money(-d)} ⚠️` : `sobram ${money(d)}`;
}

/** " (2 diárias de 150)" quando der para dividir certinho. */
function payDays(c: DaySummary['cash']) {
  const n = c.pagamentoDias;
  if (!n) return '';
  return n === 1 ? ' (1 diária)' : c.pagamentos % n === 0 ? ` (${n} diárias de ${money(c.pagamentos / n)})` : ` (${n} diárias)`;
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
  if (c.retiradas || c.pagamentos) ontem += ` - ${money(c.retiradas + c.pagamentos)} = ${money(c.accumulated)}`;
  out.push(ontem);
  if (c.pagamentos) out.push(`Pagamento: ${money(c.pagamentos)}${payDays(c)}`);
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
  if (s.cash.counted !== null) L.push(`Contado na mão: ${money(s.cash.counted)} — ${countedText(s.cash)}`);
  return L.join('\n');
}

/** Agrupa por grupo: título do grupo (com ícone) e as cores embaixo, uma por linha. */
function byGroup<T extends { group: { name: string; icon?: string }; variant: { name: string } }>(list: T[], line: (x: T) => string, divider = false) {
  const map = new Map<string, { icon?: string; items: string[] }>();
  for (const x of list) {
    const g = map.get(x.group.name) ?? { icon: x.group.icon, items: [] };
    g.items.push(line(x));
    map.set(x.group.name, g);
  }
  const out: string[] = [];
  for (const [name, g] of map) {
    if (divider && out.length) out.push(DIVIDER);
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
  const div = !!opts.dividers;

  L.push(`📒 *Fechamento — ${WEEK_LONG[new Date(y, m - 1, d).getDay()]}, ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}*`);

  // vendas (o valor por forma está na conta do caixa)
  section('💰 *Vendas*');
  L.push(`• Vendeu: *${$(c.salesTotal)}* · ${plural(s.salesCount, 'venda', 'vendas')} · ${plural(s.soldUnits, 'peça', 'peças')}`);

  // caixa: ontem separado, a conta de hoje linha por linha, e o total no fim
  section('🧮 *Caixa*');
  L.push(`📅 Ontem: ${$(c.opening)} (💵 ${money(c.openingCash)} · 🏦 ${money(c.opening - c.openingCash)})`);
  // uma linha por forma de venda e por saída: dá para ver de onde veio cada valor
  for (const x of cashStatement(c)) L.push(`${x.sign === '+' ? '➕' : '➖'} ${x.icon} ${x.label}: ${$(x.cents)}`);
  L.push(`*= Hoje: ${c.dayResult >= 0 ? '+' : '−'}${$(Math.abs(c.dayResult))}*`);
  L.push(`✅ *Total: ${$(c.accumulated)}* (ontem ${money(c.opening)} ${c.dayResult >= 0 ? '+' : '−'} hoje ${money(Math.abs(c.dayResult))})`);
  L.push(`💵 Na mão: ${$(c.cashOnHand)}`);
  L.push(`🏦 No banco: ${$(c.otherBalance)}`);
  if (c.counted !== null)
    L.push(`🔎 Contado na mão: ${$(c.counted)} — ${countedText(c)}`);

  // peças que saíram (vendidas)
  section(`🛍️ *O que saiu (${plural(s.soldUnits, 'peça', 'peças')})*`);
  if (s.soldByVariant.length) L.push(...byGroup(s.soldByVariant, (x) => `Cor ${x.variant.name}: ${x.qty}`, div));
  // vendas copiadas do caderno não dizem a cor
  if (c.notebookUnits) L.push(`• 📒 ${plural(c.notebookUnits, 'peça', 'peças')} do caderno (sem cor anotada)`);
  if (!s.soldByVariant.length && !c.notebookUnits) L.push('• Nenhuma peça vendida');

  // entrou
  section(`📦 *Entrou no estoque${s.enteredUnits ? ` (${plural(s.enteredUnits, 'peça', 'peças')})` : ''}*`);
  if (s.enteredByVariant.length) L.push(...byGroup(s.enteredByVariant, (x) => `Cor ${x.variant.name}: +${x.qty}`, div));
  else L.push('• Nenhuma peça');

  // repor
  const toRestock = s.restock.filter((r) => r.restock > 0);
  // esgotados: todos com 0 peças (o mesmo número do Início), mesmo os que também estão em “repor”
  const soldOut = s.restock.filter((r) => r.out);
  if (toRestock.length) {
    section(`🔁 *Precisa repor (${plural(s.restockUnits, 'peça', 'peças')})*`);
    L.push(...byGroup(toRestock, (r) => `Cor ${r.variant.name}: ${r.restock}${opts.restockDetail ? ` (tem ${r.item.currentQuantity} de ${r.ideal})` : ''}`, div));
  }
  if (soldOut.length) {
    section(`🚫 *Esgotados (${soldOut.length})*`);
    L.push(...byGroup(soldOut, (r) => `Cor ${r.variant.name}`, div));
  }

  if (opts.showStock && s.stockNow.length) {
    // o que tem agora, cor por cor; ao lado, o aviso de repor/esgotado (a seção "Precisa repor" continua acima)
    section(`📦 *Estoque agora (${plural(s.totalUnits, 'peça', 'peças')})*`);
    L.push(...byGroup(s.stockNow, (r) => `Cor ${r.variant.name}: ${opts.stockStartEnd ? `começou ${r.item.initialQuantity} → terminou ${r.item.currentQuantity}` : r.item.currentQuantity}${stockNote(r)}`, div));
  } else {
    section(`📊 Estoque no fim do dia: *${plural(s.totalUnits, 'peça', 'peças')}*`);
  }

  if (opts.totals) {
    // os números do Início: estoque, repor e quanto mudou do começo ao fim do dia
    const diff = s.totalUnits - s.initialUnits;
    section('🧾 *Totais*');
    L.push(`📦 Total no estoque: *${plural(s.totalUnits, 'peça', 'peças')}*`);
    L.push(`🔁 Total para repor: *${plural(s.restockUnits, 'peça', 'peças')}*`);
    L.push(`🌅 Começo do dia ${s.initialUnits} → 🌙 final ${s.totalUnits} = *${diff > 0 ? '+' : diff < 0 ? '−' : ''}${Math.abs(diff)}*`);
  }
  return L.join('\n');
}

/** Aviso ao lado da cor no “Estoque agora”: esgotado só com 0 peças; peça reservada aparece como reservada. */
function stockNote(r: DaySummary['stockNow'][number]) {
  if (r.item.currentQuantity <= 0) return ' 🚫 esgotado';
  const notes: string[] = [];
  const res = Math.min(r.reserved, r.item.currentQuantity);
  if (res > 0) notes.push(`🔒 ${res} ${res === 1 ? 'reservada' : 'reservadas'}`);
  if (r.restock > 0) notes.push(`⚠️ repor ${r.restock}`);
  return notes.length ? ' ' + notes.join(' ') : '';
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

/** Cabeçalho de cada parte (conta no tamanho de cada uma). */
export const partHeader = (i: number, n: number) => `📨 *Parte ${i} de ${n}*\n\n`;
/** marca da linha repetida no começo da parte que continua uma seção (não é informação nova) */
export const CONTINUES = '↪️ ';

/**
 * Divide a mensagem em partes que cabem no link direto do WhatsApp. Nunca corta uma linha:
 * juntando as partes (sem o cabeçalho e sem as linhas “↪️ … (continua)”) tem todas as linhas, na ordem.
 * Prefere cortar entre as seções; se cortar entre linhas der menos partes, corta entre linhas
 * e repete o título da seção no começo da parte seguinte.
 */
export function splitForWhatsApp(text: string, max = WHATSAPP_URL_MAX): string[] {
  if (whatsappSize(text).link <= max) return [text];
  const fits = (t: string) => whatsappSize(partHeader(99, 99) + t).link <= max;
  const bySections = splitBySections(text, fits);
  const byLines = splitByLines(text, fits);
  const parts = byLines.length < bySections.length ? byLines : bySections;
  return parts.map((p, i) => partHeader(i + 1, parts.length) + p);
}

function splitBySections(text: string, fits: (t: string) => boolean) {
  const pieces: string[] = [];
  for (const block of text.split('\n\n')) {
    if (fits(block)) { pieces.push(block); continue; }
    let cur = '';
    const title = block.split('\n')[0];
    for (const line of block.split('\n')) {
      const nxt = cur ? `${cur}\n${line}` : line;
      // seção grande demais: continua na próxima parte, repetindo o título
      if (!cur || fits(nxt)) cur = nxt; else { pieces.push(cur); cur = `${CONTINUES}${title} (continua)\n${line}`; }
    }
    if (cur) pieces.push(cur);
  }
  const parts: string[] = [];
  let cur = '';
  for (const p of pieces) {
    const nxt = cur ? `${cur}\n\n${p}` : p;
    if (cur && !fits(nxt)) { parts.push(cur); cur = p; } else cur = nxt;
  }
  if (cur) parts.push(cur);
  return parts;
}

/** enche cada parte até o máximo, linha por linha (o menor número de partes) */
function splitByLines(text: string, fits: (t: string) => boolean) {
  const parts: string[] = [];
  let cur = '';
  let title = ''; // título da seção atual (linha depois de uma linha em branco)
  let prevBlank = true;
  for (const line of text.split('\n')) {
    const nxt = cur ? `${cur}\n${line}` : line;
    if (cur && !fits(nxt)) {
      parts.push(cur.replace(/\n+$/, ''));
      // começou no meio de uma seção: repete o título para quem lê
      cur = line.trim() && !prevBlank && title && line !== title ? `${CONTINUES}${title} (continua)\n${line}` : line;
    } else cur = nxt;
    if (prevBlank && line.trim()) title = line;
    prevBlank = !line.trim();
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => p.replace(/^\n+/, ''));
}

const waLink = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;

/** Abre o WhatsApp com uma parte (link direto). Usado também pelo “Mandar parte 2”. */
export function openWhatsAppLink(text: string) { window.open(waLink(text), '_blank'); }

/**
 * Enviar no WhatsApp. Com “mandar em partes” ligado e mensagem maior que o link: manda a parte 1 e
 * guarda as outras; ao voltar para o app aparece “Mandar parte 2”. Desligado: tudo de uma vez.
 */
export async function sendWhatsApp(text: string, split: boolean): Promise<'whatsapp' | 'shared' | 'copied' | 'aborted' | 'parts'> {
  if (split) {
    const parts = splitForWhatsApp(text);
    if (parts.length > 1) {
      openWhatsAppLink(parts[0]);
      setPendingParts({ parts, next: 1 });
      return 'parts';
    }
  }
  return openWhatsApp(text);
}

/**
 * Abre o WhatsApp com o texto. Link muito comprido trava/corta no celular: aí usa o compartilhar
 * do celular (aceita texto grande); sem ele, copia para colar. Devolve o que fez.
 */
export async function openWhatsApp(text: string): Promise<'whatsapp' | 'shared' | 'copied' | 'aborted'> {
  const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
  if (url.length > WHATSAPP_URL_MAX) {
    if (navigator.share) {
      try { await navigator.share({ text }); return 'shared'; } catch (e) { if ((e as Error).name === 'AbortError') return 'aborted'; }
    }
    await copyText(text);
    return 'copied';
  }
  window.open(url, '_blank');
  return 'whatsapp';
}
export const WHATSAPP_URL_MAX = 7000;
/** limite de uma mensagem do próprio WhatsApp (letras) */
export const WHATSAPP_TEXT_MAX = 65536;

/**
 * Tamanho da mensagem para mostrar na tela: “atual / máximo” do link direto do WhatsApp.
 * Passou do link: vai inteira pelo compartilhar do celular (ou copiada) — nada é cortado.
 */
export function whatsappSize(text: string) {
  const link = `https://wa.me/?text=${encodeURIComponent(text)}`.length;
  return { link, max: WHATSAPP_URL_MAX, fits: link <= WHATSAPP_URL_MAX, letters: text.length, tooBig: text.length > WHATSAPP_TEXT_MAX };
}

export async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove(); return ok;
  }
}
