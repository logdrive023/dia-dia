import { db } from './db';
import type { Group, Variant } from './types';
import type { SellEntry } from '../services/settings';
import { nowIso, uid } from '../lib/util';

/** Carga inicial editável. Não é estrutura fixa: tudo pode ser renomeado, arquivado ou removido. */
export const SEED_DATA: { name: string; color: string; icon: string; variants: [string, number][] }[] = [
  { name: 'Plomo', color: '#64748b', icon: '🎀', variants: [
    ['Vermelho', 14], ['Branco', 12], ['Amarelo', 7], ['Preto', 6], ['Verde Piscina', 2],
    ['Rosa', 1], ['Azul', 0], ['Celeste', 3], ['Café', 3],
  ] },
  { name: 'Lila', color: '#a855f7', icon: '💜', variants: [
    ['Amarelo', 6], ['Rosa', 5], ['Branco', 1], ['Verde', 4], ['Azul', 8],
  ] },
  { name: 'Broche', color: '#f59e0b', icon: '📌', variants: [
    ['Branco', 30], ['Amarelo', 7], ['Preto', 2], ['Poa', 15], ['Vermelho', 2], ['Celeste', 3], ['Verde', 1],
  ] },
  { name: 'Camisa', color: '#14b8a6', icon: '👕', variants: [['Poa', 6]] },
  { name: 'Broche Médio', color: '#f97316', icon: '📍', variants: [
    ['Poa', 4], ['Celeste', 3], ['Preto', 3], ['Verde', 1], ['Rosa', 8], ['Branco', 2], ['Vermelho', 2],
  ] },
  { name: 'Naranja', color: '#ea580c', icon: '🧡', variants: [
    ['Poa', 13], ['Amarelo', 2], ['Verde', 2], ['Celeste', 1], ['Café', 2], ['Azul', 3], ['Rosa', 2],
  ] },
  { name: 'Dorado', color: '#ca8a04', icon: '✨', variants: [
    ['Amarelo', 6], ['Rosa', 6], ['Vermelho', 4], ['Verde', 1], ['Branco', 5], ['Café', 2], ['Celeste', 4], ['Preto', 4],
  ] },
  { name: 'Azul', color: '#2563eb', icon: '💙', variants: [
    ['Verde Piscina', 8], ['Branco', 5], ['Amarelo', 0], ['Rosa', 0], ['Verde', 2], ['Vermelho', 3], ['Preto', 2],
  ] },
];

export const INITIAL_SELL_GROUPS = ['Azul', 'Plomo', 'Lila', 'Broche Rey'];

export const VARIANT_COLOR: Record<string, string> = {
  Vermelho: '#ef4444', Branco: '#f8fafc', Amarelo: '#facc15', Preto: '#111827',
  'Verde Piscina': '#2dd4bf', Rosa: '#f472b6', Azul: '#3b82f6', Celeste: '#7dd3fc',
  Café: '#92400e', Verde: '#22c55e', Poa: 'poa',
};

export async function seedIfNeeded(): Promise<boolean> {
  return db.transaction('rw', db.groups, db.variants, db.settings, async () => {
    const done = await db.settings.where('key').equals('seedDone').first();
    if (done || (await db.groups.count()) > 0) return false;
    const now = nowIso();
    const groups: Group[] = [];
    const variants: Variant[] = [];
    SEED_DATA.forEach((g, gi) => {
      const groupId = uid();
      groups.push({ id: groupId, name: g.name, color: g.color, icon: g.icon, displayOrder: gi, active: true,
        archivedAt: null, createdAt: now, updatedAt: now });
      g.variants.forEach(([name, qty], vi) => {
        variants.push({ id: uid(), groupId, name, color: VARIANT_COLOR[name], displayOrder: vi, active: true,
          archivedAt: null, minimumStock: null, startQuantity: qty, optionalPriceInCents: null,
          createdAt: now, updatedAt: now });
      });
    });
    await db.groups.bulkAdd(groups);
    await db.variants.bulkAdd(variants);
    // Grupos pendentes (sem variações informadas) ficam só na seleção, aguardando cadastro.
    const sell: SellEntry[] = INITIAL_SELL_GROUPS.map((n, i) => {
      const g = groups.find((x) => x.name === n);
      return g ? { groupId: g.id, highlight: i < 2 } : { pendingName: n, highlight: false };
    });
    await db.settings.bulkAdd([
      { id: uid(), key: 'seedDone', value: now },
      { id: uid(), key: 'sellGroups', value: sell },
    ]);
    return true;
  });
}
