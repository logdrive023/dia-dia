/**
 * Cadastro e relatório (bugs de 02/11):
 *  1) cor arquivada precisa de "Excluir"; depois de excluir, o relatório fica certo;
 *  2) mudar a meta (estoque ideal) 15 → 18 não é "entrou" nem muda o estoque — só o "repor";
 *     a quantidade do cadastro é o começo do dia, não "Entrou no estoque";
 *  3) cor arquivada não entra no relatório do WhatsApp (Entrou / Repor / Estoque).
 * Também roda com os dados reais do celular: DADOS_REAIS=caminho/do/arquivo.json npm test
 */
import { describe, expect, it, vi } from 'vitest';
import { AppDB, db, useDatabase } from '../db/db';
import { seedIfNeeded } from '../db/seed';
import { uid } from '../lib/util';
import { migrateCadastroEntries, moveStock, startDay } from '../services/days';
import { archiveVariant, createGroup, createVariant, deleteVariant, updateVariant } from '../services/catalog';
import { createOrder } from '../services/sales';
import { daySummary, loadStockRows } from '../services/summary';
import { openWhatsApp, whatsappReport, WHATSAPP_URL_MAX } from '../services/report';
import { runDiagnostics } from '../services/diagnostics';
import { restoreBackup } from '../services/backup';

async function setup(name: string) {
  useDatabase(new AppDB(`${name}-${Math.random()}`));
  await seedIfNeeded();
  await db.settings.where('key').equals('initialOpening').delete();
  return startDay('2026-11-02');
}
const erros = async () => (await runDiagnostics()).findings.filter((f) => f.level === 'erro');
const entrouSection = (w: string) => { const i = w.indexOf('📦 *Entrou'); return i < 0 ? '' : w.slice(i, w.indexOf('\n\n', i) < 0 ? undefined : w.indexOf('\n\n', i)); };

describe('cadastro: quantidade inicial e meta do repor', () => {
  it('cor nova com 15 peças: começa o dia com 15, não aparece em "Entrou"', async () => {
    const d = await setup('cad1');
    const g = await createGroup({ name: 'Extra' });
    const v = await createVariant({ groupId: g.id, name: 'Rojo', startQuantity: 15, dailyRecordId: d.id });
    const it = (await db.dailyStockItems.where('[dailyRecordId+variantId]').equals([d.id, v.id]).first())!;
    expect([it.initialQuantity, it.currentQuantity]).toEqual([15, 15]);
    expect(await db.stockMovements.where('variantId').equals(v.id).count()).toBe(0);
    const s = await daySummary(d.id, d.date);
    expect(s.enteredUnits).toBe(0);
    expect(entrouSection(whatsappReport(d.date, s))).not.toContain('Rojo');
    expect(await erros()).toEqual([]);
  });
  it('meta 15 → 18: o estoque continua 15, nada "entrou", só repor 3', async () => {
    const d = await setup('cad2');
    const g = await createGroup({ name: 'Extra' });
    const v = await createVariant({ groupId: g.id, name: 'Rojo', startQuantity: 15, dailyRecordId: d.id });
    await updateVariant(v.id, { idealStock: 18 });
    const row = (await loadStockRows(d.id, d.date)).find((r) => r.variant.id === v.id)!;
    expect([row.item.currentQuantity, row.restock]).toEqual([15, 3]);
    const s = await daySummary(d.id, d.date);
    expect([s.enteredUnits, await db.stockMovements.where('variantId').equals(v.id).count()]).toEqual([0, 0]);
    expect(whatsappReport(d.date, s)).toContain('Cor Rojo: repor 3 (tem 15 de 18)'); // em "Precisa repor"
  });
  it('entrada de verdade (+) continua aparecendo em "Entrou"', async () => {
    const d = await setup('cad3');
    const v = (await db.variants.toArray()).find((x) => !x.archivedAt)!;
    await moveStock(d.id, v.id, 4, 'entrada');
    const s = await daySummary(d.id, d.date);
    expect(s.enteredUnits).toBe(4);
    expect(entrouSection(whatsappReport(d.date, s))).toContain(`${v.name}: +4`);
  });
});

describe('arquivadas e excluídas fora do relatório', () => {
  it('cor arquivada não entra em Entrou, Repor nem no total do estoque', async () => {
    const d = await setup('arq1');
    const g = await createGroup({ name: 'Extra' });
    const a = await createVariant({ groupId: g.id, name: 'Velha', startQuantity: 10, dailyRecordId: d.id });
    await updateVariant(a.id, { idealStock: 20 });
    await moveStock(d.id, a.id, 5, 'entrada');
    const before = await daySummary(d.id, d.date);
    await archiveVariant(a.id, true);
    const s = await daySummary(d.id, d.date);
    expect(s.enteredUnits).toBe(before.enteredUnits - 5);
    expect(s.totalUnits).toBe(before.totalUnits - 15);
    const w = whatsappReport(d.date, s);
    expect(w).not.toContain('Velha');
    expect(await erros()).toEqual([]);
  });
  it('excluir: nunca vendida → some de vez; vendida → some de tudo, venda antiga fica no histórico', async () => {
    const d = await setup('exc1');
    const g = await createGroup({ name: 'Extra' });
    const nunca = await createVariant({ groupId: g.id, name: 'Nunca', startQuantity: 3, dailyRecordId: d.id });
    const vendida = await createVariant({ groupId: g.id, name: 'Vendida', startQuantity: 3, dailyRecordId: d.id });
    await moveStock(d.id, nunca.id, 2, 'entrada');
    const o = await createOrder({ orderId: uid(), dailyRecordId: d.id, paymentMethod: 'pix', lines: [{ variantId: vendida.id, quantity: 1, unitPriceInCents: 7000 }] });
    await archiveVariant(nunca.id, true); await archiveVariant(vendida.id, true);
    expect(await deleteVariant(nunca.id)).toBe('apagada');
    expect(await db.variants.get(nunca.id)).toBeUndefined();
    expect(await db.stockMovements.where('variantId').equals(nunca.id).count()).toBe(0);
    expect(await deleteVariant(vendida.id)).toBe('escondida');
    expect((await db.variants.get(vendida.id))!.deletedAt).toBeTruthy();
    await expect(archiveVariant(vendida.id, false)).rejects.toThrow(/excluída/);
    // a venda continua: caixa e "o que saiu" certos
    expect((await db.orders.get(o.id))!.status).toBe('ok');
    const s = await daySummary(d.id, d.date);
    expect(s.cash.salesByMethod.pix).toBe(7000);
    const w = whatsappReport(d.date, s);
    expect(entrouSection(w)).not.toContain('Nunca');
    expect(w).not.toContain('Nunca');
    expect(await erros()).toEqual([]);
  });
});

describe('dados antigos: "entrou" do cadastro vira começo do dia', () => {
  it('converte uma vez; o estoque final não muda; rodar de novo não faz nada', async () => {
    const d = await setup('mig1');
    const v = (await db.variants.toArray())[0];
    const it = (await db.dailyStockItems.where('[dailyRecordId+variantId]').equals([d.id, v.id]).first())!;
    // como a versão antiga gravava: começou 0 + entrada "Quantidade inicial do cadastro"
    await db.dailyStockItems.update(it.id, { initialQuantity: 0, currentQuantity: it.currentQuantity + 9 });
    await db.stockMovements.add({ id: uid(), dailyRecordId: d.id, variantId: v.id, type: 'entrada', quantity: it.initialQuantity + 9,
      previousBalance: 0, newBalance: it.currentQuantity + 9, createdAt: new Date().toISOString(), description: 'Quantidade inicial do cadastro' });
    const finalBefore = (await db.dailyStockItems.get(it.id))!.currentQuantity;
    expect((await daySummary(d.id, d.date)).enteredUnits).toBe(0); // o relatório já ignora
    expect(await migrateCadastroEntries()).toBe(1);
    const after = (await db.dailyStockItems.get(it.id))!;
    expect([after.initialQuantity, after.currentQuantity]).toEqual([finalBefore, finalBefore]);
    expect(await migrateCadastroEntries()).toBe(0);
    expect(await erros()).toEqual([]);
  });
});

describe('WhatsApp com mensagem grande não trava', () => {
  it('curta: abre o WhatsApp; comprida: compartilhar do celular; sem compartilhar: copia', async () => {
    const open = vi.fn();
    vi.stubGlobal('window', { open });
    vi.stubGlobal('navigator', { share: vi.fn().mockResolvedValue(undefined), clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    expect(await openWhatsApp('oi')).toBe('whatsapp');
    expect(open).toHaveBeenCalledTimes(1);
    const big = 'linha de relatório com acento ção\n'.repeat(400);
    expect(`https://wa.me/?text=${encodeURIComponent(big)}`.length).toBeGreaterThan(WHATSAPP_URL_MAX);
    expect(await openWhatsApp(big)).toBe('shared');
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    expect(await openWhatsApp(big)).toBe('copied');
    expect(open).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});

// ---- com os dados reais do celular (opcional: só roda com DADOS_REAIS=arquivo.json) ----
const REAL = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.DADOS_REAIS;
describe.skipIf(!REAL)('dados reais do celular (02/11)', () => {
  it('relatório sem arquivadas, sem o "entrou" do cadastro; excluir as arquivadas deixa tudo certo', async () => {
    // @ts-expect-error módulo do Node sem tipos (só neste teste)
    const { readFileSync } = await import('node:fs');
    useDatabase(new AppDB(`real-${Math.random()}`));
    await restoreBackup(JSON.parse(readFileSync(REAL!, 'utf8')), { keepSafety: false });
    const day = (await db.dailyRecords.orderBy('date').last())!;
    const before = await daySummary(day.id, day.date);
    const archived = (await db.variants.toArray()).filter((v) => v.archivedAt);
    const archivedIds = new Set(archived.map((v) => v.id));
    // relatório: nenhuma arquivada em "Entrou", e "Entrou" só com entradas de verdade
    expect(before.enteredByVariant.some((x) => archivedIds.has(x.variant.id))).toBe(false);
    const realEntradas = (await db.stockMovements.where('dailyRecordId').equals(day.id).toArray())
      .filter((m) => m.type === 'entrada' && m.description !== 'Quantidade inicial do cadastro' && !archivedIds.has(m.variantId));
    expect(before.enteredUnits).toBe(realEntradas.reduce((n, m) => n + m.quantity, 0));
    // total do estoque = só cores ativas
    const rows = await loadStockRows(day.id, day.date);
    expect(before.totalUnits).toBe(rows.filter((r) => !r.variant.archivedAt && !r.group.archivedAt).reduce((n, r) => n + r.item.currentQuantity, 0));
    const finalStock = rows.map((r) => [r.variant.id, r.item.currentQuantity]);
    // conserta os dados antigos: estoque final igual, diagnóstico sem erro
    const fixed = await migrateCadastroEntries();
    console.log(`dados reais: ${archived.length} arquivadas · ${fixed} cadastros convertidos · entrou de verdade ${before.enteredUnits} · estoque ativo ${before.totalUnits}`);
    const rows2 = await loadStockRows(day.id, day.date);
    expect(rows2.map((r) => [r.variant.id, r.item.currentQuantity])).toEqual(finalStock);
    expect(await erros()).toEqual([]);
    // excluir todas as arquivadas
    let apagadas = 0, escondidas = 0;
    for (const v of archived) (await deleteVariant(v.id)) === 'apagada' ? apagadas++ : escondidas++;
    const after = await daySummary(day.id, day.date);
    const w = whatsappReport(day.date, after);
    for (const v of archived) expect(entrouSection(w), `arquivada ${v.name} no relatório`).not.toMatch(new RegExp(`Cor ${v.name}: \\+`));
    expect(after.totalUnits).toBe(before.totalUnits);
    expect(after.cash.accumulated).toBe(before.cash.accumulated); // dinheiro não muda
    expect(await erros()).toEqual([]);
    console.log(`dados reais: excluídas ${apagadas} de vez + ${escondidas} com vendas (histórico mantido) · mensagem ${w.length} letras`);
  });
});
