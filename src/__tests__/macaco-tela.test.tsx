// @vitest-environment jsdom
/**
 * Macaco na tela: toca em botões aleatórios do app inteiro, digita lixo nos campos e aperta "voltar".
 * Não pode: cair na tela de erro, ter erro não tratado, nem deixar os dados inconsistentes.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import App from '../App';
import { AppDB, db, useDatabase } from '../db/db';
import { runDiagnostics } from '../services/diagnostics';

function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const errors: string[] = [];
beforeAll(() => {
  window.scrollTo = vi.fn() as never;
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} }) as never;
  window.open = vi.fn() as never;
  Element.prototype.scrollIntoView = vi.fn();
  window.addEventListener('error', (e) => errors.push(`error: ${e.message}`));
  window.addEventListener('unhandledrejection', (e) => errors.push(`promise: ${(e as PromiseRejectionEvent).reason}`));
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true });
});
// desmonta a tela e espera gravações que o último toque deixou em andamento antes do próximo teste trocar de banco
afterEach(async () => {
  cleanup();
  await new Promise((r) => setTimeout(r, 150));
  db.close();
});

const JUNK = ['', '0', '-1', '70', '1.230', '99999999999', 'abc', '😀', ' ', '70,5', 'x'.repeat(60), '<b>oi</b>', '1e5', 'Ana'];
const FLOW = /Iniciar o dia|^Vender |Fechar venda|Confirmar|Mais 1|Tirar 1|Reservar|Lançar|Dei dinheiro|Retirada|Despesa|Entrada|Corrigir|Cancelar venda|Salvar|Desfazer|Encerrar|Reabrir|Entrou 1|Saiu 1|Vender sem preço|Continuar mesmo assim|Dividir|Pix|Cartão|Dinheiro/;
const SKIP = /Atualizar o app|Tentar de novo|Enviar tudo|📁 Arquivo|Outros apps|Escolher arquivo|Receber \(escolher/;

async function monkey(seed: number, steps: number) {
  useDatabase(new AppDB(`macaco-tela-${seed}-${Math.random()}`));
  const R = rng(seed);
  render(<App />);
  await screen.findByRole('navigation', {}, { timeout: 5000 });
  const log: string[] = [];
  for (let i = 0; i < steps; i++) {
    const roll = R();
    await act(async () => {
      if (roll < 0.12) {
        const inputs = [...document.querySelectorAll('input:not([type=file]):not([type=date]), textarea')] as HTMLInputElement[];
        const el = inputs[Math.floor(R() * inputs.length)];
        if (el) { const v = R() < 0.4 ? String(1 + Math.floor(R() * 90)) : JUNK[Math.floor(R() * JUNK.length)]; fireEvent.change(el, { target: { value: v } }); log.push(`digitou "${v.slice(0, 10)}"`); }
      } else if (roll < 0.16) {
        history.back(); log.push('voltar');
      } else {
        const btns = [...document.querySelectorAll('button')].filter((b) => !(b as HTMLButtonElement).disabled && !SKIP.test(b.textContent ?? '')) as HTMLButtonElement[];
        // metade dos toques prefere o caminho principal (para chegar fundo: vender, confirmar, lançar, desfazer…)
        const main = btns.filter((x) => FLOW.test((x.getAttribute('aria-label') || '') + ' ' + (x.textContent || '')));
        const pool = main.length && R() < 0.5 ? main : btns;
        const b = pool[Math.floor(R() * pool.length)];
        if (b) { log.push(`tocou "${(b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 30)}"`); fireEvent.click(b); }
      }
      await new Promise((r) => setTimeout(r, 5));
    });
    if (i % 100 === 99) {
      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
      const where = `sorteio ${seed}, toque ${i + 1}\n${log.slice(-8).join('\n')}`;
      expect(screen.queryByText(/Não foi possível abrir os dados|O app está demorando/), `caiu na tela de erro (${where})`).toBeNull();
      expect(errors, `erro não tratado (${where})`).toEqual([]);
      const errs = (await runDiagnostics()).findings.filter((f) => f.level === 'erro');
      expect(errs, `dados inconsistentes (${where})`).toEqual([]);
      const items = await db.dailyStockItems.toArray();
      expect(items.every((x) => Number.isInteger(x.currentQuantity) && x.currentQuantity >= 0), where).toBe(true);
    }
  }
  return { days: await db.dailyRecords.count(), orders: await db.orders.count(), moves: await db.stockMovements.count(), cash: await db.cashMovements.count() };
}

// padrão 400 toques por sorteio; para rodar mais: MACACO_TELA=1000
const TAPS = Number((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.MACACO_TELA ?? 400);

describe('macaco na tela', () => {
  for (const seed of [1, 2, 3, 4])
    it(`sorteio ${seed}: ${TAPS} toques aleatórios sem quebrar`, async () => {
      const r = await monkey(seed, TAPS);
      console.log(`macaco-tela ${seed}:`, JSON.stringify(r));
    }, 300000);
});
