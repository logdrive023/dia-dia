import { useSyncExternalStore } from 'react';

/**
 * Situação da versão do app (compartilhada entre a faixa "Nova versão" e o selo do cabeçalho).
 * Só quem registra o service worker (UpdateBanner) escreve aqui.
 */
export interface UpdateState {
  /** o service worker está ativo (sem ele, ex.: nos testes, não dá para saber) */
  ready: boolean;
  /** tem versão nova esperando */
  needRefresh: boolean;
  apply: () => void;
}

let state: UpdateState = { ready: false, needRefresh: false, apply: () => undefined };
const listeners = new Set<() => void>();

export function setUpdateState(patch: Partial<UpdateState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useUpdateState() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state);
}
