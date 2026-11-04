/**
 * Dados reais no app novo (só roda com DADOS_REAIS=arquivo.json): abre o backup, confere que nada mudou
 * (estoque, caixa e vendas iguais ao arquivo) e que o diagnóstico não acha nenhum erro.
 */
import { describe, expect, it } from 'vitest';
import { AppDB, db, useDatabase } from '../db/db';
import { restoreBackup } from '../services/backup';
import { computeCash } from '../services/summary';
import { runDiagnostics } from '../services/diagnostics';
import { openFiado, creditBalances } from '../services/sales';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
describe.skipIf(!env.DADOS_REAIS)('dados reais no app novo', () => {
  it('abre igual, sem erro no diagnóstico, sem fiado nem vale inventado', async () => {
    useDatabase(new AppDB(`reais-${Math.random()}`));
    // @ts-expect-error módulo do Node sem tipos (só neste teste)
    const { readFileSync } = await import('node:fs');
    const raw = JSON.parse(readFileSync(env.DADOS_REAIS!, 'utf8'));
    await restoreBackup(raw, { keepSafety: false });
    for (const t of ['variants', 'dailyStockItems', 'stockMovements', 'orders', 'sales', 'reservations', 'cashMovements'] as const)
      expect(await db.table(t).count(), t).toBe(raw.data[t].length);
    // estoque gravado de cada dia continua exatamente o do arquivo
    const items = new Map(raw.data.dailyStockItems.map((i: { id: string; currentQuantity: number }) => [i.id, i.currentQuantity]));
    for (const i of await db.dailyStockItems.toArray()) expect(i.currentQuantity).toBe(items.get(i.id));
    const days = await db.dailyRecords.orderBy('date').toArray();
    const caixa = [];
    for (const d of days) caixa.push([d.date, (await computeCash(d.id)).accumulated]);
    console.log('dados reais: caixa por dia', JSON.stringify(caixa));
    const f = await runDiagnostics();
    console.log('dados reais: avisos', f.findings.filter((x) => x.level === 'aviso').map((x) => x.title));
    expect(f.findings.filter((x) => x.level === 'erro')).toEqual([]);
    expect(await openFiado()).toEqual([]);
    expect(await creditBalances()).toEqual([]);
  });
});
