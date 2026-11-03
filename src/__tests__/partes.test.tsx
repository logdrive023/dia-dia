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
import { CONTINUES, partHeader, sendWhatsApp, splitForWhatsApp, whatsappNav, WHATSAPP_TEXT_MAX } from '../services/report';

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

/** limite pequeno só para testar o corte (a regra é a mesma do limite de verdade, 65.536 letras) */
const MAX = 3000;
const spies: { mockRestore: () => void }[] = [];
/** área de transferência e abrir o WhatsApp de mentira */
function fakePhone() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  const go = vi.spyOn(whatsappNav, 'go').mockImplementation(() => undefined);
  const open = vi.spyOn(whatsappNav, 'open').mockImplementation(() => undefined);
  const phone = vi.spyOn(whatsappNav, 'isPhone').mockReturnValue(true);
  spies.push(go, open, phone);
  return { writeText, go, open, phone };
}
afterEach(() => { spies.splice(0).forEach((x) => x.mockRestore()); });

describe('dividir em partes', () => {
  it('cabe: uma parte só, sem cabeçalho (o limite de verdade é 65.536 letras)', () => {
    expect(splitForWhatsApp('Oi\n\ntudo bem')).toEqual(['Oi\n\ntudo bem']);
    expect(splitForWhatsApp(bigReport())).toEqual([bigReport()]); // relatório grande cabe numa mensagem
    expect(WHATSAPP_TEXT_MAX).toBe(65536);
  });
  it('passou: cada parte cabe; juntas têm todas as linhas, na ordem; cabeçalho “Parte i de n”', () => {
    const t = bigReport();
    expect(t.length).toBeGreaterThan(MAX);
    const parts = splitForWhatsApp(t, MAX);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(MAX);
    const joined = parts.flatMap((p, i) => lines(body(p, i + 1, parts.length)));
    expect(joined).toEqual(lines(t)); // nenhuma linha perdida, nenhuma repetida, mesma ordem
    // o menor número de partes (sem parte quase vazia sobrando)
    expect(parts.length).toBeLessThanOrEqual(Math.ceil(t.length / (MAX - partHeader(99, 99).length)) + 1);
    for (let i = 1; i < parts.length; i++) {
      const first = body(parts[i], i + 1, parts.length).split('\n')[0];
      if (first.startsWith(CONTINUES)) expect(first).toMatch(/\(continua\)$/);
    }
  });
  it('seção maior que uma parte inteira: corta entre linhas, nunca no meio de uma linha; repete o título', () => {
    const t = bigReport(1, 120);
    const parts = splitForWhatsApp(t, MAX);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(MAX);
    expect(parts.flatMap((p, i) => lines(body(p, i + 1, parts.length)))).toEqual(lines(t));
    for (let i = 1; i < parts.length; i++) {
      const first = body(parts[i], i + 1, parts.length).split('\n')[0];
      if (!first.startsWith('📦 *') && !first.startsWith('🔁 *') && !first.startsWith('🧾')) expect(first).toMatch(/^↪️ .+ \(continua\)$/);
    }
  });
});

describe('Enviar no WhatsApp = copiar e abrir o WhatsApp', () => {
  it('celular: copia a mensagem inteira e abre o app (sem link com o texto)', async () => {
    const f = fakePhone();
    const t = bigReport();
    expect(await sendWhatsApp(t, true)).toBe('copied');
    expect(f.writeText).toHaveBeenCalledWith(t); // inteira
    expect(f.go).toHaveBeenCalledWith('whatsapp://');
    expect(f.open).not.toHaveBeenCalled();
    expect(getPendingParts()).toBeNull();
  });
  it('computador: copia e abre o WhatsApp Web', async () => {
    const f = fakePhone();
    f.phone.mockReturnValue(false);
    expect(await sendWhatsApp('Oi', false)).toBe('copied');
    expect(f.writeText).toHaveBeenCalledWith('Oi');
    expect(f.open).toHaveBeenCalledWith('https://web.whatsapp.com/');
  });
  it('não conseguiu copiar: não abre o WhatsApp (senão chegaria lá sem nada para colar)', async () => {
    const f = fakePhone();
    f.writeText.mockRejectedValue(new Error('negado'));
    document.execCommand = vi.fn().mockReturnValue(false) as never;
    expect(await sendWhatsApp('Oi', false)).toBe('copy-failed');
    expect(f.go).not.toHaveBeenCalled();
  });
  it('maior que o máximo, com partes: copia a parte 1 e guarda as outras; pela tela “Mandar parte 2” copia a 2', async () => {
    const f = fakePhone();
    const t = 'x'.repeat(40) + '\n' + Array.from({ length: 2000 }, (_, i) => `linha ${i} ção ✅ começou 3 → terminou 2`).join('\n');
    expect(t.length).toBeGreaterThan(WHATSAPP_TEXT_MAX);
    const parts = splitForWhatsApp(t);
    expect(parts.length).toBe(2);
    expect(await sendWhatsApp(t, true)).toBe('parts');
    expect(f.writeText).toHaveBeenLastCalledWith(parts[0]);
    expect(getPendingParts()).toEqual({ parts, next: 1 });
    render(<App />);
    expect((await screen.findByRole('dialog', { name: /Mandar a próxima parte/ }, { timeout: 5000 })).textContent).toContain('Parte 1 de 2 enviada');
    fireEvent.click(await screen.findByRole('button', { name: /Mandar parte 2/ }));
    await waitFor(() => expect(f.writeText).toHaveBeenLastCalledWith(parts[1]));
    expect(f.go).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Mandar a próxima parte/ })).toBeNull());
    act(() => setPendingParts(null));
  });
});
