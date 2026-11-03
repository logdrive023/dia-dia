// @vitest-environment jsdom
/**
 * Teste extremo por aba, pela tela (como a pessoa usa): cada botão, cada função,
 * e tentativas de errar de propósito (valor vazio, inválido, além do estoque, toque repetido).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../App';
import { seedIfNeeded } from '../db/seed';
import { AppDB, db, useDatabase } from '../db/db';

beforeAll(() => {
  window.scrollTo = vi.fn() as never;
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} }) as never;
  window.open = vi.fn() as never;
  Element.prototype.scrollIntoView = vi.fn();
});
beforeEach(async () => {
  useDatabase(new AppDB(`abas-${Math.random()}`));
  await seedIfNeeded();
  await db.settings.where('key').equals('initialOpening').delete(); // caixa começa zerado nos testes de tela
  await db.settings.add({ id: `t-${Math.random()}`, key: 'autoDailyPay', value: false }); // diária automática tem teste próprio
});
// desmonta a tela e espera gravações que o último toque deixou em andamento antes do próximo teste trocar de banco
afterEach(async () => {
  cleanup();
  await new Promise((r) => setTimeout(r, 150));
  db.close();
});

const click = (el: Element) => fireEvent.click(el);
const type = (el: Element, value: string) => fireEvent.change(el, { target: { value } });
const nav = (name: string) => within(screen.getByRole('navigation')).getByRole('button', { name: new RegExp(name) });
const lastBtn = (name: RegExp) => { const all = screen.getAllByRole('button', { name }); return all[all.length - 1]; };
const confirmDialog = async (label: RegExp) => { await screen.findAllByRole('button', { name: label }); click(lastBtn(label)); };
const toastText = async (re: RegExp) => screen.findByText(re, {}, { timeout: 3000 });

async function openAndStart() {
  render(<App />);
  click(await screen.findByRole('button', { name: /Iniciar o dia/ }, { timeout: 5000 }));
  await screen.findByRole('button', { name: /Nova venda/ });
}
async function sell(name: string, price = '70', method?: RegExp) {
  click(nav('Vender'));
  click((await screen.findAllByRole('button', { name: new RegExp(`^Vender ${name}$`) }))[0]);
  click(await screen.findByRole('button', { name: /Fechar venda/ }));
  const p = await screen.findByPlaceholderText('Preço') as HTMLInputElement;
  if (!p.value) type(p, price);
  if (method) click(screen.getByRole('button', { name: method }));
  const before = await db.orders.count();
  click(screen.getByRole('button', { name: /Confirmar ·/ }));
  await waitFor(async () => expect(await db.orders.count()).toBe(before + 1));
}

describe('Aba Início', () => {
  it('cartões explicam e levam ao estoque; saldo leva ao caixa; WhatsApp; desfazer início', async () => {
    await openAndStart();
    // desfazer o início enquanto vazio, e iniciar de novo
    click(await screen.findByRole('button', { name: /^Desfazer$/ }));
    await confirmDialog(/Desfazer e escolher de novo/);
    click(await screen.findByRole('button', { name: /Iniciar o dia/ }));
    await screen.findByRole('button', { name: /Nova venda/ });
    // cada número: toque abre explicação com exemplo; "Ver no Estoque" muda de aba
    for (const label of ['Peças no estoque', 'Para repor', 'Esgotados', 'Entrou hoje']) {
      click(screen.getByRole('button', { name: new RegExp(`^${label}: \\d+`) }));
      await screen.findByText('💡 Por exemplo');
      click(screen.getByRole('button', { name: 'Entendi' }));
      await waitFor(() => expect(screen.queryByText('💡 Por exemplo')).toBeNull());
    }
    click(screen.getByRole('button', { name: /^Para repor: / }));
    click(await screen.findByRole('button', { name: /Ver no Estoque/ }));
    await waitFor(() => expect(screen.getByRole('heading').textContent).toBe('Estoque'));
    click(nav('Início'));
    click(await screen.findByRole('button', { name: /Saldo do caixa/ }));
    await waitFor(() => expect(screen.getByRole('heading').textContent).toBe('Caixa'));
    click(nav('Início'));
    // copia a mensagem e abre o WhatsApp (no computador, WhatsApp Web)
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    click(await screen.findByRole('button', { name: /Enviar relatório do dia no WhatsApp/ }));
    await waitFor(() => expect(writeText.mock.calls[0]?.[0]).toMatch(/Fechamento/));
    expect((window.open as unknown as ReturnType<typeof vi.fn>).mock.calls.slice(-1)[0][0]).toBe('https://web.whatsapp.com/');
    // selo "Tudo salvo" abre explicação
    click(screen.getByRole('button', { name: /Ver quando foi salvo/ }));
    await screen.findByText(/Última vez que salvou/);
  }, 30000);
});

describe('Aba Vender', () => {
  it('não passa do estoque, tira peça, sem preço pergunta, dividido valida, reserva e converte', async () => {
    await openAndStart();
    click(nav('Vender'));
    // Plomo Rosa tem 1 peça: tocar 5x só põe 1
    click((await screen.findAllByRole('button', { name: /^Vender Rosa$/ }))[0]);
    const plus = screen.getAllByRole('button', { name: /^Mais 1 Rosa$/ })[0];
    for (let i = 0; i < 5; i++) click(plus);
    expect(screen.getByRole('button', { name: /Fechar venda/ }).textContent).toMatch(/1 peça/);
    // tira e põe de novo
    click(screen.getAllByRole('button', { name: /^Tirar 1 Rosa$/ })[0]);
    expect(screen.queryByRole('button', { name: /Fechar venda/ })).toBeNull();
    click((await screen.findAllByRole('button', { name: /^Vender Rosa$/ }))[0]);
    click(screen.getByRole('button', { name: /Fechar venda/ }));
    // preço inválido = sem preço → pergunta antes
    type(await screen.findByPlaceholderText('Preço'), 'abc');
    click(screen.getByRole('button', { name: /Confirmar ·/ }));
    await screen.findByText('Vender sem preço?');
    click(lastBtn(/^Voltar$/));
    type(screen.getByPlaceholderText('Preço'), '80');
    // uma peça só: não aparece a opção de várias formas
    expect(screen.queryByRole('switch', { name: /Pagou tudo numa forma só/ })).toBeNull();
    await waitFor(() => expect((screen.getByRole('button', { name: /Confirmar ·/ }) as HTMLButtonElement).disabled).toBe(false));
    click(screen.getByRole('button', { name: /Confirmar ·/ }));
    await waitFor(async () => expect(await db.orders.count()).toBe(1));
    const cash = await db.cashMovements.toArray();
    expect(cash.map((c) => c.amountInCents)).toEqual([8000]);
    // agora Rosa esgotou: botão Vender some e aparece "sem peça"
    await waitFor(() => expect(screen.queryAllByRole('button', { name: /^Vender Rosa$/ }).length).toBeLessThan(2));
    // reservar com nome e vender depois
    click(screen.getAllByRole('button', { name: /^Reservar Branco$/ })[0]);
    type(await screen.findByPlaceholderText('Ex.: Ana'), 'Ana');
    click(screen.getByRole('button', { name: /Reservar 1 peça para Ana/ }));
    await screen.findByText(/Reservas ativas/i);
    await screen.findByText(/1× .*Branco/);
    click(screen.getAllByRole('button', { name: 'Vender' }).slice(-1)[0]);
    type((await screen.findAllByPlaceholderText('Preço')).slice(-1)[0], '70');
    click(screen.getByRole('button', { name: /Confirmar venda/ }));
    await waitFor(async () => expect((await db.reservations.toArray())[0].status).toBe('converted'));
  }, 30000);

  it('esconder e mostrar grupo em "Para vender" não mexe em nada', async () => {
    await openAndStart();
    click(nav('Vender'));
    await screen.findAllByRole('button', { name: /^Vender / });
    click(screen.getByRole('button', { name: 'Escolher grupos' }));
    await screen.findByText(/Aparecem \(/);
    const on = screen.getAllByRole('switch').filter((s) => s.getAttribute('aria-checked') === 'true');
    const before = on.length;
    click(on[0]);
    await waitFor(() => expect(screen.getAllByRole('switch').filter((s) => s.getAttribute('aria-checked') === 'true').length).toBe(before - 1));
    click(screen.getAllByRole('switch').filter((s) => s.getAttribute('aria-checked') === 'false')[0]);
    await waitFor(() => expect(screen.getAllByRole('switch').filter((s) => s.getAttribute('aria-checked') === 'true').length).toBe(before));
    expect(await db.dailyStockItems.count()).toBe(51);
  }, 30000);
});

describe('Aba Estoque', () => {
  it('+ com desfazer, − protege reserva, definir quantidade, movimentos e filtros', async () => {
    await openAndStart();
    click(nav('Estoque'));
    click(await screen.findByRole('button', { name: /Lila/ }));
    const row = (await screen.findAllByText('Rosa')).map((e) => e.closest('div.flex.items-center')).find(Boolean)!;
    const [minus, , plusBtn] = within(row as HTMLElement).getAllByRole('button').filter((b) => ['−', '+'].includes(b.textContent!) || /^\d+$/.test(b.textContent!));
    click(plusBtn);
    // o aviso "Desfazer o início" some quando há lançamento; o Desfazer certo é o da notificação
    await waitFor(() => expect(screen.queryByText(/Começou do jeito errado/)).toBeNull());
    click(screen.getAllByRole('button', { name: 'Desfazer' }).slice(-1)[0]);
    await waitFor(async () => expect((await db.stockMovements.toArray()).filter((m) => m.type === 'correcao').length).toBe(1));
    // reserva 5 de 5 e tenta tirar 1 → pergunta
    click(nav('Vender'));
    click(screen.getByRole('button', { name: 'Todos os grupos' }));
    click((await screen.findAllByRole('button', { name: /^Reservar Rosa$/ }))[1] ?? screen.getAllByRole('button', { name: /^Reservar Rosa$/ })[0]);
    const stepPlus = await screen.findAllByRole('button', { name: '+' });
    for (let i = 0; i < 6; i++) click(stepPlus[stepPlus.length - 1]);
    click(screen.getByRole('button', { name: /Reservar \d+ peças?/ }));
    await waitFor(async () => expect(await db.reservations.count()).toBe(1));
    click(nav('Estoque'));
    click(await screen.findByRole('button', { name: /Lila/ }));
    void minus;
    const row2 = (await screen.findAllByText('Rosa')).map((e) => e.closest('div.flex.items-center')).find(Boolean)!;
    click(within(row2 as HTMLElement).getAllByRole('button').find((b) => b.textContent === '−')!);
    await screen.findByText('Tem peça reservada');
    click(lastBtn(/^Voltar$/));
    // movimentos com filtros
    click(screen.getByRole('button', { name: /Movimentos do dia/ }));
    await screen.findByText(/já está salvo no sistema/);
    for (const f of [/Vendidas/, /Entraram/, /Saíram/, /Ajustes/, /Todos/]) click(screen.getAllByRole('button', { name: f }).slice(-1)[0]);
    expect(await db.dailyStockItems.toArray().then((x) => x.every((i) => i.currentQuantity >= 0))).toBe(true);
  }, 30000);
});

describe('Pagamento por peça (pela tela)', () => {
  it('2 peças: desliga "tudo numa forma só", uma no Pix e outra no Dinheiro; religar junta de novo', async () => {
    await openAndStart();
    click(nav('Vender'));
    // 2 da mesma peça: "+ Vender" e depois o "+" dela
    const add = async () => {
      click((await screen.findAllByRole('button', { name: /^Vender Branco$/ }))[0]);
      click((await screen.findAllByRole('button', { name: /^Mais 1 Branco$/ }))[0]);
    };
    await add();
    click(await screen.findByRole('button', { name: /Fechar venda/ }));
    const sw = await screen.findByRole('switch', { name: /Pagou tudo numa forma só/ });
    expect(sw.getAttribute('aria-checked')).toBe('true');
    click(sw); // desliga: cada peça vira uma linha com a sua forma
    await waitFor(() => expect(screen.getAllByPlaceholderText('Preço').length).toBe(2));
    screen.getAllByPlaceholderText('Preço').forEach((p) => type(p, '70'));
    click(screen.getAllByRole('button', { name: /paga no Pix$/ })[0]);
    // resumo soma por forma
    await screen.findByText('Resumo da venda', { exact: false });
    click(screen.getByRole('button', { name: /Confirmar · 2 peças/ }));
    await waitFor(async () => expect(await db.orders.count()).toBe(1));
    const cash = await db.cashMovements.toArray();
    expect(cash.map((c) => [c.paymentMethod, c.amountInCents]).sort()).toEqual([['dinheiro', 7000], ['pix', 7000]]);
    expect((await db.orders.toArray())[0].payByLine).toBe(true);
    // de novo: desliga e religa → volta a uma linha com 2 peças
    await add();
    click(await screen.findByRole('button', { name: /Fechar venda/ }));
    click(await screen.findByRole('switch', { name: /Pagou tudo numa forma só/ }));
    await waitFor(() => expect(screen.getAllByPlaceholderText('Preço').length).toBe(2));
    click(screen.getByRole('switch', { name: /Pagou tudo numa forma só/ }));
    await waitFor(() => expect(screen.getAllByPlaceholderText('Preço').length).toBe(1));
  }, 30000);
});

describe('Diária automática (pela tela)', () => {
  it('ao iniciar o dia entra "Pagamento da diária de hoje: 150"; desfazer o início continua funcionando', async () => {
    await db.settings.where('key').equals('autoDailyPay').delete(); // ligada (padrão)
    await openAndStart();
    const day = (await db.dailyRecords.toArray())[0];
    const [, mm, dd] = day.date.split('-');
    const pays = (await db.cashMovements.toArray()).filter((m) => m.type === 'pagamento');
    expect(pays.map((m) => [m.amountInCents, m.description, m.auto])).toEqual([[15000, `diária de ${dd}/${mm}`, true]]);
    click(nav('Caixa'));
    expect((await screen.findAllByText(`Pagamento da diária de ${dd}/${mm}`)).length).toBeGreaterThan(0);
    // o dia ainda conta como "sem lançamento": dá para desfazer o início, e a diária sai junto
    click(nav('Início'));
    click(await screen.findByRole('button', { name: /^Desfazer$/ }));
    await confirmDialog(/Desfazer e escolher de novo/);
    await waitFor(async () => expect(await db.dailyRecords.count()).toBe(0));
    expect(await db.cashMovements.count()).toBe(0);
    // iniciar de novo: a diária volta uma vez só
    click(await screen.findByRole('button', { name: /Iniciar o dia/ }));
    await screen.findByRole('button', { name: /Nova venda/ });
    await waitFor(async () => expect((await db.cashMovements.toArray()).filter((m) => m.type === 'pagamento').length).toBe(1));
  }, 30000);
});

describe('Aba Caixa', () => {
  it('lança, bloqueia vazio, avisa retirada maior, remove, corrige, cancela, confere, ontem manual', async () => {
    await openAndStart();
    await sell('Branco', '70');
    click(nav('Caixa'));
    // vazio não lança
    click(await screen.findByRole('button', { name: /Dei dinheiro/ }));
    expect((screen.getByRole('button', { name: /^Lançar/ }) as HTMLButtonElement).disabled).toBe(true);
    const amount = () => screen.getAllByPlaceholderText('0').slice(-1)[0];
    type(amount(), '-5');
    expect((screen.getByRole('button', { name: /^Lançar/ }) as HTMLButtonElement).disabled).toBe(true);
    type(amount(), '20');
    type(screen.getByPlaceholderText('Ex.: Chico'), 'Chico');
    click(screen.getByRole('button', { name: /^Lançar 20/ }));
    await screen.findByText(/Dei a Chico/);
    // retirada maior que o dinheiro em mãos → pergunta
    click(screen.getByRole('button', { name: /Retirada/ }));
    await screen.findByText(/Tirado do acumulado/);
    type(amount(), '1.000');
    click(screen.getByRole('button', { name: /^Lançar 1\.000/ }));
    await screen.findByText('Mais do que tem em dinheiro?');
    click(lastBtn(/^Voltar$/));
    click(screen.getAllByRole('button', { name: 'Fechar' }).slice(-1)[0]);
    // remover o "dei"
    click((await screen.findAllByRole('button', { name: 'Remover' }))[0]);
    await confirmDialog(/^Remover$/);
    await waitFor(async () => expect((await db.cashMovements.toArray()).filter((m) => m.type === 'dar').length).toBe(0));
    // corrigir valor da venda
    click(screen.getByRole('button', { name: /Corrigir valor/ }));
    const inputs = await screen.findAllByPlaceholderText('sem preço');
    type(inputs[0], '90');
    click(screen.getByRole('button', { name: /Salvar · total 90/ }));
    await waitFor(async () => expect((await db.orders.toArray())[0].totalInCents).toBe(9000));
    // conferir dinheiro
    click(screen.getByRole('button', { name: /Conferir dinheiro/ }));
    type(await screen.findByPlaceholderText('Quanto tem em dinheiro?'), '90');
    click(screen.getAllByRole('button', { name: 'Salvar' }).slice(-1)[0]);
    await screen.findByText(/Contado e bateu/);
    // Normal x Caderno
    click(screen.getByRole('button', { name: /Caderno/ }));
    click(screen.getByRole('button', { name: /Normal/ }));
    // ontem à mão e volta ao automático
    click(screen.getAllByRole('button', { name: /corrigir/ })[0]);
    await screen.findByText(/Ontem \(total\)/);
    type(screen.getAllByRole('textbox').filter((i) => (i as HTMLInputElement).inputMode === 'decimal').slice(-2)[0], '645');
    click(screen.getAllByRole('button', { name: 'Salvar' }).slice(-1)[0]);
    await waitFor(async () => expect((await db.cashRecords.toArray())[0].openingManual).toBe(true));
    click(screen.getAllByRole('button', { name: /corrigir/ })[0]);
    click(await screen.findByRole('button', { name: /Voltar a calcular do dia anterior/ }));
    await waitFor(async () => expect((await db.cashRecords.toArray())[0].openingManual).toBe(false));
    // cancelar a venda
    click(screen.getAllByRole('button', { name: /Cancelar venda/ })[0]);
    await confirmDialog(/Cancelar venda/);
    await waitFor(async () => expect((await db.orders.toArray())[0].status).toBe('cancelled'));
  }, 40000);
});

describe('Menu e janelas', () => {
  it('cada item abre; cadastro recusa vazio/duplicado; verificar dados; sobre; arquivo errado na transferência', async () => {
    await openAndStart();
    const menu = () => click(screen.getByRole('button', { name: 'Abrir menu' }));
    // produtos
    menu(); click(await screen.findByRole('button', { name: /Produtos e grupos/ }));
    click(await screen.findByRole('button', { name: /＋ Grupo/ }));
    expect((screen.getAllByRole('button', { name: /^Salvar/ }).slice(-1)[0] as HTMLButtonElement).disabled).toBe(true);
    type(screen.getByPlaceholderText('Ex.: Novidades'), 'plomo');
    click(screen.getAllByRole('button', { name: /^Salvar grupo/ }).slice(-1)[0]);
    await toastText(/Já existe um grupo/);
    type(screen.getByPlaceholderText('Ex.: Novidades'), 'Novidades');
    click(screen.getAllByRole('button', { name: /^Salvar grupo/ }).slice(-1)[0]);
    await waitFor(async () => expect(await db.groups.count()).toBe(9));
    act(() => history.back()); // botão voltar do celular fecha a janela de cima
    await waitFor(() => expect(screen.queryByText(/Mais ações/)).toBeNull());
    const closeAll = async () => { for (let i = 0; i < 6 && screen.queryAllByRole('button', { name: 'Fechar' }).length; i++) { click(screen.getAllByRole('button', { name: 'Fechar' }).slice(-1)[0]); await new Promise((r) => setTimeout(r, 30)); } };
    await closeAll();
    // configurações: verificar dados
    menu(); click(await screen.findByRole('button', { name: /Configurações/ }));
    click(await screen.findByRole('button', { name: /Verificar agora/ }, { timeout: 5000 }));
    await screen.findByText(/Tudo certo com os dados/, {}, { timeout: 5000 });
    await closeAll();
    // sobre
    menu(); click(await screen.findByRole('button', { name: /Sobre/ }));
    await screen.findByText('Feito com amor');
    await closeAll();
    // transferência: arquivo errado é recusado com mensagem
    menu(); click(await screen.findByRole('button', { name: /Passar para outro celular/ }));
    await screen.findByRole('button', { name: /Enviar tudo/ });
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    const bad = new File(['isso não é backup'], 'foto.txt', { type: 'text/plain' });
    Object.defineProperty(input, 'files', { value: [bad], configurable: true });
    fireEvent.change(input);
    await toastText(/Texto não reconhecido|não é do app/);
    expect(await db.dailyRecords.count()).toBe(1);
    await closeAll();
    // backup em texto
    menu(); click(await screen.findByRole('button', { name: /^💾Backup|Backup/ }));
    click(await screen.findByRole('button', { name: /💬 Texto/ }));
    await screen.findByText(/Backup em texto · 1 parte/, {}, { timeout: 5000 });
  }, 40000);
});

describe('Histórico', () => {
  it('troca de mês, abre um dia e compara', async () => {
    await openAndStart();
    click(screen.getByRole('button', { name: 'Abrir menu' }));
    click(await screen.findByRole('button', { name: /Dias anteriores e comparar/ })); // “Histórico” (há também “Histórico de movimentações”)
    await screen.findByText(/Dias registrados em/);
    click(screen.getByRole('button', { name: 'Mês anterior' }));
    await screen.findByText(/Nenhum dia neste mês/);
    click(screen.getByRole('button', { name: 'Próximo mês' }));
    click(await screen.findByRole('button', { name: /Comparar dois dias/ }));
    await screen.findByText(/Precisa de pelo menos 2 dias/);
  }, 30000);
});
