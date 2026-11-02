// @vitest-environment jsdom
/**
 * Virada da data (02/11 → 03/11): o dia que ficou aberto encerra sozinho; no “Bom dia”
 * aparece o último backup (data e hora) e a pergunta se quer fazer outro agora.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import App from '../App';
import { seedIfNeeded } from '../db/seed';
import { AppDB, db, useDatabase } from '../db/db';
import { addDays, todayStr, uid } from '../lib/util';
import { autoCloseOldDays, closeDay, reopenDay, startDay } from '../services/days';
import { createOrder } from '../services/sales';
import { setSetting } from '../services/settings';

beforeAll(() => {
  window.scrollTo = vi.fn() as never;
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} }) as never;
  window.open = vi.fn() as never;
  Element.prototype.scrollIntoView = vi.fn();
});
beforeEach(async () => {
  useDatabase(new AppDB(`virada-${Math.random()}`));
  await seedIfNeeded();
  await db.settings.where('key').equals('initialOpening').delete();
  await db.settings.add({ id: `t-${Math.random()}`, key: 'autoDailyPay', value: false });
  localStorage.clear();
});
afterEach(async () => { cleanup(); await new Promise((r) => setTimeout(r, 150)); db.close(); });

const today = () => todayStr();
const yesterday = () => addDays(todayStr(), -1);

describe('o dia de ontem encerra sozinho', () => {
  it('ontem aberto → encerrado (com a marca); hoje continua aberto; vendas e caixa iguais', async () => {
    const d1 = await startDay(yesterday());
    const v = (await db.variants.toArray()).find((x) => x.forSale !== false && x.startQuantity > 0)!;
    await createOrder({ orderId: uid(), dailyRecordId: d1.id, paymentMethod: 'pix', lines: [{ variantId: v.id, quantity: 1, unitPriceInCents: 7000 }] });
    const d2 = await startDay(today());
    expect(await autoCloseOldDays(today())).toEqual([yesterday()]);
    const r1 = (await db.dailyRecords.get(d1.id))!;
    expect(r1.status).toBe('closed');
    expect(r1.autoClosedAt).toBeTruthy();
    expect((await db.cashRecords.where('dailyRecordId').equals(d1.id).first())?.status).toBe('closed');
    expect((await db.dailyRecords.get(d2.id))!.status).toBe('open');
    expect(await db.orders.where('dailyRecordId').equals(d1.id).count()).toBe(1);
    expect(await autoCloseOldDays(today())).toEqual([]); // de novo: nada
  });
  it('já encerrado à mão: não mexe; reaberto de propósito: não fecha de novo', async () => {
    const d1 = await startDay(yesterday());
    await closeDay(d1.id, 12345);
    expect(await autoCloseOldDays(today())).toEqual([]);
    expect((await db.dailyRecords.get(d1.id))!.autoClosedAt ?? null).toBeNull();
    expect((await db.cashRecords.where('dailyRecordId').equals(d1.id).first())?.countedBalanceInCents).toBe(12345);
    await reopenDay(d1.id);
    expect(await autoCloseOldDays(today())).toEqual([]);
    expect((await db.dailyRecords.get(d1.id))!.status).toBe('open');
  });
  it('ao abrir o app no dia seguinte: ontem já aparece encerrado sozinho', async () => {
    const d1 = await startDay(yesterday());
    render(<App />);
    await screen.findByText(/foi encerrado sozinho/, {}, { timeout: 5000 });
    expect((await db.dailyRecords.get(d1.id))!.status).toBe('closed');
  });
});

describe('app aberto quando vira a meia-noite', () => {
  it('02/11 aberto → passa da meia-noite → 02/11 encerra sozinho e a tela vai para o novo dia', async () => {
    const d = await startDay(today());
    render(<App />);
    await screen.findByRole('button', { name: /Encerrar o dia/ }, { timeout: 5000 });
    const real = new Date();
    const next = new Date(real); next.setDate(next.getDate() + 1); next.setHours(0, 1, 0, 0);
    vi.setSystemTime(next);
    try {
      fireEvent(window, new Event('focus'));
      await screen.findByText(/foi encerrado sozinho/, {}, { timeout: 5000 });
      expect((await db.dailyRecords.get(d.id))!.status).toBe('closed');
      await screen.findByLabelText('Último backup');
    } finally { vi.setSystemTime(real); }
  });
});

describe('“Bom dia”: último backup e pergunta', () => {
  it('mostra data e hora do último backup e o botão abre o backup', async () => {
    const at = new Date(); at.setHours(18, 56, 0, 0); at.setDate(at.getDate() - 1);
    await setSetting('lastBackupAt', at.toISOString());
    render(<App />);
    const card = await screen.findByLabelText('Último backup', {}, { timeout: 5000 });
    expect(card.textContent).toContain('às 18:56');
    expect(card.textContent).toMatch(/Quer fazer outro backup agora/);
    fireEvent.click(within(card).getByRole('button', { name: /fazer backup agora/ }));
    await screen.findByText(/Backup em texto|Fazer backup|Salvar backup/i, {}, { timeout: 5000 });
  });
  it('sem backup ainda: avisa e pergunta', async () => {
    render(<App />);
    const card = await screen.findByLabelText('Último backup', {}, { timeout: 5000 });
    expect(card.textContent).toContain('Ainda não fez backup');
    expect(card.textContent).toMatch(/Quer fazer um backup agora/);
  });
});
