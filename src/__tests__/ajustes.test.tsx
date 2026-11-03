// @vitest-environment jsdom
/**
 * Ajustes do diagnóstico de 02/11:
 *  2) venda no meio quando vira a meia-noite: o dia espera a venda terminar;
 *  4) juntar: a situação do dia e as chaves da mensagem seguem o que foi feito por último;
 *  5) estoque mínimo nunca maior que a meta;
 *  6) “Outros apps” sem o link antigo do WhatsApp;
 *  7) o código do Juntar conta como backup;
 *  8) as partes da mensagem continuam guardadas se o app fechar;
 *  9) dia reaberto esquecido aberto: aviso com “Encerrar”.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../App';
import { seedIfNeeded } from '../db/seed';
import { AppDB, db, useDatabase } from '../db/db';
import { addDays, todayStr } from '../lib/util';
import { closeDay, reopenDay, startDay } from '../services/days';
import { createGroup, createVariant, updateVariant } from '../services/catalog';
import { restockOf } from '../services/summary';
import { shareText } from '../services/report';
import { buildBackup } from '../services/backup';
import { mergeBackup } from '../services/sync';
import { getSetting, setSetting } from '../services/settings';
import { getPendingParts, PENDING_PARTS_TTL_MS, reloadPendingParts, setPendingParts } from '../lib/pendingParts';

beforeAll(() => {
  window.scrollTo = vi.fn() as never;
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} }) as never;
  Element.prototype.scrollIntoView = vi.fn();
});
beforeEach(async () => {
  window.open = vi.fn() as never;
  localStorage.clear();
  setPendingParts(null);
  useDatabase(new AppDB(`ajustes-${Math.random()}`));
  await seedIfNeeded();
  await db.settings.where('key').equals('initialOpening').delete();
  await db.settings.add({ id: `t-${Math.random()}`, key: 'autoDailyPay', value: false });
});
afterEach(async () => { cleanup(); await new Promise((r) => setTimeout(r, 150)); db.close(); });
const click = (el: HTMLElement) => fireEvent.click(el);

describe('5) estoque mínimo nunca maior que a meta', () => {
  it('cadastro e edição recusam mínimo acima da meta (também ao baixar a meta)', async () => {
    const d = await startDay(todayStr());
    const g = await createGroup({ name: 'Min' });
    await expect(createVariant({ groupId: g.id, name: 'X', startQuantity: 5, minimumStock: 6, dailyRecordId: d.id })).rejects.toThrow('O estoque mínimo (6) não pode ser maior que a meta (5).');
    const v = await createVariant({ groupId: g.id, name: 'Y', startQuantity: 5, idealStock: 10, minimumStock: 3, dailyRecordId: d.id });
    await expect(updateVariant(v.id, { minimumStock: 11 })).rejects.toThrow(/mínimo \(11\).*meta \(10\)/);
    await expect(updateVariant(v.id, { idealStock: 2 })).rejects.toThrow(/mínimo \(3\).*meta \(2\)/);
    await updateVariant(v.id, { minimumStock: 10 }); // igual à meta pode
    expect((await db.variants.get(v.id))!.minimumStock).toBe(10);
  });
  it('dado antigo com mínimo acima da meta: conta como a meta (não inventa “repor 1”)', () => {
    const old = { restockOff: false, minimumStock: 10 };
    expect(restockOf(old, 7, 5)).toBe(0); // antes dava 1
    expect(restockOf(old, 5, 5)).toBe(0);
    expect(restockOf(old, 4, 5)).toBe(1);
    expect(restockOf({ minimumStock: 3 }, 3, 10)).toBe(7); // regra normal continua
    expect(restockOf({ minimumStock: 3 }, 5, 10)).toBe(0);
  });
});

describe('6) “Outros apps”', () => {
  it('sem o compartilhar do aparelho: copia o texto e não abre o link antigo', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    delete (navigator as { share?: unknown }).share;
    expect(await shareText('Oi')).toBe('copied');
    expect(writeText).toHaveBeenCalledWith('Oi');
    expect(window.open).not.toHaveBeenCalled();
  });
  it('com o compartilhar: usa ele', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    expect(await shareText('Oi', 'T')).toBe('shared');
    expect(share).toHaveBeenCalledWith({ title: 'T', text: 'Oi' });
    delete (navigator as { share?: unknown }).share;
  });
});

describe('7) código do Juntar conta como backup', () => {
  it('Gerar código atualiza o “último backup”', async () => {
    expect(await getSetting('lastBackupAt')).toBeNull();
    render(<App />);
    click(await screen.findByRole('button', { name: /Abrir menu/ }, { timeout: 5000 }));
    click(await screen.findByRole('button', { name: /Juntar com outro celular/ }));
    click(await screen.findByRole('button', { name: /Gerar código/ }));
    await waitFor(async () => expect(await getSetting('lastBackupAt')).toBeTruthy());
  });
});

describe('8) partes guardadas no aparelho', () => {
  it('o app fechou no meio: ao abrir de novo, “Mandar parte 2” continua; depois de 12 h some', () => {
    setPendingParts({ parts: ['p1', 'p2'], next: 1 });
    expect(JSON.parse(localStorage.getItem('pendingParts')!)).toMatchObject({ parts: ['p1', 'p2'], next: 1 });
    reloadPendingParts(); // como se abrisse o app de novo
    expect(getPendingParts()).toEqual({ parts: ['p1', 'p2'], next: 1 });
    const saved = JSON.parse(localStorage.getItem('pendingParts')!);
    localStorage.setItem('pendingParts', JSON.stringify({ ...saved, savedAt: Date.now() - PENDING_PARTS_TTL_MS - 1 }));
    reloadPendingParts();
    expect(getPendingParts()).toBeNull();
    setPendingParts({ parts: ['p1', 'p2'], next: 2 }); // acabou: limpa
    expect(localStorage.getItem('pendingParts')).toBeNull();
  });
});

describe('9) dia reaberto esquecido aberto', () => {
  it('avisa no Início e “Encerrar” fecha', async () => {
    const y = addDays(todayStr(), -1);
    const d1 = await startDay(y);
    await closeDay(d1.id);
    await reopenDay(d1.id);
    render(<App />);
    const note = await screen.findByRole('status', { name: new RegExp(`reaberto`) }, { timeout: 5000 });
    expect(note.textContent).toMatch(/foi reaberto e continua aberto/);
    click(within(note).getByRole('button', { name: 'Encerrar' }));
    // confirmação (o último “Encerrar” é o da janela)
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^Encerrar$/ }).length).toBe(2));
    click(screen.getAllByRole('button', { name: /^Encerrar$/ }).slice(-1)[0]);
    await waitFor(async () => expect((await db.dailyRecords.get(d1.id))!.status).toBe('closed'));
    await waitFor(() => expect(screen.queryByRole('status', { name: /reaberto/ })).toBeNull());
  });
});

describe('2) venda no meio quando vira a meia-noite', () => {
  it('peça no carrinho: o dia não vira (avisa); terminou a venda → vai para o dia certo e aí vira', async () => {
    render(<App />);
    click(await screen.findByRole('button', { name: /Iniciar o dia/ }, { timeout: 5000 }));
    await screen.findByRole('button', { name: /Nova venda/ });
    const day1 = (await db.dailyRecords.where('date').equals(todayStr()).first())!;
    click(within(screen.getByRole('navigation')).getByRole('button', { name: /Vender/ }));
    click((await screen.findAllByRole('button', { name: /^Vender / }))[0]);
    click(await screen.findByRole('button', { name: /Fechar venda/ }));
    fireEvent.change(await screen.findByPlaceholderText('Preço'), { target: { value: '70' } });
    // passa da meia-noite com a venda aberta
    const real = new Date();
    const next = new Date(real); next.setDate(next.getDate() + 1); next.setHours(0, 1, 0, 0);
    vi.setSystemTime(next);
    try {
      fireEvent(window, new Event('focus'));
      const banner = await screen.findByRole('status', { name: 'Virou o dia' });
      expect(banner.textContent).toMatch(/Termine esta venda/);
      expect((await db.dailyRecords.get(day1.id))!.status).toBe('open'); // não fechou com a venda no meio
      // termina a venda
      click(screen.getByRole('button', { name: /Confirmar · 1 peça · 70/ }));
      await waitFor(async () => expect(await db.orders.count()).toBe(1));
      expect((await db.orders.toArray())[0].dailyRecordId).toBe(day1.id); // ficou no dia em que começou
      // agora sim: o dia de ontem encerra sozinho e a tela vai para o novo dia
      await waitFor(async () => expect((await db.dailyRecords.get(day1.id))!.status).toBe('closed'), { timeout: 5000 });
      await waitFor(() => expect(screen.queryByRole('status', { name: 'Virou o dia' })).toBeNull());
    } finally { vi.setSystemTime(real); }
  });
});

describe('4) juntar: situação do dia e chaves da mensagem', () => {
  /** dois celulares a partir do mesmo começo */
  async function twoPhones() {
    const a = new AppDB(`A-${Math.random()}`), b = new AppDB(`B-${Math.random()}`);
    useDatabase(a); await seedIfNeeded(); await db.settings.where('key').equals('initialOpening').delete();
    const d = await startDay('2026-11-02');
    const start = await buildBackup();
    useDatabase(b); const { restoreBackup } = await import('../services/backup'); await restoreBackup(start, { keepSafety: false });
    return { a, b, dayId: d.id };
  }
  const at = (iso: string) => vi.setSystemTime(new Date(iso));
  it('A encerrou depois que B reabriu → fica encerrado nos dois; B reabriu por último → aberto nos dois', async () => {
    const real = new Date();
    try {
      const { a, b, dayId } = await twoPhones();
      useDatabase(a); at('2026-11-03T00:05:00'); await closeDay(dayId); // A: encerrou (ex.: sozinho na virada)
      useDatabase(b); at('2026-11-03T00:01:00'); await closeDay(dayId); at('2026-11-03T00:02:00'); await reopenDay(dayId); // B: reabriu antes
      useDatabase(a); const fromA = await buildBackup(); useDatabase(b); await mergeBackup(fromA);
      expect((await db.dailyRecords.get(dayId))!.status).toBe('closed');
      expect((await db.cashRecords.where('dailyRecordId').equals(dayId).first())!.status).toBe('closed');
      // B reabre depois (de propósito): ao juntar no A, fica aberto
      at('2026-11-03T00:10:00'); await reopenDay(dayId);
      const fromB = await buildBackup(); useDatabase(a); await mergeBackup(fromB);
      expect((await db.dailyRecords.get(dayId))!.status).toBe('open');
      expect((await db.dailyRecords.get(dayId))!.reopenedAt).toBe(new Date('2026-11-03T00:10:00').toISOString());
      // importar de novo não muda nada
      await mergeBackup(fromB);
      expect((await db.dailyRecords.get(dayId))!.status).toBe('open');
    } finally { vi.setSystemTime(real); }
  });
  it('chaves da mensagem: vale o celular que mudou por último', async () => {
    const real = new Date();
    try {
      const { a, b } = await twoPhones();
      useDatabase(a); at('2026-11-02T10:00:00'); await setSetting('reportTotals', false);
      useDatabase(b); at('2026-11-02T11:00:00'); await setSetting('reportDividers', false); await setSetting('reportShowStock', false);
      const fromB = await buildBackup(); useDatabase(a); await mergeBackup(fromB);
      // B mudou por último: A fica igual ao B
      expect([await getSetting('reportShowStock'), await getSetting('reportDividers'), await getSetting('reportTotals')]).toEqual([false, false, true]);
      // B recebe do A (que agora tem as do B): continua igual
      const fromA = await buildBackup(); useDatabase(b); await mergeBackup(fromA);
      expect([await getSetting('reportShowStock'), await getSetting('reportDividers'), await getSetting('reportTotals')]).toEqual([false, false, true]);
      // A muda de novo depois: vai para o B
      useDatabase(a); at('2026-11-02T12:00:00'); await setSetting('reportShowStock', true);
      const fromA2 = await buildBackup(); useDatabase(b); await mergeBackup(fromA2);
      expect(await getSetting('reportShowStock')).toBe(true);
    } finally { vi.setSystemTime(real); }
  });
});

describe('📅 calendário (bug: não abria no celular)', () => {
  it('o toque cai no próprio campo de data (não um botão com o campo escondido) e escolher a data muda o dia', async () => {
    render(<App />);
    const input = (await screen.findByLabelText('Outra data', {}, { timeout: 5000 })) as HTMLInputElement;
    expect(input.type).toBe('date');
    expect(input.closest('button')).toBeNull(); // campo dentro de botão: o iPhone não abre o calendário
    expect(input.className).not.toMatch(/pointer-events-none/);
    const showPicker = vi.fn();
    (input as unknown as { showPicker: () => void }).showPicker = showPicker;
    fireEvent.click(input);
    expect(showPicker).toHaveBeenCalledTimes(1); // no computador abre com um clique (uma vez só)
    fireEvent.change(input, { target: { value: addDays(todayStr(), -12) } });
    expect((await screen.findAllByRole('button', { name: /Voltar para hoje/ })).length).toBeGreaterThan(0);
  });
});
