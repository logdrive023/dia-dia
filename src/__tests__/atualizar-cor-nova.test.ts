/**
 * Caso real (03/11/2026, 03:20): cores cadastradas no dia com quantidade (Dorado › Azul 5, Naranja › Cafe 4,
 * Plomo › Terracota 1, Plomo › Salmón 6) apareciam como “começou diferente do fim de ontem”; o “Atualizar”
 * zerava todas. Dorado › Azul ficou em 0 até o dia seguinte.
 * Agora: cor que não existia ontem não é diferença e o Atualizar não mexe nela.
 */
import { describe, expect, it } from 'vitest';
import { AppDB, db, useDatabase } from '../db/db';
import { seedIfNeeded } from '../db/seed';
import { closeDay, reopenDay, resyncFromPrevious, setStock, startDay } from '../services/days';
import { createGroup, createVariant } from '../services/catalog';
import { loadStockRows, syncGap } from '../services/summary';
import { runDiagnostics } from '../services/diagnostics';

async function setup() {
  useDatabase(new AppDB(`atualizar-${Math.random()}`));
  await seedIfNeeded();
  await db.settings.where('key').equals('initialOpening').delete();
  const d1 = await startDay('2026-11-02');
  const g = await createGroup({ name: 'Dorado Teste' });
  const old = await createVariant({ groupId: g.id, name: 'Rojo', startQuantity: 10, dailyRecordId: d1.id });
  await closeDay(d1.id);
  const d2 = await startDay('2026-11-03');
  // cadastrada hoje, com 5 peças
  const azul = await createVariant({ groupId: g.id, name: 'Azul', startQuantity: 5, dailyRecordId: d2.id });
  return { g, d1, d2, old, azul };
}
const qty = async (dayId: string, date: string, id: string) => (await loadStockRows(dayId, date)).find((r) => r.variant.id === id)?.item;

describe('Atualizar não zera cor cadastrada hoje', () => {
  it('cor nova do dia não vira “começou diferente” (nem no Diagnóstico)', async () => {
    const { d2 } = await setup();
    expect(await syncGap(d2.id)).toBeNull();
    expect((await runDiagnostics()).findings.some((f) => f.title.includes('começou diferente'))).toBe(false);
  });

  it('correção de verdade no dia anterior: o Atualizar traz a correção e mantém as 5 da cor nova', async () => {
    const { d1, d2, old, azul } = await setup();
    await reopenDay(d1.id);
    await setStock(d1.id, old.id, 8); // contou 8 ontem, não 10
    await closeDay(d1.id);
    const gap = await syncGap(d2.id);
    expect(gap?.diffs.map((x) => x.variantId)).toEqual([old.id]);
    await resyncFromPrevious(d2.id);
    expect(await qty(d2.id, d2.date, old.id)).toMatchObject({ initialQuantity: 8, currentQuantity: 8 });
    expect(await qty(d2.id, d2.date, azul.id)).toMatchObject({ initialQuantity: 5, currentQuantity: 5 });
    expect(await syncGap(d2.id)).toBeNull();
  });

  it('Atualizar sem nada para corrigir não muda a cor nova', async () => {
    const { d2, azul } = await setup();
    expect(await resyncFromPrevious(d2.id)).toBe(0);
    expect(await qty(d2.id, d2.date, azul.id)).toMatchObject({ initialQuantity: 5, currentQuantity: 5 });
  });
});
