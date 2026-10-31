import { db } from '../db/db';
import type { Group, Variant } from '../db/types';
import { normalize, nowIso, uid } from '../lib/util';
import { audit } from './audit';
import { getSetting, setSetting } from './settings';

export class UserError extends Error {}

// ---------------- grupos ----------------

export async function createGroup(input: { name: string; color?: string; icon?: string; description?: string }) {
  const name = input.name.trim();
  if (!name) throw new UserError('Informe o nome do grupo.');
  return db.transaction('rw', db.groups, db.auditLogs, async () => {
    const all = await db.groups.toArray();
    if (all.some((g) => !g.archivedAt && normalize(g.name) === normalize(name)))
      throw new UserError(`Já existe um grupo chamado "${name}".`);
    const now = nowIso();
    const g: Group = {
      id: uid(), name, description: input.description?.trim() || undefined, icon: input.icon || '📦',
      color: input.color || '#3b82f6', displayOrder: all.length ? Math.max(...all.map((x) => x.displayOrder)) + 1 : 0,
      active: true, archivedAt: null, createdAt: now, updatedAt: now,
    };
    await db.groups.add(g);
    await audit('group', g.id, 'create', null, { name });
    return g;
  });
}

export async function updateGroup(id: string, patch: Partial<Pick<Group, 'name' | 'description' | 'icon' | 'color' | 'categoryIds'>>) {
  return db.transaction('rw', db.groups, db.auditLogs, async () => {
    const g = await db.groups.get(id);
    if (!g) throw new UserError('Grupo não encontrado.');
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new UserError('O nome não pode ficar vazio.');
      const dup = (await db.groups.toArray()).some((x) => x.id !== id && !x.archivedAt && normalize(x.name) === normalize(name));
      if (dup) throw new UserError(`Já existe um grupo chamado "${name}".`);
      patch.name = name;
      if (name !== g.name) await audit('group', id, 'rename', g.name, name);
    }
    await db.groups.update(id, { ...patch, updatedAt: nowIso() });
  });
}

export async function setGroupActive(id: string, active: boolean) {
  await db.groups.update(id, { active, updatedAt: nowIso() });
  await audit('group', id, active ? 'activate' : 'deactivate');
}

export async function archiveGroup(id: string, archived: boolean) {
  await db.groups.update(id, { archivedAt: archived ? nowIso() : null, active: !archived, updatedAt: nowIso() });
  await audit('group', id, archived ? 'archive' : 'unarchive');
}

export async function reorderGroups(orderedIds: string[]) {
  await db.transaction('rw', db.groups, async () => {
    for (let i = 0; i < orderedIds.length; i++) await db.groups.update(orderedIds[i], { displayOrder: i });
  });
}

async function variantHasHistory(variantId: string) {
  const [m, s, r, items] = await Promise.all([
    db.stockMovements.where('variantId').equals(variantId).count(),
    db.sales.where('variantId').equals(variantId).count(),
    db.reservations.where('variantId').equals(variantId).count(),
    db.dailyStockItems.where('variantId').equals(variantId).toArray(),
  ]);
  return m + s + r > 0 || items.some((i) => i.initialQuantity !== 0 || i.currentQuantity !== 0);
}

export async function groupHasHistory(groupId: string) {
  const vs = await db.variants.where('groupId').equals(groupId).toArray();
  for (const v of vs) if (await variantHasHistory(v.id)) return true;
  return false;
}

/** Exclui somente se não houver histórico. Caso contrário o chamador deve oferecer arquivar. */
export async function deleteGroup(id: string) {
  if (await groupHasHistory(id)) throw new UserError('Este grupo tem histórico. Arquive em vez de excluir.');
  await db.transaction('rw', [db.groups, db.variants, db.dailyStockItems, db.settings, db.auditLogs], async () => {
    const vs = await db.variants.where('groupId').equals(id).toArray();
    for (const v of vs) {
      await db.dailyStockItems.where('variantId').equals(v.id).delete();
      await db.variants.delete(v.id);
    }
    const g = await db.groups.get(id);
    await db.groups.delete(id);
    const sell = await getSetting('sellGroups');
    await setSetting('sellGroups', sell.filter((s) => s.groupId !== id));
    await audit('group', id, 'delete', g?.name);
  });
}

/** Move todas as variações de um grupo para outro (histórico preservado: só muda o vínculo atual). */
export async function transferVariants(fromGroupId: string, toGroupId: string) {
  await db.transaction('rw', db.variants, db.auditLogs, async () => {
    const vs = await db.variants.where('groupId').equals(fromGroupId).toArray();
    const target = await db.variants.where('groupId').equals(toGroupId).toArray();
    let order = target.length;
    for (const v of vs) {
      await db.variants.update(v.id, { groupId: toGroupId, displayOrder: order++, updatedAt: nowIso() });
      await audit('variant', v.id, 'move', fromGroupId, toGroupId);
    }
  });
}

// ---------------- variações ----------------

export async function createVariant(input: {
  groupId: string; name: string; startQuantity?: number; minimumStock?: number | null;
  optionalPriceInCents?: number | null; color?: string; description?: string; notes?: string;
  /** Se informado, a quantidade inicial entra neste dia (se existir e estiver aberto). */
  dailyRecordId?: string | null;
}) {
  const name = input.name.trim();
  if (!name) throw new UserError('Informe o nome da variação.');
  const qty = Math.max(0, Math.floor(input.startQuantity ?? 0));
  return db.transaction('rw', [db.variants, db.groups, db.dailyStockItems, db.dailyRecords, db.stockMovements, db.auditLogs], async () => {
    if (!(await db.groups.get(input.groupId))) throw new UserError('Grupo não encontrado.');
    const siblings = await db.variants.where('groupId').equals(input.groupId).toArray();
    if (siblings.some((v) => !v.archivedAt && normalize(v.name) === normalize(name)))
      throw new UserError(`Já existe "${name}" neste grupo.`);
    const now = nowIso();
    const v: Variant = {
      id: uid(), groupId: input.groupId, name, description: input.description, color: input.color,
      displayOrder: siblings.length, active: true, archivedAt: null,
      minimumStock: input.minimumStock ?? null, startQuantity: qty,
      optionalPriceInCents: input.optionalPriceInCents ?? null, notes: input.notes, createdAt: now, updatedAt: now,
    };
    await db.variants.add(v);
    if (input.dailyRecordId) {
      const day = await db.dailyRecords.get(input.dailyRecordId);
      if (day) {
        await db.dailyStockItems.add({ id: uid(), dailyRecordId: day.id, variantId: v.id, initialQuantity: 0, currentQuantity: qty });
        if (qty > 0)
          await db.stockMovements.add({ id: uid(), dailyRecordId: day.id, variantId: v.id, type: 'entrada', quantity: qty,
            previousBalance: 0, newBalance: qty, createdAt: now, description: 'Quantidade inicial do cadastro' });
      }
    }
    await audit('variant', v.id, 'create', null, { name, groupId: input.groupId, qty });
    return v;
  });
}

export async function updateVariant(id: string, patch: Partial<Pick<Variant,
  'name' | 'description' | 'color' | 'minimumStock' | 'optionalPriceInCents' | 'notes'>>) {
  return db.transaction('rw', db.variants, db.auditLogs, async () => {
    const v = await db.variants.get(id);
    if (!v) throw new UserError('Variação não encontrada.');
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new UserError('O nome não pode ficar vazio.');
      const sib = await db.variants.where('groupId').equals(v.groupId).toArray();
      if (sib.some((x) => x.id !== id && !x.archivedAt && normalize(x.name) === normalize(name)))
        throw new UserError(`Já existe "${name}" neste grupo.`);
      patch.name = name;
      if (name !== v.name) await audit('variant', id, 'rename', v.name, name);
    }
    for (const k of ['minimumStock', 'optionalPriceInCents'] as const)
      if (patch[k] !== undefined && patch[k] !== v[k]) await audit('variant', id, `set_${k}`, v[k], patch[k]);
    await db.variants.update(id, { ...patch, updatedAt: nowIso() });
  });
}

export async function setVariantActive(id: string, active: boolean) {
  await db.variants.update(id, { active, updatedAt: nowIso() });
  await audit('variant', id, active ? 'activate' : 'deactivate');
}

export async function archiveVariant(id: string, archived: boolean) {
  await db.variants.update(id, { archivedAt: archived ? nowIso() : null, active: !archived, updatedAt: nowIso() });
  await audit('variant', id, archived ? 'archive' : 'unarchive');
}

export async function reorderVariants(orderedIds: string[]) {
  await db.transaction('rw', db.variants, async () => {
    for (let i = 0; i < orderedIds.length; i++) await db.variants.update(orderedIds[i], { displayOrder: i });
  });
}

export async function moveVariant(id: string, toGroupId: string) {
  await db.transaction('rw', db.variants, db.groups, db.auditLogs, async () => {
    const v = await db.variants.get(id);
    if (!v) throw new UserError('Variação não encontrada.');
    if (!(await db.groups.get(toGroupId))) throw new UserError('Grupo de destino não encontrado.');
    const sib = await db.variants.where('groupId').equals(toGroupId).toArray();
    if (sib.some((x) => !x.archivedAt && normalize(x.name) === normalize(v.name)))
      throw new UserError(`O grupo de destino já tem "${v.name}". Renomeie antes de mover.`);
    await db.variants.update(id, { groupId: toGroupId, displayOrder: sib.length, updatedAt: nowIso() });
    await audit('variant', id, 'move', v.groupId, toGroupId);
  });
}

export async function deleteVariant(id: string) {
  if (await variantHasHistory(id)) throw new UserError('Esta variação tem histórico. Arquive em vez de excluir.');
  await db.transaction('rw', db.variants, db.dailyStockItems, db.auditLogs, async () => {
    const v = await db.variants.get(id);
    await db.dailyStockItems.where('variantId').equals(id).delete();
    await db.variants.delete(id);
    await audit('variant', id, 'delete', v?.name);
  });
}

export { variantHasHistory };

// ---------------- categorias ----------------

export async function createCategory(name: string, color = '#6366f1') {
  const n = name.trim();
  if (!n) throw new UserError('Informe o nome da etiqueta.');
  const count = await db.categories.count();
  const c = { id: uid(), name: n, color, displayOrder: count };
  await db.categories.add(c);
  return c;
}

export async function deleteCategory(id: string) {
  await db.transaction('rw', db.categories, db.groups, async () => {
    await db.categories.delete(id);
    const gs = await db.groups.toArray();
    for (const g of gs)
      if (g.categoryIds?.includes(id)) await db.groups.update(g.id, { categoryIds: g.categoryIds.filter((x) => x !== id) });
  });
}

/** Cadastra um grupo pendente da seleção "Para vender" e troca a entrada pendente pelo grupo real. */
export async function registerPendingSellGroup(pendingName: string, name = pendingName) {
  const g = await createGroup({ name, icon: '👑' });
  const sell = await getSetting('sellGroups');
  await setSetting('sellGroups', sell.map((s) => (s.pendingName === pendingName ? { groupId: g.id, highlight: s.highlight } : s)));
  return g;
}
