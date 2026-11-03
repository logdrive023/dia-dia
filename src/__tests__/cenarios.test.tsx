// @vitest-environment jsdom
/**
 * Cenários obrigatórios da evolução de 03/11 (estoque × vendas, histórico, importação, cadastro):
 *  1 divergência · 2 venda · 3 reposição · 4 ajuste · 5 reserva · 6 importação · 7 produto criado em Vender
 *  8 dia fechado · 9 reversões — e os bugs achados nos dados reais (cadastro em outro dia, excluir apagava histórico).
 * Dados reais (opcional): DADOS_REAIS=arquivo.json  (e DADOS_REAIS_B=arquivo das 03:11, com a Celeste antiga)
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../App';
import { AppDB, db, useDatabase } from '../db/db';
import { seedIfNeeded } from '../db/seed';
import { addDays, todayStr, uid } from '../lib/util';
import { setActor } from '../lib/actor';
import { closeDay, moveStock, setStock, startDay, undoMovement } from '../services/days';
import { createGroup, createVariant, deleteVariant } from '../services/catalog';
import { cancelReservation, createOrder, createReservation } from '../services/sales';
import { daySummary, loadStockRows } from '../services/summary';
import { historyEvents, productTimeline } from '../services/history';
import { applyImport, buildImportPlan, parseImportText, resolveChoice, undoImport, undoImportPreview } from '../services/importer';
import { buildBackup, checksum, restoreBackup, validateBackup } from '../services/backup';
import { runDiagnostics } from '../services/diagnostics';

beforeAll(() => {
  window.scrollTo = vi.fn() as never;
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} }) as never;
  window.open = vi.fn() as never;
  Element.prototype.scrollIntoView = vi.fn();
});
beforeEach(async () => {
  useDatabase(new AppDB(`cen-${Math.random()}`));
  await seedIfNeeded();
  await db.settings.where('key').equals('initialOpening').delete();
  await db.settings.add({ id: `t-${Math.random()}`, key: 'autoDailyPay', value: false });
  setActor(null);
});
afterEach(async () => { cleanup(); setActor(null); await new Promise((r) => setTimeout(r, 120)); db.close(); });

const erros = async () => (await runDiagnostics()).findings.filter((f) => f.level === 'erro');
async function product(qty: number, name = 'Azul Celeste') {
  const d = await startDay(todayStr());
  const g = await createGroup({ name: 'Cenário' });
  const v = await createVariant({ groupId: g.id, name, startQuantity: qty, intoToday: true });
  return { d, g, v };
}
const stock = async (dayId: string, variantId: string) => (await db.dailyStockItems.where('[dailyRecordId+variantId]').equals([dayId, variantId]).first())?.currentQuantity;
const sell = (dayId: string, variantId: string, quantity: number) =>
  createOrder({ orderId: uid(), dailyRecordId: dayId, paymentMethod: 'pix', lines: [{ variantId, quantity, unitPriceInCents: 7000 }] });

describe('1) divergência: o histórico explica ou aponta (nunca inventa)', () => {
  it('7 no início, ajuste −3 → a linha do tempo mostra 7 → ajuste −3 → 4, sem divergência', async () => {
    const { d, v } = await product(7);
    await setStock(d.id, v.id, 4);
    const t = await productTimeline(v.id);
    expect(t.days).toHaveLength(1);
    expect(t.days[0]).toMatchObject({ start: 7, end: 4, gap: 0, carryGap: 0 });
    expect(t.days[0].events.map((e) => e.kind)).toEqual(['inicial', 'ajuste']);
    expect(t.days[0].events[1]).toMatchObject({ before: 7, delta: -3, after: 4 });
  });
  it('quantidade mudada sem registro (dado estragado): aparece “Divergência não explicada: −3” e nenhum ajuste é criado', async () => {
    const { d, v } = await product(7);
    const it = (await db.dailyStockItems.where('[dailyRecordId+variantId]').equals([d.id, v.id]).first())!;
    await db.dailyStockItems.update(it.id, { currentQuantity: 4 }); // simula o problema relatado
    const moves = await db.stockMovements.count();
    const t = await productTimeline(v.id);
    const div = t.days[0].events.find((e) => e.kind === 'divergencia')!;
    expect(div.text).toMatch(/Divergência não explicada/);
    expect(div.text).toMatch(/−3/);
    expect(await db.stockMovements.count()).toBe(moves); // nada inventado
  });
  it('o dia começou diferente do que terminou ontem: divergência entre os dias', async () => {
    const d1 = await startDay(addDays(todayStr(), -1));
    const g = await createGroup({ name: 'Cenário' });
    const v = await createVariant({ groupId: g.id, name: 'X', startQuantity: 5, dailyRecordId: d1.id });
    await closeDay(d1.id);
    const d2 = await startDay(todayStr());
    const it2 = (await db.dailyStockItems.where('[dailyRecordId+variantId]').equals([d2.id, v.id]).first())!;
    await db.dailyStockItems.update(it2.id, { initialQuantity: 3, currentQuantity: 3 });
    const t = await productTimeline(v.id);
    expect(t.days[1].carryGap).toBe(-2);
    expect(t.days[1].events.some((e) => e.kind === 'divergencia' && /dia anterior terminou com 5/.test(e.text))).toBe(true);
  });
});

describe('2) venda · 3) reposição · 4) ajuste manual', () => {
  it('10 → venda de 2 → 8, com referência à venda; origem: sistema', async () => {
    const { d, v } = await product(10);
    const o = await sell(d.id, v.id, 2);
    expect(await stock(d.id, v.id)).toBe(8);
    const ev = (await productTimeline(v.id)).days[0].events.find((e) => e.kind === 'venda')!;
    expect(ev).toMatchObject({ before: 10, delta: -2, after: 8, origin: 'sistema' });
    expect(ev.ref).toEqual({ type: 'venda', id: (o as { id?: string }).id ?? ev.ref!.id });
    expect(await db.orders.get(ev.ref!.id)).toBeTruthy();
    expect(await db.stockMovements.where('orderId').equals(ev.ref!.id).filter((m) => m.type === 'venda').count()).toBe(1); // uma saída só
  });
  it('8 → entrada de 5 (reposição) → 13; aparece como reposição e em “Entrou”, com quem fez', async () => {
    setActor('Ana');
    const { d, v } = await product(8);
    await moveStock(d.id, v.id, 5, 'entrada', undefined, { entryKind: 'reposicao' });
    expect(await stock(d.id, v.id)).toBe(13);
    const ev = (await productTimeline(v.id)).days[0].events.find((e) => e.kind === 'reposicao')!;
    expect(ev).toMatchObject({ before: 8, delta: 5, after: 13, origin: 'usuaria', by: 'Ana' });
    expect((await daySummary(d.id, d.date)).enteredUnits).toBe(5);
  });
  it('10 → ajuste para 7 → “ajuste manual −3”, NÃO é venda', async () => {
    const { d, v } = await product(10);
    await setStock(d.id, v.id, 7);
    const s = await daySummary(d.id, d.date);
    expect(s.soldUnits).toBe(0);
    expect(s.soldByVariant).toHaveLength(0);
    const ev = (await productTimeline(v.id)).days[0].events.find((e) => e.kind === 'ajuste')!;
    expect(ev).toMatchObject({ delta: -3, before: 10, after: 7 });
    expect(ev.text).toMatch(/Ajuste manual −3/);
  });
  it('“Definir” para mais com “chegou mercadoria”: vira ENTRADA (o caso dos +113 ajustes)', async () => {
    const { d, v } = await product(3);
    await setStock(d.id, v.id, 9, 'Ajuste manual', { entryKind: 'nova' });
    const m = (await db.stockMovements.where('variantId').equals(v.id).toArray())[0];
    expect(m).toMatchObject({ type: 'entrada', entryKind: 'nova', quantity: 6 });
    expect((await daySummary(d.id, d.date)).enteredUnits).toBe(6);
    // sem o motivo, continua ajuste (correção da contagem)
    await setStock(d.id, v.id, 10);
    expect((await db.stockMovements.where('variantId').equals(v.id).toArray()).some((x) => x.type === 'ajuste' && x.quantity === 1)).toBe(true);
  });
});

describe('5) reserva', () => {
  it('físico 5, reserva 2 → disponível 3; cancelar → disponível 5; físico nunca muda', async () => {
    const { d, v } = await product(5);
    const r = await createReservation({ dailyRecordId: d.id, variantId: v.id, quantity: 2, customer: 'Kelly' });
    let row = (await loadStockRows(d.id, d.date)).find((x) => x.variant.id === v.id)!;
    expect([row.item.currentQuantity, row.reserved, row.available, row.out]).toEqual([5, 2, 3, false]);
    expect((await productTimeline(v.id)).days[0].events.find((e) => e.kind === 'reserva')).toMatchObject({ delta: 0, origin: 'sistema' });
    await cancelReservation((r as { id: string }).id, d.id);
    row = (await loadStockRows(d.id, d.date)).find((x) => x.variant.id === v.id)!;
    expect([row.item.currentQuantity, row.reserved, row.available]).toEqual([5, 0, 5]);
  });
  it('tudo reservado: o Vender diz “reservadas” (não “sem peça”)', async () => {
    const { d, v } = await product(2, 'Vino');
    await createReservation({ dailyRecordId: d.id, variantId: v.id, quantity: 2 });
    render(<App />);
    fireEvent.click(within(await screen.findByRole('navigation', {}, { timeout: 5000 })).getByRole('button', { name: /Vender/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Todos os grupos/ }));
    const name = await screen.findByRole('button', { name: 'Histórico de Vino' });
    const row = name.closest('div.flex')!.parentElement!;
    expect(row.textContent).toMatch(/todas as 2 reservadas/);
    expect(row.textContent).not.toMatch(/sem peça/);
  });
});

describe('6) importação', () => {
  const sizes = ['P', 'M', 'G', 'GG', 'XG'];
  it('lê os formatos: bloco, com tamanho, numa linha só; modelo sem números fica de fora', () => {
    const p = parseImportText('Plomo\nAzul: 6\nVerde · P: 2\nRosa (M): 1\nBranco G: 3\nCafé:\n\nLila > Rosa > 4\nNovo > Blusa > GG > 2\n• Cor Negro: 5 ⚠️ repor 1', sizes);
    expect(p.map((l) => [l.group, l.name, l.size, l.qty])).toEqual([
      ['Plomo', 'Azul', null, 6], ['Plomo', 'Verde', 'P', 2], ['Plomo', 'Rosa', 'M', 1], ['Plomo', 'Branco', 'G', 3], ['Plomo', 'Café', null, null],
      ['Lila', 'Rosa', null, 4], ['Novo', 'Blusa', 'GG', 2], ['Plomo', 'Negro', null, 5],
    ]);
    expect(parseImportText('Azul: 3', sizes)[0].error).toMatch(/Falta o grupo/);
  });
  it('prévia → confirma → estoque, venda e histórico certos → vende depois → desfazer respeita a venda', async () => {
    setActor('Ana');
    const d = await startDay(todayStr());
    const plomo = (await db.groups.toArray()).find((g) => g.name === 'Plomo')!;
    const azul = (await db.variants.toArray()).find((v) => v.groupId === plomo.id && !v.archivedAt && v.forSale !== false)!;
    const before = (await stock(d.id, azul.id))!;
    const text = `Plomo\n${azul.name}: 10\nTerracota · P: 3\n\nRoupas > Vestido > M > 4\nRoupas > Vestido > G > 0`;
    const opts = { op: 'somar' as const, newForSale: true, sizes };
    const plan = await buildImportPlan(text, opts);
    const st = (n: string, size: string | null = null) => plan.lines.find((l) => l.name === n && l.size === size)!;
    expect(st(azul.name)).toMatchObject({ status: 'existe', before, delta: 10, after: before + 10 });
    expect(st('Terracota', 'P')).toMatchObject({ status: 'nova', after: 3 });
    expect(st('Vestido', 'M')).toMatchObject({ status: 'nova', newGroup: true, after: 4 });
    expect(await db.stockMovements.count()).toBe(0); // prévia não aplica nada
    const rec = await applyImport(text, plan.lines, { ...opts, entryKind: 'reposicao' });
    expect(rec.text).toBe(text); // texto original guardado
    expect(rec.by).toBe('Ana');
    expect(await stock(d.id, azul.id)).toBe(before + 10);
    const terra = (await db.variants.toArray()).find((v) => v.name === 'Terracota' && v.size === 'P')!;
    expect(terra).toMatchObject({ origin: 'importacao', forSale: true, createdBy: 'Ana' });
    expect(await stock(d.id, terra.id)).toBe(3);
    const vest = (await db.variants.toArray()).filter((v) => v.name === 'Vestido');
    expect(vest.map((v) => v.size).sort()).toEqual(['G', 'M']); // G com 0 também é criado (cadastro), sem entrada
    expect((await productTimeline(azul.id)).days[0].events.some((e) => e.kind === 'importacao' && e.ref?.id === rec.id)).toBe(true);
    // aparece no Vender (à venda) e no estoque
    expect((await loadStockRows(d.id, d.date)).find((r) => r.variant.id === terra.id)!.available).toBe(3);
    // vende 12 do Azul depois da importação
    await sell(d.id, azul.id, before + 10 - 2 > 0 ? Math.min(before + 10, 12) : 1);
    const after = (await stock(d.id, azul.id))!;
    const prev = await undoImportPreview(rec.id);
    const azulLine = prev.lines.find((l) => l.variantId === azul.id)!;
    if (after - 10 < 0) expect(azulLine).toMatchObject({ ok: false, reason: expect.stringMatching(/saíram peças/) });
    const res = await undoImport(rec.id);
    expect(res.done).toBeGreaterThan(0);
    expect(await stock(d.id, terra.id)).toBe(0); // desfeito
    expect(await db.orders.count()).toBe(1); // a venda continua
    expect(await stock(d.id, azul.id)).toBe(after - 10 < 0 ? after : after - 10);
    const saved = (await db.imports.get(rec.id))!;
    expect(saved.status).toBe(after - 10 < 0 ? 'parcial' : 'desfeita');
    expect(saved.lines).toHaveLength(rec.lines.length); // registro original preservado
    // desfeita: não desfaz de novo; em parte: tentar de novo só refaz o que ficou (nada muda se ainda não dá)
    if (after - 10 < 0) expect((await undoImport(rec.id)).done).toBe(0);
    else await expect(undoImport(rec.id)).rejects.toThrow(/já foi desfeita/);
    expect(await db.orders.count()).toBe(1);
    expect(await erros()).toEqual([]);
  });
  it('parecido com um que já existe: pede para escolher antes de confirmar; nunca duplica', async () => {
    await startDay(todayStr());
    const g = await createGroup({ name: 'Sim' });
    const v = await createVariant({ groupId: g.id, name: 'Branco', startQuantity: 2, intoToday: true });
    const opts = { op: 'somar' as const, newForSale: true, sizes };
    const plan = await buildImportPlan('Sim\nBranca: 3', opts);
    expect(plan.lines[0].status).toBe('parecida');
    await expect(applyImport('Sim\nBranca: 3', plan.lines, { ...opts, entryKind: 'reposicao' })).rejects.toThrow(/Escolha/);
    const chosen = await resolveChoice(plan.lines[0], v.id, opts);
    await applyImport('Sim\nBranca: 3', [chosen], { ...opts, entryKind: 'reposicao' });
    expect((await db.variants.where('groupId').equals(g.id).toArray()).length).toBe(1);
    expect((await loadStockRows((await db.dailyRecords.toArray())[0].id, todayStr())).find((r) => r.variant.id === v.id)!.item.currentQuantity).toBe(5);
  });
});

describe('7) produto criado em Vender', () => {
  it('pela tela: entra no cadastro (origem Vender), no estoque de hoje e já à venda; aparece no histórico', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /Iniciar o dia/ }, { timeout: 5000 }));
    await screen.findByRole('button', { name: /Nova venda/ });
    fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: /Vender/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Novo produto/ }));
    fireEvent.change(await screen.findByLabelText('Nome do produto'), { target: { value: 'Turquesa nova' } });
    fireEvent.change(screen.getByLabelText('Quantidade'), { target: { value: '3' } });
    fireEvent.click(await screen.findByRole('button', { name: /Salvar Turquesa nova/ }));
    await waitFor(async () => expect((await db.variants.toArray()).some((v) => v.name === 'Turquesa nova')).toBe(true));
    const v = (await db.variants.toArray()).find((x) => x.name === 'Turquesa nova')!;
    expect(v).toMatchObject({ origin: 'vender', forSale: true });
    const d = (await db.dailyRecords.where('date').equals(todayStr()).first())!;
    expect(await db.dailyStockItems.where('[dailyRecordId+variantId]').equals([d.id, v.id]).first()).toMatchObject({ initialQuantity: 3, currentQuantity: 3 });
    expect((await productTimeline(v.id)).days[0].events[0].text).toMatch(/Estoque inicial: 3 \(cadastro pela tela Vender\)/);
  });
});

describe('8) dia fechado nunca muda', () => {
  it('não aceita mudança; desfazer um movimento dele entra no dia de HOJE, ligado ao original', async () => {
    const d1 = await startDay(addDays(todayStr(), -1));
    const g = await createGroup({ name: 'Ontem' });
    const v = await createVariant({ groupId: g.id, name: 'X', startQuantity: 4, dailyRecordId: d1.id });
    const m = await moveStock(d1.id, v.id, 6, 'entrada', undefined, { entryKind: 'reposicao' });
    await closeDay(d1.id);
    const snap = JSON.stringify(await db.dailyStockItems.where('dailyRecordId').equals(d1.id).toArray());
    const movesD1 = await db.stockMovements.where('dailyRecordId').equals(d1.id).count();
    await expect(moveStock(d1.id, v.id, 1, 'entrada')).rejects.toThrow(/encerrado/);
    await expect(sell(d1.id, v.id, 1)).rejects.toThrow(/encerrado/);
    const d2 = await startDay(todayStr());
    const u = await undoMovement(m.id);
    expect(u).toMatchObject({ dailyRecordId: d2.id, reversedMovementId: m.id, quantity: -6 });
    expect(JSON.stringify(await db.dailyStockItems.where('dailyRecordId').equals(d1.id).toArray())).toBe(snap); // ontem igual
    expect(await db.stockMovements.where('dailyRecordId').equals(d1.id).count()).toBe(movesD1);
    expect(await stock(d2.id, v.id)).toBe(4);
    expect(await erros()).toEqual([]);
  });
});

describe('9) reversões', () => {
  it('desfazer cria registro novo ligado ao original; original fica; não desfaz duas vezes; venda não se desfaz por aqui', async () => {
    const { d, v } = await product(10);
    const a = (await setStock(d.id, v.id, 7))!;
    await sell(d.id, v.id, 1);
    const u = await undoMovement(a.id);
    expect(u).toMatchObject({ type: 'correcao', quantity: 3, reversedMovementId: a.id });
    expect(await db.stockMovements.get(a.id)).toBeTruthy();
    expect(await stock(d.id, v.id)).toBe(9); // 10 −3 −1 +3: a venda continua
    await expect(undoMovement(a.id)).rejects.toThrow(/já foi desfeita/);
    const venda = (await db.stockMovements.where('variantId').equals(v.id).toArray()).find((m) => m.type === 'venda')!;
    await expect(undoMovement(venda.id)).rejects.toThrow(/Cancele a venda/);
    const evs = (await productTimeline(v.id)).days[0].events;
    expect(evs.find((e) => e.movementId === a.id)).toMatchObject({ undone: true, undoable: false });
    expect(evs.find((e) => e.kind === 'desfazer')?.ref).toEqual({ type: 'movimento', id: a.id });
  });
});

describe('bugs achados nos dados reais', () => {
  it('cadastro com quantidade olhando outro dia: entra HOJE (antes sumia); sem o dia de hoje: avisa', async () => {
    const d1 = await startDay(addDays(todayStr(), -1));
    await closeDay(d1.id);
    const g = await createGroup({ name: 'Bug' });
    await expect(createVariant({ groupId: g.id, name: 'Terracota', startQuantity: 1, intoToday: true })).rejects.toThrow(/inicie o dia de hoje/i);
    const d2 = await startDay(todayStr());
    const v = await createVariant({ groupId: g.id, name: 'Terracota', startQuantity: 1, intoToday: true });
    expect(await db.dailyStockItems.where('[dailyRecordId+variantId]').equals([d2.id, v.id]).first()).toMatchObject({ initialQuantity: 1, currentQuantity: 1 });
  });
  it('excluir não apaga o histórico (movimentos ficam e aparecem no Histórico de movimentações)', async () => {
    const { d, v } = await product(3);
    await moveStock(d.id, v.id, 2, 'entrada', undefined, { entryKind: 'nova' });
    await deleteVariant(v.id);
    expect(await db.stockMovements.where('variantId').equals(v.id).count()).toBe(1);
    expect((await historyEvents({ variantId: v.id })).events.some((e) => e.kind === 'nova')).toBe(true);
  });
  it('mesmo nome com tamanhos diferentes são produtos diferentes; mesmo nome e tamanho é recusado', async () => {
    await startDay(todayStr());
    const g = await createGroup({ name: 'Camiseta' });
    await createVariant({ groupId: g.id, name: 'Azul', size: 'P', startQuantity: 5, intoToday: true });
    await createVariant({ groupId: g.id, name: 'Azul', size: 'M', startQuantity: 10, intoToday: true });
    await expect(createVariant({ groupId: g.id, name: 'Azul', size: 'p', startQuantity: 1, intoToday: true })).rejects.toThrow(/Já existe "Azul · P"/);
  });
});

describe('compatibilidade dos dados', () => {
  it('backup antigo (sem a tabela de importações) abre; o novo leva as importações', async () => {
    const b = await buildBackup();
    const old = JSON.parse(JSON.stringify(b));
    delete old.data.imports; delete old.counts.imports; old.checksum = checksum(JSON.stringify(old.data));
    expect(() => validateBackup(old)).not.toThrow();
    expect(old.data.imports).toBeUndefined(); // conferir não muda o backup recebido
    // como nas telas Backup/Passar: confere e depois restaura o que voltou da conferência
    await restoreBackup(validateBackup(old), { keepSafety: false });
    expect(await db.imports.count()).toBe(0);
    expect(b.data.imports).toEqual([]);
  });
});

// ---- dados reais do celular (opcional) ----
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
describe.skipIf(!env.DADOS_REAIS)('dados reais de 03/11', () => {
  it('nenhuma divergência em nenhuma peça; abre no app novo sem perder nada', async () => {
    // @ts-expect-error módulo do Node sem tipos (só neste teste)
    const { readFileSync } = await import('node:fs');
    const raw = JSON.parse(readFileSync(env.DADOS_REAIS!, 'utf8'));
    await restoreBackup(raw, { keepSafety: false });
    for (const t of ['variants', 'stockMovements', 'orders', 'sales', 'reservations', 'dailyStockItems'] as const)
      expect(await db.table(t).count(), t).toBe(raw.data[t].length);
    let divs = 0;
    for (const v of await db.variants.toArray()) for (const dl of (await productTimeline(v.id)).days) if (dl.gap || dl.carryGap) divs++;
    expect(divs).toBe(0);
    expect(await erros()).toEqual([]);
  });
});
describe.skipIf(!env.DADOS_REAIS_B)('dados reais das 03:11: a “Celeste 7”', () => {
  it('a linha do tempo explica: começou 3, o 7 é o estoque ideal (não é estoque), arquivada', async () => {
    // @ts-expect-error módulo do Node sem tipos (só neste teste)
    const { readFileSync } = await import('node:fs');
    await restoreBackup(JSON.parse(readFileSync(env.DADOS_REAIS_B!, 'utf8')), { keepSafety: false });
    const plomo = (await db.groups.toArray()).find((g) => g.name === 'Plomo')!;
    const old = (await db.variants.toArray()).find((v) => v.groupId === plomo.id && v.name === 'Celeste' && v.archivedAt && v.idealStock === 7)!;
    const t = await productTimeline(old.id);
    const all = t.days.flatMap((d) => d.events);
    expect(t.days[0].start).toBe(3);
    expect(all.some((e) => e.kind === 'cadastro' && /Estoque ideal \(meta\).*7.*não muda o estoque/.test(e.text))).toBe(true);
    expect(all.some((e) => e.kind === 'cadastro' && e.text === 'Arquivada')).toBe(true);
    // nenhuma saída de 4: sem venda nem ajuste; só um “+1 −1” de teste em 03/11 (que se anula)
    expect(all.filter((e) => e.kind === 'venda' || e.kind === 'ajuste')).toHaveLength(0);
    expect(all.filter((e) => e.delta !== undefined && e.kind !== 'inicial').reduce((n, e) => n + (e.delta ?? 0), 0)).toBe(0);
    expect(all.every((e) => Math.abs(e.delta ?? 0) < 4)).toBe(true);
    expect(t.days.every((d) => !d.gap && !d.carryGap)).toBe(true);
  });
});

describe('Vender › “Chegou mais” (entrada pela tela de vender)', () => {
  it('peça esgotada recebe +3 pelo Vender: estoque, à venda, “Entrou”, histórico e diagnóstico certos', async () => {
    const d = await startDay(todayStr());
    const g = await createGroup({ name: 'Cenário' });
    const v = await createVariant({ groupId: g.id, name: 'Verde Cenário', startQuantity: 2, intoToday: true, forSale: true });
    await sell(d.id, v.id, 2); // esgotou
    render(<App />);
    fireEvent.click(within(await screen.findByRole('navigation', {}, { timeout: 5000 })).getByRole('button', { name: /Vender/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Todos os grupos/ }));
    // esgotada: a informação fica apagada, mas o botão continua forte (nenhum pai com opacity)
    const chegou = await screen.findByRole('button', { name: 'Chegou mais de Verde Cenário' });
    for (let el: HTMLElement | null = chegou; el; el = el.parentElement) expect(el.className ?? '', 'pai apagando o botão').not.toMatch(/opacity-/);
    expect(chegou.className).toMatch(/bg-emerald-100/);
    expect(chegou.closest('div.flex')!.querySelector('[data-testid="info-peca"]')?.className ?? chegou.parentElement!.querySelector('[data-testid="info-peca"]')!.className).toMatch(/opacity-60/);
    fireEvent.click(chegou);
    fireEvent.change(await screen.findByLabelText('Quantas chegaram'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Reposição' }));
    expect(screen.getByText(/Estoque:/).textContent).toMatch(/0 → 3/);
    fireEvent.click(screen.getByRole('button', { name: /Pôr 3 peças no estoque/ }));
    await waitFor(async () => expect(await stock(d.id, v.id)).toBe(3));
    const m = (await db.stockMovements.where('variantId').equals(v.id).toArray()).find((x) => x.type === 'entrada')!;
    expect(m).toMatchObject({ quantity: 3, entryKind: 'reposicao', description: 'Pela tela Vender' });
    const s = await daySummary(d.id, d.date);
    expect(s.enteredUnits).toBe(3);
    expect(s.soldUnits).toBe(2); // a venda de antes continua igual
    expect((await loadStockRows(d.id, d.date)).find((r) => r.variant.id === v.id)!.available).toBe(3);
    // dá para vender de novo na hora
    await screen.findByRole('button', { name: 'Vender Verde Cenário' });
    expect((await productTimeline(v.id)).days[0].events.map((e) => e.kind)).toEqual(['inicial', 'venda', 'reposicao']);
    expect(await erros()).toEqual([]);
  });
});

describe('histórico da peça: do mais novo para o mais antigo', () => {
  it('hoje em cima; dentro do dia: agora → último registro → … → começou', async () => {
    const d1 = await startDay(addDays(todayStr(), -1));
    const g = await createGroup({ name: 'Ordem' });
    const v = await createVariant({ groupId: g.id, name: 'Lilás', startQuantity: 8, dailyRecordId: d1.id });
    await closeDay(d1.id);
    const d2 = await startDay(todayStr());
    await moveStock(d2.id, v.id, 28, 'entrada', undefined, { entryKind: 'reposicao' });
    await new Promise((r) => setTimeout(r, 5));
    await moveStock(d2.id, v.id, 4, 'entrada', undefined, { entryKind: 'nova' });
    render(<App />);
    await screen.findByRole('navigation', {}, { timeout: 5000 });
    const { openHistoryForTest } = await import('./helpers-historico');
    await openHistoryForTest(v.id);
    const days = await screen.findAllByLabelText(/^Dia \d{2}\/\d{2}/);
    expect(days[0].getAttribute('aria-label')).toContain(todayStr().split('-').reverse().join('/').slice(0, 5));
    const lines = days[0].innerText ?? days[0].textContent ?? '';
    const order = ['Agora 40', 'mercadoria nova +4', 'reposição +28', 'Começou o dia com 8'].map((t) => lines.indexOf(t));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order); // nessa ordem
    expect((days[1].textContent ?? '').indexOf('Terminou o dia com 8')).toBeLessThan((days[1].textContent ?? '').indexOf('Estoque inicial: 8'));
  });
});

describe('versão do app', () => {
  it('cada atualização tem versão (única, da mais nova para a mais antiga) e o Sobre mostra a mais nova', async () => {
    const { APP_VERSION, CHANGELOG } = await import('../lib/changelog');
    const vs = CHANGELOG.map((e) => e.version);
    expect(new Set(vs).size).toBe(vs.length);
    const num = (v: string) => v.split('.').map(Number).reduce((a, b) => a * 1000 + b, 0);
    expect(vs.map(num)).toEqual([...vs.map(num)].sort((a, b) => b - a));
    expect(APP_VERSION).toBe(CHANGELOG[0].version);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /Abrir menu/ }, { timeout: 5000 }));
    fireEvent.click(await screen.findByRole('button', { name: /Sobre/ }));
    await screen.findByText(new RegExp(`versão ${APP_VERSION.replace('.', '\.')} · ${CHANGELOG[0].date}`));
  });
});
