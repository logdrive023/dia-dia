import type { PaymentMethod } from '../db/types';

export const uid = () =>
  (globalThis.crypto && 'randomUUID' in globalThis.crypto)
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const nowIso = () => new Date().toISOString();

// ---------- datas (sempre data local, YYYY-MM-DD) ----------
export function todayStr(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(s: string, n: number): string {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return todayStr(d);
}
const WEEK = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
export function fmtDate(s: string, withWeekday = true): string {
  const d = parseDate(s);
  const base = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(2)}`;
  return withWeekday ? `${base} ${WEEK[d.getDay()]}` : base;
}
export const weekday = (s: string) => WEEK[parseDate(s).getDay()];

// ---------- limites (protegem contra digitação absurda e perda de precisão) ----------
/** 1 bilhão em centavos */
export const MAX_CENTS = 100_000_000_000;
export const MAX_QTY = 100_000;
export const isCents = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= MAX_CENTS;
export const isQty = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0 && (v as number) <= MAX_QTY;

// ---------- dinheiro (centavos inteiros) ----------
export function toCents(input: string | number): number | null {
  if (typeof input === 'number') return Number.isFinite(input) && input >= 0 && input * 100 <= MAX_CENTS ? Math.round(input * 100) : null;
  const t = input.trim().replace(/\s/g, '');
  if (!t) return null;
  // aceita 1.230,50 | 1230,5 | 1230.50 | 70 | 1.230 (ponto com 3 dígitos = milhar)
  let norm = t;
  if (t.includes(',')) norm = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) norm = t.replace(/\./g, '');
  if (!/^\d*\.?\d*$/.test(norm)) return null; // nada de "1e5", "+70", "0x10"
  const n = Number(norm);
  if (!Number.isFinite(n) || n < 0 || n * 100 > MAX_CENTS) return null;
  return Math.round(n * 100);
}

/** 7000 -> "70", 7050 -> "70,50", 123000 -> "1.230" */
export function money(cents: number | null | undefined, symbol = ''): string {
  const c = cents ?? 0;
  const neg = c < 0;
  const abs = Math.abs(c);
  const int = Math.floor(abs / 100);
  const dec = abs % 100;
  const intStr = int.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const s = dec ? `${intStr},${String(dec).padStart(2, '0')}` : intStr;
  return `${neg ? '-' : ''}${symbol ? symbol + ' ' : ''}${s}`;
}

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  dinheiro: 'Dinheiro',
  pix: 'Pix',
  cartao: 'Crédito',
  debito: 'Débito',
  outro: 'Outro',
};
export const PAYMENT_EMOJI: Record<PaymentMethod, string> = {
  dinheiro: '💵',
  pix: '⚡',
  cartao: '💳',
  debito: '🏧',
  outro: '🔹',
};
export const PAYMENTS: PaymentMethod[] = ['dinheiro', 'pix', 'cartao', 'debito', 'outro'];

export const COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#22c55e', '#14b8a6', '#06b6d4',
  '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#78716c', '#64748b', '#111827',
];

/** Cores com nome (para peças e grupos). Inclui as da lista oficial, para o nome bater. */
export const NAMED_COLORS: [string, string][] = [
  ['poa', 'Poá'], ['#f8fafc', 'Branco'], ['#fef3c7', 'Creme'], ['#e7d3b0', 'Bege'], ['#cbd5e1', 'Prata'],
  ['#94a3b8', 'Cinza'], ['#64748b', 'Chumbo'], ['#374151', 'Grafite'], ['#111827', 'Preto'],
  ['#7f1d1d', 'Vinho'], ['#b91c1c', 'Vermelho escuro'], ['#ef4444', 'Vermelho'], ['#fb7185', 'Coral'],
  ['#f97316', 'Laranja'], ['#fdba74', 'Pêssego'], ['#f59e0b', 'Âmbar'], ['#ca8a04', 'Dourado'], ['#d4a017', 'Mostarda'],
  ['#facc15', 'Amarelo'], ['#fde68a', 'Amarelo claro'], ['#a3e635', 'Verde limão'], ['#22c55e', 'Verde'],
  ['#15803d', 'Verde escuro'], ['#65a30d', 'Verde oliva'], ['#86efac', 'Verde menta'], ['#2dd4bf', 'Verde Piscina'],
  ['#14b8a6', 'Turquesa'], ['#06b6d4', 'Ciano'], ['#7dd3fc', 'Celeste'], ['#3b82f6', 'Azul'], ['#1d4ed8', 'Azul royal'],
  ['#1e3a8a', 'Azul marinho'], ['#6366f1', 'Índigo'], ['#c4b5fd', 'Lilás'], ['#a855f7', 'Roxo'], ['#6b21a8', 'Roxo escuro'],
  ['#f9a8d4', 'Rosa claro'], ['#f472b6', 'Rosa'], ['#ec4899', 'Pink'], ['#be185d', 'Magenta'],
  ['#92400e', 'Café'], ['#78350f', 'Marrom'], ['#78716c', 'Taupe'], ['#a16207', 'Caramelo'],
];

/** Nome da cor ("Azul"); cor fora da paleta → "Personalizada". */
export function colorName(c?: string | null) {
  if (!c) return '';
  return NAMED_COLORS.find(([hex]) => hex.toLowerCase() === c.toLowerCase())?.[1] ?? 'Personalizada';
}

export function normalize(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
