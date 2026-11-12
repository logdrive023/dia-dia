/**
 * Configurações › Recomeçar: "Voltar aos dados iniciais" e "Reiniciar tudo do 0".
 * Backtest: ciclos aleatórios de uso (dias, vendas, lançamentos, cadastros) seguidos de uma das duas opções,
 * e o app "reaberto" (como acontece depois do botão). Depois de cada ciclo, o estado tem que ser exatamente o esperado,
 * e "Voltar como estava" tem que trazer de volta o que havia antes.
 */
import { describe, expect, it } from 'vitest';
import { AppDB, db, useDatabase } from '../db/db';
import { prepareFirstRun, seedIfNeeded } from '../db/seed';
import { uid } from '../lib/util';
import { startDay } from '../services/days';
import { createOrder } from '../services/sales';
import { addCashMovement } from '../services/cash';
import { createGroup, createVariant, UserError } from '../services/catalog';
import { computeCash, loadStockRows } from '../services/summary';
import { resetToInitialData, resetToZero, undoLastRestore } from '../services/backup';
import { getAllSettings } from '../services/settings';
import { runDiagnostics } from '../services/diagnostics';
import { mergeBackup } from '../services/sync';

function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const CYCLES = Number((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.RECOMECAR ?? 80);

/** O app abrindo de novo (depois do botão a página recarrega e roda o carregamento inicial). */
const reopen = () => prepareFirstRun();
const counts = async () => ({
  groups: await db.groups.count(), variants: await db.variants.count(), days: await db.dailyRecords.count(),
  orders: await db.orders.count(), cash: await db.cashMovements.count(), moves: await db.stockMovements.count(),
});

async function expectZero(where: string) {
  expect(await counts(), `${where}: app vazio`).toEqual({ groups: 0, variants: 0, days: 0, orders: 0, cash: 0, moves: 0 });
  const s = await getAllSettings();
  expect([s.sellGroups.length, s.dailyPayInCents, s.paymentMethods.join()], `${where}: configurações padrão`).toEqual([0, 15000, 'dinheiro,pix,cartao,debito']);
  // começar um dia num app vazio funciona e o caixa é 0
  const d = await startDay('2026-11-05');
  const c = await computeCash(d.id);
  expect([c.opening, c.accumulated, c.cashOnHand, (await loadStockRows(d.id, d.date)).length], `${where}: dia vazio`).toEqual([0, 0, 0, 0]);
}

/** Dados padrão = principal (02–04/11) + Samsung (12/11) mesclados (src/db/defaultData.json). */
async function expectInitial(where: string) {
  const n = await counts();
  expect([n.groups, n.variants, n.days, n.orders, n.cash], `${where}: dados padrão`).toEqual([11, 112, 4, 63, 75]);
  // o próximo dia continua de 12/11: caixa acumulado e estoque que sobrou
  const d = await startDay('2026-11-13');
  expect(d.sourceDate, `${where}: continua de 12/11`).toBe('2026-11-12');
  const c = await computeCash(d.id);
  expect(c.opening, `${where}: caixa de 12/11`).toBe(1333722);
  const rows = await loadStockRows(d.id, d.date);
  expect(rows.reduce((s, r) => s + r.item.currentQuantity, 0), `${where}: estoque de 12/11`).toBe(357);
  expect((await getAllSettings()).sellGroups.length, `${where}: grupos para vender`).toBe(11);
  expect((await runDiagnostics()).findings.filter((f) => f.level === 'erro'), `${where}: diagnóstico`).toEqual([]);
}

describe('Recomeçar', () => {
  it('Reiniciar tudo do 0: fica vazio e continua vazio ao reabrir o app; dá para usar e para voltar como estava', async () => {
    useDatabase(new AppDB(`zero-${Math.random()}`));
    await seedIfNeeded();
    const d = await startDay('2026-10-31');
    const before = await counts();
    await resetToZero();
    await reopen(); await reopen();
    await expectZero('zerado');
    // usar do zero: cadastrar, vender, lançar
    // como na tela: cadastra a cor com o dia aberto, a quantidade entra no estoque de hoje
    const day = (await db.dailyRecords.toArray())[0];
    const g = await createGroup({ name: 'Novo' });
    const v = await createVariant({ groupId: g.id, name: 'Azul', startQuantity: 3, dailyRecordId: day.id });
    // grupo novo já nasce à venda e aparece em ⭐ Para vender
    expect([v.forSale, (await getAllSettings()).sellGroups.map((e) => e.groupId)]).toEqual([true, [g.id]]);
    await expect(createOrder({ orderId: uid(), dailyRecordId: day.id, paymentMethod: 'pix', lines: [{ variantId: v.id, quantity: 1, unitPriceInCents: 7000 }] }))
      .resolves.toBeTruthy();
    expect((await runDiagnostics()).findings.filter((f) => f.level === 'erro')).toEqual([]);
    // voltar como estava: os dados de antes de zerar
    await resetToZero(); // guarda a cópia do uso acima
    await undoLastRestore();
    expect((await counts()).groups).toBe(1);
    void d; void before;
  });

  it('celular novo (app vazio) abre com os dados padrão; reabrir não carrega de novo', async () => {
    useDatabase(new AppDB(`novo-${Math.random()}`));
    expect(await prepareFirstRun()).toBe(true);
    expect(await prepareFirstRun()).toBe(false);
    // juntar com o celular principal (mesmos identificadores) não duplica nada
    const before = await counts();
    const { default: text } = await import('../db/defaultData.json?raw');
    await mergeBackup(JSON.parse(text));
    expect(await counts()).toEqual(before);
    await expectInitial('celular novo');
  });

  it('Voltar aos dados iniciais depois de zerar traz os dados padrão (principal + Samsung até 12/11)', async () => {
    useDatabase(new AppDB(`ini-${Math.random()}`));
    await seedIfNeeded();
    await resetToZero(); await reopen();
    await resetToInitialData(); await reopen();
    await expectInitial('iniciais depois do zero');
  });

  it(`backtest: ${CYCLES} ciclos de uso aleatório + recomeçar (as duas opções) sem bug`, async () => {
    useDatabase(new AppDB(`bt-${Math.random()}`));
    await seedIfNeeded();
    const rand = rng(31102026);
    const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
    let zeros = 0, initials = 0, undos = 0;
    for (let cycle = 0; cycle < CYCLES; cycle++) {
      // uso aleatório: alguns dias, vendas, lançamentos e cadastros (válidos ou recusados)
      const steps = 1 + Math.floor(rand() * 6);
      for (let i = 0; i < steps; i++) {
        try {
          const r = rand();
          const days = await db.dailyRecords.toArray();
          if (r < 0.3 || !days.length) await startDay(`2026-11-${String(1 + Math.floor(rand() * 28)).padStart(2, '0')}`);
          else if (r < 0.55) {
            const open = days.filter((x) => x.status === 'open');
            const vs = (await db.variants.toArray()).filter((x) => x.forSale !== false);
            if (open.length && vs.length)
              await createOrder({ orderId: uid(), dailyRecordId: pick(open).id, paymentMethod: pick(['dinheiro', 'pix', 'cartao', 'debito'] as const),
                lines: [{ variantId: pick(vs).id, quantity: 1, unitPriceInCents: 7000 }] });
          } else if (r < 0.8) {
            const open = days.filter((x) => x.status === 'open');
            if (open.length) await addCashMovement({ dailyRecordId: pick(open).id, type: pick(['dar', 'entrada', 'despesa', 'retirada', 'pagamento'] as const),
              amountInCents: 1000 + Math.floor(rand() * 20000), quantity: 1 });
          } else {
            const g = await createGroup({ name: `G${cycle}-${i}` });
            const open = days.filter((x) => x.status === 'open');
            await createVariant({ groupId: g.id, name: 'Cor', startQuantity: Math.floor(rand() * 5), dailyRecordId: open.length ? pick(open).id : null });
          }
        } catch (e) { if (!(e instanceof UserError)) throw e; }
      }
      const before = await counts();
      const zero = rand() < 0.5;
      if (zero) { await resetToZero(); zeros++; } else { await resetToInitialData(); initials++; }
      await reopen();
      if (zero) await expectZero(`ciclo ${cycle} (zero)`); else await expectInitial(`ciclo ${cycle} (iniciais)`);
      expect((await runDiagnostics()).findings.filter((f) => f.level === 'erro'), `ciclo ${cycle}: diagnóstico`).toEqual([]);
      // de vez em quando: "Voltar como estava" traz exatamente o que havia antes de recomeçar
      if (rand() < 0.25) {
        await undoLastRestore(); undos++;
        await reopen();
        expect(await counts(), `ciclo ${cycle}: voltar como estava`).toEqual(before);
      }
    }
    console.log(`recomeçar: ${CYCLES} ciclos · ${zeros} do zero · ${initials} dados iniciais · ${undos} voltar como estava`);
    expect(zeros).toBeGreaterThan(0);
    expect(initials).toBeGreaterThan(0);
  }, 600_000);
});
