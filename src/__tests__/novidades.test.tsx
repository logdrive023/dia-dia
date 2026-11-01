// @vitest-environment jsdom
/** Armazenamento permanente, Menu › Atualizações e a tela de Juntar celulares (pela tela). */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../App';
import { seedIfNeeded } from '../db/seed';
import { AppDB, db, useDatabase } from '../db/db';
import { requestPersist, storageStatus, writeTest } from '../services/storage';
import { CHANGELOG, LATEST_CHANGE } from '../lib/changelog';
import { buildBackup, encodeTextBackup } from '../services/backup';
import { setUpdateState } from '../lib/updateState';

beforeAll(() => {
  window.scrollTo = vi.fn() as never;
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} }) as never;
  window.open = vi.fn() as never;
  Element.prototype.scrollIntoView = vi.fn();
});
beforeEach(async () => {
  useDatabase(new AppDB(`novi-${Math.random()}`));
  await seedIfNeeded();
  await db.settings.where('key').equals('initialOpening').delete();
  await db.settings.add({ id: `t-${Math.random()}`, key: 'autoDailyPay', value: false });
  localStorage.clear();
});
afterEach(async () => { cleanup(); await new Promise((r) => setTimeout(r, 150)); db.close(); vi.unstubAllGlobals(); });
const click = (el: Element) => fireEvent.click(el);

describe('armazenamento permanente', () => {
  it('pede ao navegador para guardar; se já está protegido, não pede de novo', async () => {
    const persist = vi.fn().mockResolvedValue(true);
    const persisted = vi.fn().mockResolvedValue(false);
    vi.stubGlobal('navigator', { ...navigator, storage: { persist, persisted, estimate: vi.fn().mockResolvedValue({ usage: 2e6, quota: 5e8 }) } });
    expect(await requestPersist()).toEqual({ supported: true, persisted: true });
    expect(persist).toHaveBeenCalledTimes(1);
    persisted.mockResolvedValue(true);
    expect(await requestPersist()).toEqual({ supported: true, persisted: true });
    expect(persist).toHaveBeenCalledTimes(1);
    const st = await storageStatus();
    expect([st.persisted, st.usage, st.quota, st.writeOk]).toEqual([true, 2e6, 5e8, true]);
  });
  it('navegador sem suporte: avisa sem quebrar; teste de gravação confere de verdade', async () => {
    vi.stubGlobal('navigator', { ...navigator, storage: undefined });
    expect(await requestPersist()).toEqual({ supported: false, persisted: false });
    expect(await writeTest()).toBe(true);
    expect(await db.settings.filter((s) => s.key.startsWith('teste-gravacao')).count()).toBe(0); // não deixa lixo
  });
});

describe('Menu › Atualizações', () => {
  it('mostra "Novo" até abrir; abre a lista com a mais nova primeiro', async () => {
    expect(CHANGELOG[0].id).toBe(LATEST_CHANGE);
    expect(new Set(CHANGELOG.map((c) => c.id)).size).toBe(CHANGELOG.length); // ids únicos
    render(<App />);
    click(await screen.findByRole('button', { name: /Abrir menu/ }, { timeout: 5000 }));
    const item = await screen.findByRole('button', { name: /Atualizações/ });
    expect(within(item).getByText('Novo')).toBeTruthy();
    click(item);
    await screen.findByText(CHANGELOG[0].title);
    expect(screen.getByText('mais nova')).toBeTruthy();
    await waitFor(() => expect(localStorage.getItem('changelogSeen')).toBe(LATEST_CHANGE));
  }, 30000);
});

describe('selo da versão no cabeçalho', () => {
  it('"✓ Atualizado" na última versão; "🆕 Atualizar" quando sai uma nova (tocar atualiza)', async () => {
    render(<App />);
    await screen.findByRole('button', { name: /Abrir menu/ }, { timeout: 5000 });
    expect(screen.queryByText('✓ Atualizado')).toBeNull(); // sem service worker: não mostra nada
    act(() => setUpdateState({ ready: true }));
    expect(await screen.findByText('✓ Atualizado')).toBeTruthy();
    const apply = vi.fn();
    act(() => setUpdateState({ needRefresh: true, apply }));
    click(await screen.findByRole('button', { name: /Atualizar o app para a versão nova/ }));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('✓ Atualizado')).toBeNull();
    act(() => setUpdateState({ ready: false, needRefresh: false }));
  }, 30000);
});

describe('Juntar com outro celular (pela tela)', () => {
  it('gera o código e, colando o código de outro celular, junta as vendas', async () => {
    // código "do outro celular": um banco separado com uma venda
    const other = new AppDB(`outro-${Math.random()}`);
    const mine = db;
    useDatabase(other);
    await seedIfNeeded();
    await db.settings.where('key').equals('initialOpening').delete();
    const { startDay } = await import('../services/days');
    const { createOrder } = await import('../services/sales');
    const d = await startDay('2026-11-01');
    const v = (await db.variants.toArray()).find((x) => x.forSale !== false && x.startQuantity >= 1)!;
    await createOrder({ orderId: 'venda-do-outro', dailyRecordId: d.id, paymentMethod: 'pix', lines: [{ variantId: v.id, quantity: 1, unitPriceInCents: 7000 }] });
    const code = (await encodeTextBackup(await buildBackup())).join('\n\n');
    useDatabase(mine);

    render(<App />);
    click(await screen.findByRole('button', { name: /Abrir menu/ }, { timeout: 5000 }));
    click(await screen.findByRole('button', { name: /Juntar com outro celular/ }));
    click(await screen.findByRole('button', { name: 'Gerar código' }));
    expect((await screen.findAllByRole('button', { name: /Copiar/ })).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByPlaceholderText(/Cole aqui o código/), { target: { value: code } });
    click(screen.getByRole('button', { name: /🔄 Juntar/ }));
    click((await screen.findAllByRole('button', { name: /^Juntar$/ })).slice(-1)[0]);
    await waitFor(async () => expect(await db.orders.get('venda-do-outro')).toBeTruthy());
    await screen.findByText(/Juntou: 1 vendas novas/);
  }, 30000);
});
