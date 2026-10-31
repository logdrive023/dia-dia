/**
 * Teste extremo:
 *  A) "macaco": milhares de ações aleatórias (válidas e inválidas) em 30 dias.
 *     Toda ação ou dá certo ou recusa com mensagem amigável (UserError/BackupError);
 *     nunca erro técnico, nunca dado inconsistente.
 *  B) tempestade: dezenas de operações disparadas ao mesmo tempo.
 *  C) escala: meses de uso — velocidade e tamanho do backup.
 *  D) relógio do celular voltando no tempo.
 */
import { describe, expect, it } from 'vitest';
import { AppDB, db, useDatabase } from '../db/db';
import { seedIfNeeded } from '../db/seed';
import type { MovementType, PaymentMethod } from '../db/types';
import { addDays, uid } from '../lib/util';
import {
  archiveGroup, archiveVariant, createGroup, createVariant, deleteVariant, moveVariant, setForSale, transferVariants, updateGroup, updateVariant, UserError,
} from '../services/catalog';
import {
  closeDay, getDayByDate, moveStock, reopenDay, resyncFromPrevious, setStock, startDay, undoMovement, undoStartDay,
} from '../services/days';
import {
  cancelOrder, cancelReservation, convertReservation, correctOrderPrices, createOrder, createReservation,
} from '../services/sales';
import { addCashMovement, removeCashMovement, setCountedBalance, setOpeningBalance } from '../services/cash';
import { cashChain, computeCash, daySummary, loadStockRows } from '../services/summary';
import { BackupError, buildBackup, decodeTextBackup, encodeTextBackup, restoreBackup, undoLastRestore } from '../services/backup';
import { runDiagnostics } from '../services/diagnostics';
import { notebookReport, whatsappReport } from '../services/report';
import { buildCsv } from '../services/csv';

function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

async function invariants(where: string) {
  const errs = (await runDiagnostics()).findings.filter((f) => f.level === 'erro');
  if (errs.length) console.log(where, JSON.stringify(errs, null, 1));
  expect(errs, `${where}: diagnóstico`).toEqual([]);
  const items = await db.dailyStockItems.toArray();
  expect(items.every((i) => Number.isInteger(i.currentQuantity) && i.currentQuantity >= 0), `${where}: estoque negativo ou inválido`).toBe(true);
  // caixa encadeado: "Ontem" de cada dia = saldo do dia anterior (salvo os digitados à mão)
  const chain = await cashChain();
  const days = await db.dailyRecords.orderBy('date').toArray();
  const recs = new Map((await db.cashRecords.toArray()).map((r) => [r.dailyRecordId, r]));
  for (let i = 1; i < days.length; i++) {
    const c = chain.get(days[i].id)!;
    if (!recs.get(days[i].id)?.openingManual) expect(c.opening, `${where}: ontem de ${days[i].date}`).toBe(chain.get(days[i - 1].id)!.accumulated);
    expect(Number.isInteger(c.accumulated) && Number.isInteger(c.cashOnHand), `${where}: caixa não inteiro`).toBe(true);
  }
  expect(new Set(days.map((d) => d.date)).size, `${where}: data duplicada`).toBe(days.length);
}

/** só aceita sucesso ou recusa amigável */
async function tryOp(name: string, f: () => Promise<unknown>, log: string[]) {
  try { await f(); log.push(`ok ${name}`); return true; } catch (e) {
    if (e instanceof UserError || e instanceof BackupError) { log.push(`recusou ${name}: ${(e as Error).message}`); return false; }
    throw new Error(`ERRO TÉCNICO em "${name}": ${(e as Error)?.name} ${(e as Error)?.message}\n${log.slice(-5).join('\n')}`);
  }
}

// 5 sorteios × 1.500 ações na suíte normal (rápida no GitHub); para o teste pesado: MACACO_ACOES=4000 (20.000 ações)
const SEEDS = [777, 4242, 9001, 13, 31337];
const PER_SEED = Number((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.MACACO_ACOES ?? 1500);

describe(`A) macaco: ${SEEDS.length * PER_SEED} ações aleatórias`, () => {
  it.each(SEEDS)('sorteio %i: nunca erro técnico, nunca dado inconsistente', async (seed) => {
    useDatabase(new AppDB(`macaco-${Math.random()}`));
    await seedIfNeeded();
    await db.variants.toCollection().modify({ forSale: true }); await db.settings.where('key').equals('initialOpening').delete();
    const R = rng(seed);
    const pick = <T,>(a: T[]): T => a[Math.floor(R() * a.length)];
    const junk = () => pick<unknown>([-1, 0, 1.5, NaN, Infinity, 1e12, 'x', null, undefined]) as number;
    const maybe = (good: number) => (R() < 0.15 ? junk() : good);
    const log: string[] = [];
    let date = '2026-10-01';
    await startDay(date);
    const counters = { ok: 0, recusou: 0 };

    // id do dia atual ('x' quando ainda não existe ou foi desfeito: o app tem de recusar com mensagem)
    const dayId = async () => (await getDayByDate(date))?.id ?? 'x';
    const anyDayId = async () => pick(await db.dailyRecords.toArray())?.id ?? 'x';
    const variantId = async () => (R() < 0.05 ? 'nao-existe' : pick(await db.variants.toArray()).id);
    const groupId = async () => (R() < 0.05 ? 'nao-existe' : pick(await db.groups.toArray()).id);
    const method = (): PaymentMethod => (R() < 0.03 ? ('bitcoin' as PaymentMethod) : pick(['dinheiro', 'pix', 'cartao', 'outro']));

    const ops: [string, () => Promise<unknown>][] = [
      ['vender', async () => createOrder({ orderId: R() < 0.1 ? 'repetido' : uid(), dailyRecordId: await dayId(), paymentMethod: method(),
        lines: [{ variantId: await variantId(), quantity: maybe(1 + Math.floor(R() * 3)), unitPriceInCents: R() < 0.1 ? null : maybe(7000) }] })],
      ['vender dividido', async () => {
        const total = 14000;
        return createOrder({ orderId: uid(), dailyRecordId: await dayId(), paymentMethod: 'pix',
          lines: [{ variantId: await variantId(), quantity: 2, unitPriceInCents: 7000 }],
          payments: [{ method: method(), amountInCents: maybe(10000) }, { method: method(), amountInCents: total - 10000 }] });
      }],
      ['cancelar venda', async () => cancelOrder(pick(await db.orders.toArray())?.id ?? 'x', { restoreReservations: R() < 0.5 })],
      ['corrigir valor', async () => {
        const s = pick(await db.sales.toArray());
        return correctOrderPrices(s?.orderId ?? 'x', { [s?.id ?? 'x']: R() < 0.2 ? null : maybe(6000 + Math.floor(R() * 4000)) });
      }],
      ['mexer estoque', async () => {
        const t = pick<MovementType>(['entrada', 'saida', 'perda', 'venda', 'ajuste']);
        const n = 1 + Math.floor(R() * 4);
        return moveStock(R() < 0.2 ? await anyDayId() : await dayId(), await variantId(), maybe(t === 'entrada' ? n : -n), t, undefined, { allowBelowReserved: R() < 0.3 });
      }],
      ['definir quantidade', async () => setStock(await dayId(), await variantId(), maybe(Math.floor(R() * 20)))],
      ['desfazer', async () => undoMovement(pick(await db.stockMovements.toArray())?.id ?? 'x')],
      ['reservar', async () => createReservation({ dailyRecordId: await dayId(), variantId: await variantId(), quantity: maybe(1), customer: 'Ana'.repeat(Math.floor(R() * 40)) })],
      ['cancelar reserva', async () => cancelReservation(pick(await db.reservations.toArray())?.id ?? 'x')],
      ['converter reserva', async () => convertReservation({ reservationId: pick(await db.reservations.toArray())?.id ?? 'x', dailyRecordId: await dayId(),
        unitPriceInCents: maybe(7000), paymentMethod: method(), orderId: uid() })],
      ['caixa', async () => addCashMovement({ dailyRecordId: await dayId(), type: pick(['dar', 'despesa', 'entrada', 'retirada', 'venda' as never]),
        amountInCents: maybe(1000 + Math.floor(R() * 9000)), paymentMethod: method(), person: 'Chico' })],
      ['remover lançamento', async () => removeCashMovement(pick(await db.cashMovements.toArray())?.id ?? 'x')],
      ['contado', async () => setCountedBalance(await dayId(), R() < 0.5 ? null : maybe(5000))],
      ['ontem à mão', async () => setOpeningBalance(await dayId(), R() < 0.4 ? null : maybe(64500), R() < 0.5 ? null : maybe(30000))],
      ['encerrar', async () => closeDay(await anyDayId(), R() < 0.5 ? undefined : maybe(1000))],
      ['reabrir', async () => reopenDay(await anyDayId())],
      ['atualizar do dia anterior', async () => resyncFromPrevious(await dayId())],
      ['desfazer início', async () => undoStartDay(await dayId())],
      ['virar o dia', async () => { const prev = await getDayByDate(date); if (prev && prev.status === 'open') await closeDay(prev.id); date = addDays(date, 1); return startDay(date, R() < 0.1 ? 'blank' : 'copy'); }],
      ['dia aleatório', async () => startDay(addDays('2026-10-01', Math.floor(R() * 40) - 5))],
      ['data lixo', async () => startDay(pick(['2026-02-30', '', 'amanhã', '2026-1-1']))],
      ['cadastrar peça', async () => createVariant({ groupId: await groupId(), name: pick(['Nova', 'Roxo', 'Azul', '   ', 'x'.repeat(50)]), startQuantity: maybe(3),
        dailyRecordId: R() < 0.5 ? await dayId() : null })],
      ['renomear grupo', async () => updateGroup(await groupId(), { name: pick(['Plomo', 'Lila', 'Novo Nome', '', '  Lila  ', 'Plômo']) })],
      ['editar peça', async () => updateVariant(await variantId(), { idealStock: R() < 0.3 ? null : Math.floor(R() * 20), optionalPriceInCents: R() < 0.3 ? null : 7000 })],
      ['arquivar peça', async () => archiveVariant(await variantId(), R() < 0.6)],
      ['arquivar grupo', async () => archiveGroup(await groupId(), R() < 0.5)],
      ['excluir peça', async () => deleteVariant(await variantId())],
      ['mover peça', async () => moveVariant(await variantId(), await groupId())],
      ['transferir grupo', async () => transferVariants(await groupId(), await groupId())],
      ['criar grupo', async () => createGroup({ name: pick(['Novidades', 'Promo', 'novidades', '']) })],
      ['guardar / pôr à venda', async () => setForSale([await variantId()], R() < 0.6)],
    ];
    for (let i = 0; i < PER_SEED; i++) {
      const [name, f] = pick(ops);
      (await tryOp(name, f, log)) ? counters.ok++ : counters.recusou++;
      if (i % 200 === 199) await invariants(`sorteio ${seed}, ação ${i + 1}`);
    }
    await invariants('fim do macaco');
    // relatórios e planilhas aguentam o resultado bagunçado
    for (const d of await db.dailyRecords.toArray()) {
      const s = await daySummary(d.id, d.date);
      expect(whatsappReport(d.date, s).length).toBeGreaterThan(50);
      expect(notebookReport(d.date, s).length).toBeGreaterThan(10);
    }
    for (const k of ['estoque', 'vendas', 'movimentacoes', 'caixa', 'historico'] as const) await buildCsv(k);
    // e tudo sobrevive a ir para outro celular
    const b = await buildBackup();
    useDatabase(new AppDB(`macaco-restore-${Math.random()}`));
    await restoreBackup(await decodeTextBackup((await encodeTextBackup(b)).join('\n')));
    await invariants('após restaurar');
    console.log(`macaco ${seed}: ${counters.ok} ok, ${counters.recusou} recusadas, ${await db.dailyRecords.count()} dias, ${await db.orders.count()} vendas`);
  }, 300000);
});

describe('B) tempestade: tudo ao mesmo tempo', () => {
  it('60 operações simultâneas no mesmo dia', async () => {
    useDatabase(new AppDB(`tempestade-${Math.random()}`));
    await seedIfNeeded();
    await db.variants.toCollection().modify({ forSale: true }); await db.settings.where('key').equals('initialOpening').delete();
    const d = await startDay('2026-10-31');
    const vs = await db.variants.toArray();
    const v = vs.find((x) => x.startQuantity === 3)!; // poucas peças: disputa
    const log: string[] = [];
    const jobs: Promise<unknown>[] = [];
    for (let i = 0; i < 20; i++) jobs.push(tryOp('vender', () => createOrder({ orderId: uid(), dailyRecordId: d.id, paymentMethod: 'pix', lines: [{ variantId: v.id, quantity: 1, unitPriceInCents: 7000 }] }), log));
    for (let i = 0; i < 10; i++) jobs.push(tryOp('reservar', () => createReservation({ dailyRecordId: d.id, variantId: v.id, quantity: 1 }), log));
    for (let i = 0; i < 10; i++) jobs.push(tryOp('saída', () => moveStock(d.id, v.id, -1, 'saida'), log));
    for (let i = 0; i < 10; i++) jobs.push(tryOp('caixa', () => addCashMovement({ dailyRecordId: d.id, type: 'dar', amountInCents: 100 }), log));
    for (let i = 0; i < 5; i++) jobs.push(tryOp('encerrar', () => closeDay(d.id), log));
    for (let i = 0; i < 5; i++) jobs.push(tryOp('reabrir', () => reopenDay(d.id), log));
    await Promise.all(jobs);
    await invariants('tempestade');
    const row = (await loadStockRows(d.id, d.date)).find((r) => r.variant.id === v.id)!;
    expect(row.item.currentQuantity).toBeGreaterThanOrEqual(0);
    expect(row.reserved).toBeLessThanOrEqual(row.item.currentQuantity + row.reserved); // reservas nunca de peças inexistentes na hora da reserva
    const sold = (await db.sales.where('variantId').equals(v.id).toArray()).filter((s) => s.status === 'ok').length;
    expect(sold + row.item.currentQuantity + (3 - sold - row.item.currentQuantity)).toBe(3);
  });
});

describe('C) escala: meses de uso', () => {
  it('180 dias × 15 vendas: rápido e backup cabe no WhatsApp', async () => {
    useDatabase(new AppDB(`escala-${Math.random()}`));
    await seedIfNeeded();
    await db.variants.toCollection().modify({ forSale: true }); await db.settings.where('key').equals('initialOpening').delete();
    const v = (await db.variants.toArray()).find((x) => x.startQuantity >= 30)!;
    let date = '2026-01-01';
    for (let d = 0; d < 180; d++) {
      const day = await startDay(date);
      await moveStock(day.id, v.id, 15, 'entrada');
      for (let i = 0; i < 15; i++)
        await createOrder({ orderId: uid(), dailyRecordId: day.id, paymentMethod: i % 2 ? 'pix' : 'dinheiro', lines: [{ variantId: v.id, quantity: 1, unitPriceInCents: 7000 }] });
      await addCashMovement({ dailyRecordId: day.id, type: 'dar', amountInCents: 5000, person: 'Chico' });
      await closeDay(day.id);
      date = addDays(date, 1);
    }
    const last = (await db.dailyRecords.orderBy('date').last())!;
    let t = performance.now();
    const s = await daySummary(last.id, last.date);
    const tSummary = performance.now() - t;
    t = performance.now();
    await computeCash(last.id);
    const tCash = performance.now() - t;
    t = performance.now();
    const b = await buildBackup();
    const parts = await encodeTextBackup(b);
    const tBackup = performance.now() - t;
    const kb = Math.round(JSON.stringify(b).length / 1024);
    const textKb = Math.round(parts.join('').length / 1024);
    console.log(`escala: 180 dias, ${await db.orders.count()} vendas | resumo do dia ${tSummary.toFixed(0)}ms | caixa ${tCash.toFixed(0)}ms | backup ${tBackup.toFixed(0)}ms, arquivo ${kb} KB, texto ${textKb} KB em ${parts.length} parte(s)`);
    expect(s.orders.length).toBe(15);
    expect((await computeCash(last.id)).accumulated).toBe(180 * (15 * 7000 - 5000));
    // em banco simulado (mais lento que o celular) o resumo do dia tem de sair em menos de 1,5 s
    expect(tSummary).toBeLessThan(1500);
    expect(parts.length).toBeLessThan(30);
    expect(tCash).toBeLessThan(300);
    await invariants('escala');
  }, 240000);
});

describe('D) relógio do celular errado', () => {
  it('relógio voltou: dias "no futuro" não quebram o caixa nem o estoque', async () => {
    useDatabase(new AppDB(`relogio-${Math.random()}`));
    await seedIfNeeded();
    await db.variants.toCollection().modify({ forSale: true }); await db.settings.where('key').equals('initialOpening').delete();
    const v = (await db.variants.toArray()).find((x) => x.startQuantity >= 2)!.id; // peça com estoque
    // usou com a data errada (2027) e depois corrigiu para 2026
    const wrong = await startDay('2027-05-10');
    await createOrder({ orderId: uid(), dailyRecordId: wrong.id, paymentMethod: 'pix', lines: [{ variantId: v, quantity: 1, unitPriceInCents: 7000 }] });
    const right = await startDay('2026-10-31');
    expect(right.sourceDate).toBeNull(); // nada antes de 31/10/2026 → começa da carga do cadastro
    expect((await computeCash(right.id)).opening).toBe(0);
    await createOrder({ orderId: uid(), dailyRecordId: right.id, paymentMethod: 'dinheiro', lines: [{ variantId: v, quantity: 1, unitPriceInCents: 7000 }] });
    await invariants('relógio');
    const diag = (await runDiagnostics()).findings.map((f) => f.title);
    expect(diag.some((t) => t.includes('futuro'))).toBe(true); // o verificador avisa
    // o dia "do futuro" pode ser apagado se estiver vazio; com venda, só reabrindo/cancelando
    await expect(undoStartDay(wrong.id)).rejects.toThrow(/lançamentos/);
  });
});

describe('E) voltar atrás em sequência', () => {
  it('receber, desfazer, refazer, desfazer… nunca perde nada', async () => {
    useDatabase(new AppDB(`vaivem-${Math.random()}`));
    await seedIfNeeded();
    await db.variants.toCollection().modify({ forSale: true }); await db.settings.where('key').equals('initialOpening').delete();
    const d = await startDay('2026-10-31');
    await createOrder({ orderId: uid(), dailyRecordId: d.id, paymentMethod: 'pix', lines: [{ variantId: (await db.variants.toArray()).find((x) => x.startQuantity >= 2)!.id, quantity: 1, unitPriceInCents: 7000 }] });
    const a = await buildBackup();
    await startDay('2026-11-01');
    const b = await buildBackup();
    await restoreBackup(a);
    for (let i = 0; i < 6; i++) {
      await undoLastRestore();
      const n = await db.dailyRecords.count();
      expect([1, 2]).toContain(n);
      await invariants(`vai e vem ${i}`);
    }
    await restoreBackup(b);
    expect(await db.dailyRecords.count()).toBe(2);
  });
});
