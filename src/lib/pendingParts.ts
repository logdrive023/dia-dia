import { useSyncExternalStore } from 'react';

/**
 * Mensagem do WhatsApp mandada em partes: guarda as que faltam até a pessoa voltar para o app
 * e tocar em “Mandar parte 2”. Fica só na memória (fechou o app, recomeça do “Enviar”).
 */
export interface PendingParts {
  parts: string[];
  /** índice da próxima parte a mandar */
  next: number;
}

let state: PendingParts | null = null;
const listeners = new Set<() => void>();

export function setPendingParts(p: PendingParts | null) {
  state = p && p.next < p.parts.length ? p : null;
  listeners.forEach((l) => l());
}

export function getPendingParts() { return state; }

export function usePendingParts() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state);
}
