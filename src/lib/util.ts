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

// ---------- dinheiro (centavos inteiros) ----------
export function toCents(input: string | number): number | null {
  if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input * 100) : null;
  const t = input.trim().replace(/\s/g, '');
  if (!t) return null;
  // aceita 1.230,50 | 1230,5 | 1230.50 | 70 | 1.230 (ponto com 3 dígitos = milhar)
  let norm = t;
  if (t.includes(',')) norm = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) norm = t.replace(/\./g, '');
  const n = Number(norm);
  if (!Number.isFinite(n) || n < 0) return null;
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
  cartao: 'Cartão',
  outro: 'Outro',
};
export const PAYMENT_EMOJI: Record<PaymentMethod, string> = {
  dinheiro: '💵',
  pix: '⚡',
  cartao: '💳',
  outro: '🔹',
};
export const PAYMENTS: PaymentMethod[] = ['dinheiro', 'pix', 'cartao', 'outro'];

export const COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#22c55e', '#14b8a6', '#06b6d4',
  '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#78716c', '#64748b', '#111827',
];

export function normalize(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
