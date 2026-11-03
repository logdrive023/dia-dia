/**
 * Botão “Atualizar” (bug no computador: às vezes não recarregava).
 * Toda situação termina em recarregar, e uma vez só.
 */
import { describe, expect, it, vi } from 'vitest';
import { applyUpdate } from '../lib/applyUpdate';
import { whatsappSize, WHATSAPP_TEXT_MAX } from '../services/report';

/** service worker de mentira: uma versão esperando, que dispara os eventos quando mandamos */
function fakeSW(opts: { waiting?: boolean } = {}) {
  const swL: Record<string, (() => void)[]> = {};
  const wL: Record<string, (() => void)[]> = {};
  const waiting = opts.waiting === false ? null : {
    state: 'installed',
    postMessage: vi.fn(),
    addEventListener: (t: string, f: () => void) => { (wL[t] ??= []).push(f); },
  };
  const sw = {
    getRegistration: vi.fn().mockResolvedValue({ waiting }),
    addEventListener: (t: string, f: () => void) => { (swL[t] ??= []).push(f); },
  } as unknown as ServiceWorkerContainer;
  return {
    sw, waiting,
    activate() { waiting!.state = 'activated'; wL.statechange?.forEach((f) => f()); },
    controllerChange() { swL.controllerchange?.forEach((f) => f()); },
  };
}

describe('Atualizar', () => {
  it('página sem controle (Ctrl+Shift+R): a nova ativa → recarrega (antes ficava parado)', async () => {
    const f = fakeSW(); const reload = vi.fn();
    expect(await applyUpdate({ sw: f.sw, reload, timeoutMs: 60_000 })).toBe('activating');
    expect(f.waiting!.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(reload).not.toHaveBeenCalled();
    f.activate(); // sem “controllerchange”: é o caso que travava
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it('troca de controle também recarrega; e só uma vez mesmo com os dois eventos', async () => {
    const f = fakeSW(); const reload = vi.fn();
    await applyUpdate({ sw: f.sw, reload, timeoutMs: 60_000 });
    f.controllerChange(); f.activate();
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it('nenhum evento chega: recarrega no tempo limite', async () => {
    const f = fakeSW(); const reload = vi.fn();
    await applyUpdate({ sw: f.sw, reload, timeoutMs: 30 });
    await new Promise((r) => setTimeout(r, 80));
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it('outra aba já ativou (nada esperando) ou sem service worker: recarrega na hora', async () => {
    const reload = vi.fn();
    expect(await applyUpdate({ sw: fakeSW({ waiting: false }).sw, reload })).toBe('reload');
    expect(await applyUpdate({ sw: undefined, reload })).toBe('reload');
    const broken = { getRegistration: vi.fn().mockRejectedValue(new Error('x')) } as unknown as ServiceWorkerContainer;
    expect(await applyUpdate({ sw: broken, reload })).toBe('reload');
    expect(reload).toHaveBeenCalledTimes(3);
  });
});

describe('tamanho da mensagem (atual / máximo)', () => {
  it('conta as letras da mensagem contra o máximo de uma mensagem do WhatsApp', () => {
    expect(whatsappSize('Oi')).toEqual({ letters: 2, max: WHATSAPP_TEXT_MAX, fits: true });
    expect(whatsappSize('a'.repeat(WHATSAPP_TEXT_MAX)).fits).toBe(true);
    expect(whatsappSize('a'.repeat(WHATSAPP_TEXT_MAX + 1)).fits).toBe(false);
  });
});
