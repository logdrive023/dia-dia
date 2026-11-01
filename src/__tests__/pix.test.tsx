// @vitest-environment jsdom
/**
 * Pix: QR code guardado em base64, código "copia e cola" válido, iPhone x Android,
 * QR na tela ao escolher Pix na venda, botão "Mostrar Pix" e conferir que o Pix caiu.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../App';
import { seedIfNeeded } from '../db/seed';
import { AppDB, db, useDatabase } from '../db/db';
import { detectPlatform, PIX, PIX_QR_PNG, pixCrc, pixPayloadOk } from '../lib/pix';
import { startDay } from '../services/days';
import { confirmPix, createOrder, pixAmountOf } from '../services/sales';
import { UserError } from '../services/catalog';
import { todayStr, uid } from '../lib/util';

beforeAll(() => {
  window.scrollTo = vi.fn() as never;
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} }) as never;
  window.open = vi.fn() as never;
  Element.prototype.scrollIntoView = vi.fn();
});
beforeEach(async () => {
  useDatabase(new AppDB(`pix-${Math.random()}`));
  await seedIfNeeded();
  await db.variants.toCollection().modify({ forSale: true });
  await db.settings.where('key').equals('initialOpening').delete();
  await db.settings.add({ id: `t-${Math.random()}`, key: 'autoDailyPay', value: false });
});
afterEach(async () => {
  cleanup();
  await new Promise((r) => setTimeout(r, 150));
  db.close();
});
const click = (el: Element) => fireEvent.click(el);
const nav = (name: string) => within(screen.getByRole('navigation')).getByRole('button', { name: new RegExp(name) });
const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  samsung: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
};

describe('Pix: dados', () => {
  it('código copia e cola é Pix válido (CRC confere) e é da Neon/luila', () => {
    expect(pixPayloadOk()).toBe(true);
    expect(PIX.payload).toContain('br.gov.bcb.pix');
    expect(PIX.payload).toContain('luila marques lopes');
    expect(pixCrc(PIX.payload.slice(0, -4))).toBe('AACD');
    // qualquer letra trocada quebra o CRC (não deixa passar código errado)
    expect(pixPayloadOk(PIX.payload.replace('luila', 'luiza'))).toBe(false);
    expect(pixPayloadOk(PIX.payload.slice(0, -1) + 'X')).toBe(false);
  });
  it('QR guardado em base64 é uma imagem PNG de verdade', () => {
    expect(PIX_QR_PNG.startsWith('data:image/png;base64,')).toBe(true);
    const bin = atob(PIX_QR_PNG.split(',')[1]);
    expect([...bin.slice(0, 8)].map((c) => c.charCodeAt(0))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // largura e altura (cabeçalho IHDR): quadrado
    const w = (bin.charCodeAt(16) << 24) | (bin.charCodeAt(17) << 16) | (bin.charCodeAt(18) << 8) | bin.charCodeAt(19);
    const h = (bin.charCodeAt(20) << 24) | (bin.charCodeAt(21) << 16) | (bin.charCodeAt(22) << 8) | bin.charCodeAt(23);
    expect([w, h]).toEqual([480, 480]);
  });
  it('identifica o celular: iPhone (sem Neon) x Samsung/Android (com Neon)', () => {
    expect(detectPlatform(UA.iphone, 5)).toBe('ios');
    expect(detectPlatform(UA.ipadDesktop, 5)).toBe('ios');
    expect(detectPlatform(UA.ipadDesktop, 0)).toBe('outro'); // Mac de verdade
    expect(detectPlatform(UA.samsung, 5)).toBe('android');
    expect(detectPlatform(UA.windows, 0)).toBe('outro');
  });
  it('conferir Pix: só venda com Pix; Pix dividido conta só a parte do Pix', async () => {
    const d = await startDay('2026-11-01');
    const [a, b] = (await db.variants.toArray()).filter((v) => v.startQuantity >= 2);
    const pix = await createOrder({ orderId: uid(), dailyRecordId: d.id, paymentMethod: 'pix', lines: [{ variantId: a.id, quantity: 1, unitPriceInCents: 7000 }] });
    const cash = await createOrder({ orderId: uid(), dailyRecordId: d.id, paymentMethod: 'dinheiro', lines: [{ variantId: a.id, quantity: 1, unitPriceInCents: 7000 }] });
    const mixed = await createOrder({ orderId: uid(), dailyRecordId: d.id, paymentMethod: 'dinheiro', lines: [
      { variantId: a.id, quantity: 1, unitPriceInCents: 7000, paymentMethod: 'pix' }, { variantId: b.id, quantity: 1, unitPriceInCents: 8500, paymentMethod: 'dinheiro' },
    ] });
    expect([pixAmountOf(pix), pixAmountOf(cash), pixAmountOf(mixed)]).toEqual([7000, 0, 7000]);
    await confirmPix(pix.id);
    expect((await db.orders.get(pix.id))!.pixConfirmedAt).toBeTruthy();
    await confirmPix(pix.id, false);
    expect((await db.orders.get(pix.id))!.pixConfirmedAt).toBeNull();
    await expect(confirmPix(cash.id)).rejects.toThrow(UserError);
  });
});

describe('Pix: pela tela', () => {
  it('"Mostrar Pix" no Início abre o QR (imagem do base64), com valor opcional e copiar código', async () => {
    render(<App />);
    click(await screen.findByRole('button', { name: /Iniciar o dia/ }, { timeout: 5000 }));
    click(await screen.findByRole('button', { name: /Mostrar Pix/ }));
    const img = await screen.findByAltText('QR code do Pix') as HTMLImageElement;
    expect(img.src).toBe(PIX_QR_PNG);
    fireEvent.change(screen.getByPlaceholderText('Ex.: 70'), { target: { value: '70' } });
    await screen.findByText('70');
    expect(screen.getByRole('button', { name: /Copiar código Pix/ })).toBeTruthy();
  }, 30000);

  it('Menu › Mostrar meu Pix também abre o QR', async () => {
    render(<App />);
    click(await screen.findByRole('button', { name: /Abrir menu/ }, { timeout: 5000 }));
    click(await screen.findByRole('button', { name: /Mostrar meu Pix/ }));
    expect(await screen.findByAltText('QR code do Pix')).toBeTruthy();
  }, 30000);

  it('na venda: escolheu Pix → QR na tela com o valor; Dinheiro → some; depois "✅ Caiu" confere o Pix', async () => {
    render(<App />);
    click(await screen.findByRole('button', { name: /Iniciar o dia/ }, { timeout: 5000 }));
    await screen.findByRole('button', { name: /Nova venda/ });
    click(nav('Vender'));
    click((await screen.findAllByRole('button', { name: /^Vender Branco$/ }))[0]);
    click(await screen.findByRole('button', { name: /Fechar venda/ }));
    fireEvent.change(await screen.findByPlaceholderText('Preço'), { target: { value: '70' } });
    expect(screen.queryByAltText('QR code do Pix')).toBeNull();
    click(screen.getAllByRole('button', { name: /Pix$/ }).find((b) => b.textContent === '⚡Pix')!);
    expect(await screen.findByAltText('QR code do Pix')).toBeTruthy();
    click(screen.getAllByRole('button').find((b) => b.textContent === '💵Dinheiro')!);
    await waitFor(() => expect(screen.queryByAltText('QR code do Pix')).toBeNull());
    click(screen.getAllByRole('button').find((b) => b.textContent === '⚡Pix')!);
    await screen.findByAltText('QR code do Pix');
    click(screen.getByRole('button', { name: /Confirmar ·/ }));
    await waitFor(async () => expect(await db.orders.count()).toBe(1));
    // aviso minimalista: "Pix de 70: já caiu?" com o botão ✅ Caiu
    click(await screen.findByRole('button', { name: /Caiu/ }));
    await waitFor(async () => expect((await db.orders.toArray())[0].pixConfirmedAt).toBeTruthy());
    await screen.findByText(/Pix de 70 confirmado/);
  }, 30000);

  it('Caixa: venda no Pix mostra "⏳ Conferir Pix"; tocar marca "✅ Pix caiu"', async () => {
    const d = await startDay(todayStr()); // o Caixa abre no dia de hoje
    const v = (await db.variants.toArray()).find((x) => x.startQuantity >= 1)!;
    await createOrder({ orderId: uid(), dailyRecordId: d.id, paymentMethod: 'pix', lines: [{ variantId: v.id, quantity: 1, unitPriceInCents: 7000 }] });
    render(<App />);
    click(await screen.findByRole('button', { name: /Caixa/ }, { timeout: 5000 }));
    click(await screen.findByRole('button', { name: /Conferir Pix/ }));
    expect(await screen.findByText('✅ Pix caiu')).toBeTruthy();
  }, 30000);

  it('no Samsung (Android) manda conferir no Neon; no iPhone avisa que não tem o Neon', async () => {
    const spy = vi.spyOn(window.navigator, 'userAgent', 'get');
    spy.mockReturnValue(UA.samsung);
    render(<App />);
    click(await screen.findByRole('button', { name: /Abrir menu/ }, { timeout: 5000 }));
    click(await screen.findByRole('button', { name: /Mostrar meu Pix/ }));
    expect(await screen.findByText(/Confira no app Neon deste celular/)).toBeTruthy();
    cleanup();
    spy.mockReturnValue(UA.iphone);
    render(<App />);
    click(await screen.findByRole('button', { name: /Abrir menu/ }, { timeout: 5000 }));
    click(await screen.findByRole('button', { name: /Mostrar meu Pix/ }));
    expect(await screen.findByText(/Este iPhone não tem o Neon/)).toBeTruthy();
    spy.mockRestore();
  }, 30000);
});
