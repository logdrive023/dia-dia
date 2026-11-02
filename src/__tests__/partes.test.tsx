// @vitest-environment jsdom
/**
 * Mensagem do WhatsApp em partes: cada parte cabe no link direto e, juntas, têm todas as linhas
 * (nada se perde). Parte 1 sai no “Enviar”; ao voltar, “Mandar parte 2”.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../App';
import { seedIfNeeded } from '../db/seed';
import { AppDB, db, useDatabase } from '../db/db';
import { getPendingParts, setPendingParts } from '../lib/pendingParts';
import { CONTINUES, partHeader, sendWhatsApp, splitForWhatsApp, whatsappSize, WHATSAPP_URL_MAX } from '../services/report';

beforeAll(() => {
  window.scrollTo = vi.fn() as never;
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} }) as never;
  Element.prototype.scrollIntoView = vi.fn();
});
beforeEach(async () => {
  window.open = vi.fn() as never;
  setPendingParts(null);
  useDatabase(new AppDB(`partes-${Math.random()}`));
  await seedIfNeeded();
  await db.settings.where('key').equals('initialOpening').delete();
  await db.settings.add({ id: `t-${Math.random()}`, key: 'autoDailyPay', value: false });
});
afterEach(async () => { cleanup(); setPendingParts(null); await new Promise((r) => setTimeout(r, 100)); db.close(); });

/** mensagem parecida com a de verdade: seções com título, grupos e cores com acento */
function bigReport(groups = 10, colors = 12) {
  const L = ['📒 *Fechamento — Segunda, 02/11*', '', '💰 *Vendas*', '• Vendeu: *2.820*'];
  for (const sec of ['🔁 *Precisa repor*', '📦 *Estoque agora (385 peças)*']) {
    L.push('', sec);
    for (let g = 0; g < groups; g++) {
      if (g) L.push('- - - - - - - -');
      L.push(`📦 *Grupo ${g}*`);
      for (let c = 0; c < colors; c++) L.push(`   • Cor Açaí ${g}.${c}: começou ${c + 3} → terminou ${c} ⚠️ repor 1`);
    }
  }
  L.push('', '🧾 *Totais*', '📦 Total no estoque: *385 peças*');
  return L.join('\n');
}
const body = (p: string, i: number, n: number) => { expect(p.startsWith(partHeader(i, n))).toBe(true); return p.slice(partHeader(i, n).length); };
const lines = (t: string) => t.split('\n').filter((l) => l.trim() && !l.startsWith(CONTINUES));

describe('dividir em partes', () => {
  it('cabe no link: uma parte só, sem cabeçalho', () => {
    expect(splitForWhatsApp('Oi\n\ntudo bem')).toEqual(['Oi\n\ntudo bem']);
  });
  it('grande: cada parte cabe; juntas têm todas as linhas, na ordem; cabeçalho “Parte i de n”', () => {
    const t = bigReport();
    expect(whatsappSize(t).fits).toBe(false);
    const parts = splitForWhatsApp(t);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(whatsappSize(p).link).toBeLessThanOrEqual(WHATSAPP_URL_MAX);
    const joined = parts.flatMap((p, i) => lines(body(p, i + 1, parts.length)));
    expect(joined).toEqual(lines(t)); // nenhuma linha perdida, nenhuma repetida, mesma ordem
    // o menor número de partes (sem parte quase vazia sobrando)
    const room = WHATSAPP_URL_MAX - whatsappSize(partHeader(99, 99)).link;
    expect(parts.length).toBeLessThanOrEqual(Math.ceil(whatsappSize(t).link / room) + 1);
    // parte que continua uma seção repete o título, marcado “(continua)”
    for (let i = 1; i < parts.length; i++) {
      const first = body(parts[i], i + 1, parts.length).split('\n')[0];
      if (first.startsWith(CONTINUES)) expect(first).toMatch(/\(continua\)$/);
    }
  });
  it('seção maior que uma parte inteira: corta entre linhas, nunca no meio de uma linha', () => {
    const t = bigReport(1, 400); // uma seção gigante
    const parts = splitForWhatsApp(t);
    for (const p of parts) expect(whatsappSize(p).link).toBeLessThanOrEqual(WHATSAPP_URL_MAX);
    expect(parts.flatMap((p, i) => lines(body(p, i + 1, parts.length)))).toEqual(lines(t));
    // toda parte depois da 1ª que começa no meio da seção repete o título
    for (let i = 1; i < parts.length; i++) {
      const first = body(parts[i], i + 1, parts.length).split('\n')[0];
      if (!first.startsWith('📦 *') && !first.startsWith('🔁 *') && !first.startsWith('🧾')) expect(first).toMatch(/^↪️ .+ \(continua\)$/);
    }
  });
});

describe('mandar em partes', () => {
  it('ligado: “Enviar” abre a parte 1 e guarda a 2; desligado: vai tudo de uma vez (compartilhar)', async () => {
    const t = bigReport();
    const parts = splitForWhatsApp(t);
    expect(await sendWhatsApp(t, true)).toBe('parts');
    expect(decodeURIComponent((window.open as ReturnType<typeof vi.fn>).mock.calls[0][0])).toBe(`https://wa.me/?text=${parts[0]}`);
    expect(getPendingParts()).toEqual({ parts, next: 1 });
    setPendingParts(null);
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    expect(await sendWhatsApp(t, false)).toBe('shared');
    expect(share.mock.calls[0][0].text).toBe(t);
    delete (navigator as { share?: unknown }).share;
  });
  it('pela tela: “Mandar parte 2” abre a parte 2 e some quando acabou', async () => {
    const parts = splitForWhatsApp(bigReport());
    render(<App />);
    await screen.findByRole('navigation', {}, { timeout: 5000 });
    act(() => setPendingParts({ parts, next: 1 }));
    expect((await screen.findByRole('dialog', { name: /Mandar a próxima parte/ })).textContent).toContain(`Parte 1 de ${parts.length} enviada`);
    for (let i = 1; i < parts.length; i++) {
      fireEvent.click(await screen.findByRole('button', { name: new RegExp(`Mandar parte ${i + 1}`) }));
      expect(decodeURIComponent((window.open as ReturnType<typeof vi.fn>).mock.calls.slice(-1)[0][0])).toBe(`https://wa.me/?text=${parts[i]}`);
    }
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Mandar a próxima parte/ })).toBeNull());
  });
});
