// @vitest-environment jsdom
/**
 * Teste de tela (ponta a ponta): abre o app e usa como a pessoa usaria no dia a dia.
 * Iniciar o dia → vender 2 peças (preço já preenchido na 2ª venda) → dei dinheiro → encerrar → relatório.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../App';
import { seedIfNeeded } from '../db/seed';
import { db } from '../db/db';

beforeAll(() => {
  window.scrollTo = vi.fn() as never;
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} }) as never;
  window.open = vi.fn() as never;
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

const click = (el: HTMLElement) => fireEvent.click(el);
const btn = (name: RegExp | string) => screen.getByRole('button', { name });
const tab = (name: string) => within(screen.getByRole('navigation')).getByRole('button', { name: new RegExp(name) });
const setInput = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });
const confirmDialog = async (label: RegExp) => click(await screen.findByRole('button', { name: label }));

describe('dia de trabalho completo pela tela', () => {
  it('inicia, vende, lança, encerra e gera o relatório', async () => {
    await seedIfNeeded();
    await db.settings.where('key').equals('initialOpening').delete();
    render(<App />);
    // abre sem travar no "Abrindo…"
    click(await screen.findByRole('button', { name: /Iniciar o dia/ }, { timeout: 5000 }));
    await screen.findByRole('button', { name: /Nova venda/ });

    // venda 1: escolhe a peça, digita o preço, Pix
    click(tab('Vender'));
    const plus = await screen.findAllByRole('button', { name: /^Vender / });
    click(plus[0]);
    click(await screen.findByRole('button', { name: /Fechar venda/ }));
    setInput(await screen.findByPlaceholderText('Preço'), '70');
    click(btn(/^⚡\s*Pix$/));
    click(btn(/Confirmar · 1 peça · 70/));
    await waitFor(async () => expect(await db.orders.count()).toBe(1));

    // venda 2: preço já vem preenchido (70), só confirmar
    click((await screen.findAllByRole('button', { name: /^Vender / }))[1]);
    click(await screen.findByRole('button', { name: /Fechar venda/ }));
    expect(((await screen.findByPlaceholderText('Preço')) as HTMLInputElement).value).toBe('70');
    click(btn(/Confirmar · 1 peça · 70/));
    await waitFor(async () => expect(await db.orders.count()).toBe(2));

    // caixa: dei dinheiro ao Chico
    click(tab('Caixa'));
    click(await screen.findByRole('button', { name: /Dei dinheiro/ }));
    setInput(screen.getByPlaceholderText('0'), '50');
    setInput(screen.getByPlaceholderText('Ex.: Chico'), 'Chico');
    click(btn(/Lançar 50/));
    await screen.findByText(/Dei a Chico/);

    // início → encerrar o dia
    click(tab('Início'));
    click(await screen.findByRole('button', { name: /Encerrar o dia/ }));
    await screen.findByText(/Dinheiro vivo contado/, {}, { timeout: 5000 }); // a janela carrega sob demanda
    const sheetBtns = screen.getAllByRole('button', { name: /Encerrar o dia/ });
    click(sheetBtns[sheetBtns.length - 1]);
    await confirmDialog(/^Encerrar$/);
    await waitFor(async () => expect((await db.dailyRecords.toArray())[0].status).toBe('closed'));

    // relatório pronto: um toque manda para o WhatsApp
    click(await screen.findByRole('button', { name: /Enviar relatório do dia no WhatsApp/ }));
    const url = decodeURIComponent((window.open as unknown as ReturnType<typeof vi.fn>).mock.calls.slice(-1)[0][0] as string);
    expect(url).toContain('Vendeu: *140*');
    expect(url).toContain('Dei a Chico: 50');
    expect(url).toContain('Hoje: +90 (vendas 140 - 50)');
  }, 20000);

  it('“Início” sempre volta para hoje e só a aba atual fica destacada', async () => {
    render(<App />);
    await screen.findByRole('navigation', {}, { timeout: 5000 });
    click(screen.getAllByRole('button', { name: /^\d{2}\/\d{2}\/\d{2} / })[0]); // um dia antigo na faixa
    await screen.findByRole('button', { name: /Voltar para hoje/ });
    click(tab('Início'));
    await waitFor(() => expect(screen.queryByText(/Você está vendo/)).toBeNull());
    const current = within(screen.getByRole('navigation')).getAllByRole('button').filter((b) => b.getAttribute('aria-current') === 'page');
    expect(current.map((b) => b.textContent)).toEqual([expect.stringContaining('Início')]);
  }, 20000);
});
