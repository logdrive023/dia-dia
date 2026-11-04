/**
 * Caso real (04/11/2026): “Poa” foi arquivada e recriada com cor. A antiga continuou com 7 no estoque do dia,
 * aparecia igual à nova e somava: 7 + 7 = 14, quando só existiam 7.
 * Agora: a cor antiga não soma no total (tela e relatório), excluída não passa para o dia seguinte,
 * e dá para passar o saldo para a cor nova ou zerar, com registro.
 */
import { describe, expect, it } from 'vitest';
import { AppDB, db, useDatabase } from '../db/db';
import { seedIfNeeded } from '../db/seed';
import { moveStock, settleRetiredStock, startDay } from '../services/days';
import { archiveVariant, createGroup, createVariant, deleteVariant } from '../services/catalog';
import { daySummary, loadStockRows } from '../services/summary';
import { runDiagnostics } from '../services/diagnostics';
import { isOldRow } from '../screens/Stock';

async function setup() {
  useDatabase(new AppDB(`repetida-${Math.random()}`));
  await seedIfNeeded();
  await db.settings.where('key').equals('initialOpening').delete();
  const d1 = await startDay('2026-11-02');
  const g = await createGroup({ name: 'Camisa Teste' });
  const old = await createVariant({ groupId: g.id, name: 'Poa', startQuantity: 7, dailyRecordId: d1.id });
  // arquiva a sem cor e recria “Poa” com a bolinha, de novo com 7
  await archiveVariant(old.id, true);
  const neu = await createVariant({ groupId: g.id, name: 'Poa', color: 'poa', startQuantity: 7, dailyRecordId: d1.id });
  const d2 = await startDay('2026-11-03');
  return { g, old, neu, d1, d2 };
}
const camisa = async (dayId: string, date: string, gid: string) => (await loadStockRows(dayId, date)).filter((r) => r.group.id === gid);

describe('cor antiga repetida (Poa 7 + Poa 7)', () => {
  it('a antiga continua registrada no dia, mas fica fora do total da tela e do relatório', async () => {
    const { g, old, d2 } = await setup();
    const rows = await camisa(d2.id, d2.date, g.id);
    expect(rows.map((r) => [r.variant.name, r.item.currentQuantity, isOldRow(r)])).toEqual([['Poa', 7, true], ['Poa', 7, false]]);
    const live = rows.filter((r) => !isOldRow(r)).reduce((s, r) => s + r.item.currentQuantity, 0);
    expect(live).toBe(7); // antes a tela mostrava 14
    const s = await daySummary(d2.id, d2.date);
    expect(s.stockNow.filter((r) => r.group.id === g.id).reduce((n, r) => n + r.item.currentQuantity, 0)).toBe(7);
    const diag = await runDiagnostics();
    expect(diag.findings.some((f) => f.title.startsWith('Cor antiga com peças') && f.title.includes('Poa'))).toBe(true);
    expect(old.id).toBeTruthy();
  });

  it('zerar a antiga: fica registrado, não vira “saiu” no relatório e a conta continua fechando', async () => {
    const { g, old, d2 } = await setup();
    expect(await settleRetiredStock(d2.id, old.id, null)).toBe(7);
    const rows = await camisa(d2.id, d2.date, g.id);
    expect(rows.find((r) => r.variant.id === old.id)!.item.currentQuantity).toBe(0);
    const mv = await db.stockMovements.where('variantId').equals(old.id).toArray();
    expect(mv[mv.length - 1]).toMatchObject({ type: 'ajuste', quantity: -7 });
    const s = await daySummary(d2.id, d2.date);
    expect(s.outUnits).toBe(0);
    expect(s.adjustUnits).toBe(0);
    expect(s.initialUnits - s.soldUnits + s.enteredUnits + s.adjustUnits).toBe(s.totalUnits);
    expect((await runDiagnostics()).findings.filter((f) => f.level === 'erro')).toEqual([]);
  });

  it('cor antiga não recebe + nem − (nem venda): só “Resolver” mexe nela', async () => {
    const { old, d2 } = await setup();
    await expect(moveStock(d2.id, old.id, -1, 'saida')).rejects.toThrow('cor antiga');
    await expect(moveStock(d2.id, old.id, 1, 'entrada')).rejects.toThrow('cor antiga');
    expect((await daySummary(d2.id, d2.date)).outUnits).toBe(0);
  });

  it('passar para a nova: a nova soma e a conta fecha', async () => {
    const { g, old, neu, d2 } = await setup();
    await settleRetiredStock(d2.id, old.id, neu.id);
    const rows = await camisa(d2.id, d2.date, g.id);
    expect(rows.find((r) => r.variant.id === neu.id)!.item.currentQuantity).toBe(14);
    expect(rows.find((r) => r.variant.id === old.id)!.item.currentQuantity).toBe(0);
    const s = await daySummary(d2.id, d2.date);
    expect(s.initialUnits - s.soldUnits + s.enteredUnits + s.adjustUnits).toBe(s.totalUnits);
  });

  it('não passa para outra cor antiga', async () => {
    const { old, d2 } = await setup();
    await expect(settleRetiredStock(d2.id, old.id, old.id)).rejects.toThrow('cor ativa');
  });

  it('cor excluída com peças passa para o dia seguinte como cor antiga (fora do total), nunca some sem registro', async () => {
    const { g, old, d2 } = await setup();
    await deleteVariant(old.id);
    await db.dailyRecords.update(d2.id, { status: 'closed' });
    const d3 = await startDay('2026-11-04');
    const rows = await camisa(d3.id, d3.date, g.id);
    expect(rows.map((r) => [r.variant.name, r.item.currentQuantity, isOldRow(r)])).toEqual([['Poa', 7, true], ['Poa', 7, false]]);
    expect(rows.filter((r) => !isOldRow(r)).reduce((s, r) => s + r.item.currentQuantity, 0)).toBe(7);
  });
});
