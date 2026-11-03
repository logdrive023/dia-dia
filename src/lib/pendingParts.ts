import { useSyncExternalStore } from 'react';

/**
 * Mensagem do WhatsApp mandada em partes: guarda as que faltam até a pessoa voltar para o app
 * e tocar em “Mandar parte 2”. Fica guardado no aparelho (se o celular fechar o app enquanto está
 * no WhatsApp, o botão continua lá) por até 12 horas.
 */
export interface PendingParts {
  parts: string[];
  /** índice da próxima parte a mandar */
  next: number;
}

const KEY = 'pendingParts';
export const PENDING_PARTS_TTL_MS = 12 * 60 * 60 * 1000;

function load(): PendingParts | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as PendingParts & { savedAt: number };
    if (!Array.isArray(v.parts) || typeof v.next !== 'number' || v.next >= v.parts.length) return null;
    if (Date.now() - v.savedAt > PENDING_PARTS_TTL_MS) { localStorage.removeItem(KEY); return null; }
    return { parts: v.parts, next: v.next };
  } catch { return null; }
}

let state: PendingParts | null = load();
const listeners = new Set<() => void>();

export function setPendingParts(p: PendingParts | null) {
  state = p && p.next < p.parts.length ? p : null;
  try {
    if (state) localStorage.setItem(KEY, JSON.stringify({ ...state, savedAt: Date.now() }));
    else localStorage.removeItem(KEY);
  } catch { /* sem armazenamento: fica só na memória */ }
  listeners.forEach((l) => l());
}

export function getPendingParts() { return state; }

/** relê o que ficou guardado (ao abrir o app de novo) */
export function reloadPendingParts() { state = load(); listeners.forEach((l) => l()); }

export function usePendingParts() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state);
}
