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

describe('recomeçar com venda aberta (bug do carrinho)', () => {
  it('abre venda com 2 peças, vai em Configurações e zera tudo: o carrinho some', async () => {
    render(<App />);
    click(await screen.findByRole('button', { name: /Iniciar o dia/ }, { timeout: 5000 }));
    await screen.findByRole('button', { name: /Nova venda/ });
    const navBtn = () => within(screen.getByRole('navigation')).getByRole('button', { name: /Vender/ });
    click(navBtn());
    click((await screen.findAllByRole('button', { name: /^Vender / }))[0]);
    click((await screen.findAllByRole('button', { name: /^Mais 1 / }))[0]);
    await waitFor(() => expect(navBtn().textContent).toContain('2'));
    click(screen.getByRole('button', { name: /Abrir menu/ }));
    click(await screen.findByRole('button', { name: /Configurações/ }));
    click(await screen.findByRole('button', { name: /Reiniciar tudo do 0/ }));
    click(await screen.findByRole('button', { name: /Sim, apagar tudo/ }));
    await waitFor(async () => expect(await db.variants.count()).toBe(0));
    await waitFor(() => expect(navBtn().textContent).not.toMatch(/\d/)); // sem o "2"
    expect(screen.queryByRole('button', { name: /Fechar venda/ })).toBeNull();
  }, 30000);

  it('carrinho se limpa sozinho quando a peça deixa de existir (restaurar, juntar, apagar)', async () => {
    render(<App />);
    click(await screen.findByRole('button', { name: /Iniciar o dia/ }, { timeout: 5000 }));
    await screen.findByRole('button', { name: /Nova venda/ });
    const navBtn = () => within(screen.getByRole('navigation')).getByRole('button', { name: /Vender/ });
    click(navBtn());
    click((await screen.findAllByRole('button', { name: /^Vender / }))[0]);
    await waitFor(() => expect(navBtn().textContent).toContain('1'));
    await db.variants.clear(); // a peça sumiu por fora (ex.: restaurou outro backup)
    await waitFor(() => expect(navBtn().textContent).not.toMatch(/\d/));
  }, 30000);
});

describe('nova cor num app sem grupos (erro "Invalid argument to Table.get()")', () => {
  it('a regra recusa cor sem grupo com mensagem em português; erro técnico vira frase simples', async () => {
    const { createVariant, UserError } = await import('../services/catalog');
    await expect(createVariant({ groupId: undefined as unknown as string, name: 'Vermelho' })).rejects.toThrow(UserError);
    await expect(createVariant({ groupId: '', name: 'Vermelho' })).rejects.toThrow(/Escolha o grupo/);
    const { friendlyError } = await import('../components/ui');
    expect(friendlyError(new UserError('Só há 0 disponível'))).toBe('Só há 0 disponível');
    expect(friendlyError(new Error('Invalid argument to Table.get()'))).toMatch(/^Não deu certo/);
    expect(friendlyError(Object.assign(new Error('x'), { name: 'QuotaExceededError' }))).toMatch(/sem espaço/);
  });
  it('depois de zerar tudo: a janela pede para criar o grupo ali mesmo e salva a cor', async () => {
    const { resetToZero } = await import('../services/backup');
    await resetToZero();
    render(<App />);
    click(await screen.findByRole('button', { name: /Abrir menu/ }, { timeout: 5000 }));
    click(await screen.findByRole('button', { name: /Produtos e grupos/ }));
    click(await screen.findByRole('button', { name: /Variação/ }));
    await screen.findByText(/Primeiro crie um grupo/);
    fireEvent.change(screen.getByPlaceholderText('Ex.: Verde'), { target: { value: 'Vermelho escuro' } });
    const save = () => screen.getAllByRole('button').find((b) => /Crie um grupo primeiro|Salvar Vermelho escuro/.test(b.textContent ?? ''))! as HTMLButtonElement;
    expect(save().disabled).toBe(true); // sem grupo não deixa salvar (antes dava o erro)
    fireEvent.change(screen.getByPlaceholderText('Nome do grupo'), { target: { value: 'Broche' } });
    click(screen.getByRole('button', { name: 'Criar' }));
    await waitFor(() => expect(save().textContent).toBe('Salvar Vermelho escuro em Broche'));
    click(save());
    await waitFor(async () => expect((await db.variants.toArray()).map((v) => v.name)).toEqual(['Vermelho escuro']));
    expect(screen.queryByText(/Invalid argument/)).toBeNull();
  }, 30000);
});

describe('cor arquivada: botão Excluir na lista (pela tela)', () => {
  it('arquiva, aparece "Excluir" ao lado de "Reativar", exclui e some da lista', async () => {
    const { archiveVariant } = await import('../services/catalog');
    const v = (await db.variants.toArray()).find((x) => x.name === 'Rosa')!;
    await archiveVariant(v.id, true);
    const g = (await db.groups.get(v.groupId))!;
    render(<App />);
    click(await screen.findByRole('button', { name: /Abrir menu/ }, { timeout: 5000 }));
    click(await screen.findByRole('button', { name: /Produtos e grupos/ }));
    // dentro da janela do Cadastro (atrás dela está o Início, com cartões do mesmo grupo)
    await screen.findByText('Cadastro', { exact: false });
    const sheet = () => [...document.querySelectorAll('div.fixed.inset-0')].pop() as HTMLElement;
    click((await waitFor(() => within(sheet()).getAllByRole('button', { name: new RegExp(g.name) })))[0]);
    click(await screen.findByRole('button', { name: `Excluir ${v.name}` }));
    click((await screen.findAllByRole('button', { name: /^Excluir$/ })).slice(-1)[0]);
    await waitFor(async () => expect(await db.variants.get(v.id)).toBeUndefined());
    await waitFor(() => expect(screen.queryByRole('button', { name: `Excluir ${v.name}` })).toBeNull());
  }, 30000);
});

describe('chaves do repor e do estoque na mensagem (pela tela)', () => {
  it('na cor: "Precisa repor?" e "Tem estoque mínimo?" salvam; no Encerrar: "Mostrar o estoque" liga e desliga a lista', async () => {
    render(<App />);
    click(await screen.findByRole('button', { name: /Iniciar o dia/ }, { timeout: 5000 }));
    await screen.findByRole('button', { name: /Nova venda/ });
    const v = (await db.variants.toArray()).find((x) => x.name === 'Verde Piscina')!;
    const g = (await db.groups.get(v.groupId))!;
    click(screen.getByRole('button', { name: /Abrir menu/ }));
    click(await screen.findByRole('button', { name: /Produtos e grupos/ }));
    const sheet = () => [...document.querySelectorAll('div.fixed.inset-0')].pop() as HTMLElement;
    click((await waitFor(() => within(sheet()).getAllByRole('button', { name: new RegExp(g.name) })))[0]);
    // a linha da cor (tem “ideal”), não o botão de cor do grupo que também se chama Verde Piscina
    click(await waitFor(() => {
      const b = within(sheet()).getAllByRole('button').find((x) => /Verde Piscina/.test(x.textContent ?? '') && /ideal/.test(x.textContent ?? ''));
      if (!b) throw new Error('linha da cor ainda não apareceu');
      return b;
    }));
    click(await screen.findByRole('switch', { name: /Tem estoque mínimo/ }));
    await waitFor(async () => expect((await db.variants.get(v.id))!.minimumStock).not.toBeNull());
    click(screen.getByRole('switch', { name: /Precisa repor/ }));
    await waitFor(async () => expect((await db.variants.get(v.id))!.restockOff).toBe(true));
    expect(screen.queryByRole('switch', { name: /Tem estoque mínimo/ })).toBeNull(); // sem repor, some o mínimo
    for (let i = 0; i < 4; i++) { fireEvent.keyDown(document, { key: 'Escape' }); await new Promise((r) => setTimeout(r, 80)); }
    click(await screen.findByRole('button', { name: /Encerrar o dia/ }));
    const sw = await screen.findByRole('switch', { name: /Mostrar o estoque/ });
    expect(sw.getAttribute('aria-checked')).toBe('true');
    await screen.findByText(/Estoque agora/);
    // começo → fim do dia: ligado por padrão; desligando, a lista mostra só o número
    const se = await screen.findByRole('switch', { name: /Começo → fim do dia/ });
    expect(se.getAttribute('aria-checked')).toBe('true');
    expect((await screen.findAllByText(/começou \d+ → terminou \d+/)).length).toBeGreaterThan(0);
    // totais no final e divisão entre os grupos: ligados por padrão; desligando, somem da mensagem
    const tot = await screen.findByRole('switch', { name: /Totais no final/ });
    const dv = await screen.findByRole('switch', { name: /Divisão entre os grupos/ });
    expect([tot.getAttribute('aria-checked'), dv.getAttribute('aria-checked')]).toEqual(['true', 'true']);
    await screen.findByText(/Total para repor/);
    // tamanho da mensagem: atual / máximo, bem à vista
    const size = await screen.findByLabelText('Tamanho da mensagem');
    expect(size.textContent).toMatch(/📏 Tamanho da mensagem[\d.]+ \/ 65\.536/);
    // recado em cima do botão: copia e abre o WhatsApp
    screen.getByText(/Ao clicar em “Enviar no WhatsApp” vai/);
    click(tot);
    await waitFor(() => expect(screen.queryByText(/Total para repor/)).toBeNull());
    click(dv);
    await waitFor(async () => expect((await db.settings.where('key').equals('reportDividers').first())?.value).toBe(false));
    click(se);
    await waitFor(() => expect(screen.queryByText(/começou \d+ → terminou \d+/)).toBeNull());
    await waitFor(async () => expect((await db.settings.where('key').equals('reportStockStartEnd').first())?.value).toBe(false));
    click(sw);
    await waitFor(() => expect(screen.queryByText(/Estoque agora/)).toBeNull());
    await waitFor(async () => expect((await db.settings.where('key').equals('reportShowStock').first())?.value).toBe(false));
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
