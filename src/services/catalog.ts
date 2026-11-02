import { db } from '../db/db';
import type { Group, Variant } from '../db/types';
import { isCents, MAX_QTY, normalize, nowIso, uid } from '../lib/util';
import { audit } from './audit';
import { getSetting, setSetting } from './settings';

/** Recusa com mensagem para a pessoa (em português). O nome fixo sobrevive à compactação do build. */
export class UserError extends Error { name = 'UserError'; }

const MAX_NAME = 40;

/** Estoque ideal/mínimo: inteiro de 0 a MAX_QTY; preço: centavos válidos. null = não definido. */
function validateNumbers(p: { idealStock?: number | null; minimumStock?: number | null; optionalPriceInCents?: number | null }) {
  for (const k of ['idealStock', 'minimumStock'] as const) {
    const v = p[k];
    if (v !== undefined && v !== null && !(Number.isInteger(v) && v >= 0 && v <= MAX_QTY)) throw new UserError('Estoque ideal inválido.');
  }
  const pr = p.optionalPriceInCents;
  if (pr !== undefined && pr !== null && !isCents(pr)) throw new UserError('Preço inválido.');
}
function cleanName(raw: string, what: string) {
  const name = raw.replace(/\s+/g, ' ').trim();
  if (!name) throw new UserError(`Informe o nome ${what}.`);
  if (name.length > MAX_NAME) throw new UserError(`Nome muito longo (máximo ${MAX_NAME} letras).`);
  return name;
}

// ---------------- grupos ----------------

export async function createGroup(input: { name: string; color?: string; icon?: string; description?: string }) {
  const name = cleanName(input.name, 'do grupo');
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
      const name = cleanName(patch.name, '');
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
  if (!archived) {
    const g = await db.groups.get(id);
    const all = await db.groups.toArray();
    if (g && all.some((x) => x.id !== id && !x.archivedAt && normalize(x.name) === normalize(g.name)))
      throw new UserError(`Já existe outro grupo ativo chamado "${g.name}". Renomeie um deles antes.`);
  }
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
  if (fromGroupId === toGroupId) throw new UserError('Escolha outro grupo de destino.');
  await db.transaction('rw', db.variants, db.groups, db.auditLogs, async () => {
    if (!(await db.groups.get(toGroupId))) throw new UserError('Grupo de destino não encontrado.');
    const vs = await db.variants.where('groupId').equals(fromGroupId).toArray();
    const target = await db.variants.where('groupId').equals(toGroupId).toArray();
    const clash = vs.filter((v) => !v.archivedAt && target.some((t) => !t.archivedAt && normalize(t.name) === normalize(v.name)));
    if (clash.length) throw new UserError(`O destino já tem: ${clash.map((v) => v.name).join(', ')}. Renomeie antes de transferir.`);
    let order = target.length;
    for (const v of vs) {
      await db.variants.update(v.id, { groupId: toGroupId, displayOrder: order++, updatedAt: nowIso() });
      await audit('variant', v.id, 'move', fromGroupId, toGroupId);
    }
  });
}

// ---------------- variações ----------------

export async function createVariant(input: {
  groupId: string; name: string; startQuantity?: number; minimumStock?: number | null; idealStock?: number | null;
  optionalPriceInCents?: number | null; color?: string; description?: string; notes?: string;
  /** Se informado, a quantidade inicial entra neste dia (se existir e estiver aberto). */
  dailyRecordId?: string | null;
}) {
  if (!input.groupId || typeof input.groupId !== 'string') throw new UserError('Escolha o grupo da cor (ou crie um grupo primeiro).');
  const name = cleanName(input.name, 'da variação');
  const qty = input.startQuantity ?? 0;
  if (!Number.isInteger(qty) || qty < 0 || qty > MAX_QTY) throw new UserError('Quantidade inválida.');
  validateNumbers(input);
  return db.transaction('rw', [db.variants, db.groups, db.dailyStockItems, db.dailyRecords, db.stockMovements, db.auditLogs, db.settings], async () => {
    if (!(await db.groups.get(input.groupId))) throw new UserError('Grupo não encontrado.');
    const siblings = await db.variants.where('groupId').equals(input.groupId).toArray();
    if (siblings.some((v) => !v.archivedAt && normalize(v.name) === normalize(name)))
      throw new UserError(`Já existe "${name}" neste grupo.`);
    const now = nowIso();
    const v: Variant = {
      id: uid(), groupId: input.groupId, name, description: input.description, color: input.color,
      displayOrder: siblings.length, active: true, archivedAt: null,
      minimumStock: input.minimumStock ?? null, idealStock: input.idealStock ?? null, startQuantity: qty,
      optionalPriceInCents: input.optionalPriceInCents ?? null, notes: input.notes, createdAt: now, updatedAt: now,
      // grupo novo (ainda sem cores): a primeira cor já nasce à venda e o grupo entra em ⭐ Para vender.
      // Guardar no estoque é uma escolha (Vender › Estoque ⇄ Venda).
      forSale: siblings.length === 0 ? true : await groupIsForSale(input.groupId),
    };
    await db.variants.add(v);
    if (siblings.length === 0) {
      const sell = await getSetting('sellGroups');
      if (!sell.some((e) => e.groupId === input.groupId)) await setSetting('sellGroups', [...sell, { groupId: input.groupId, highlight: false }]);
    }
    if (input.dailyRecordId) {
      const day = await db.dailyRecords.get(input.dailyRecordId);
      if (day && day.status === 'closed') throw new UserError('O dia está encerrado. Reabra para lançar a quantidade.');
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
  'name' | 'description' | 'color' | 'minimumStock' | 'idealStock' | 'optionalPriceInCents' | 'notes'>>) {
  return db.transaction('rw', db.variants, db.auditLogs, async () => {
    const v = await db.variants.get(id);
    if (!v) throw new UserError('Variação não encontrada.');
    if (patch.name !== undefined) {
      const name = cleanName(patch.name, '');
      const sib = await db.variants.where('groupId').equals(v.groupId).toArray();
      if (sib.some((x) => x.id !== id && !x.archivedAt && normalize(x.name) === normalize(name)))
        throw new UserError(`Já existe "${name}" neste grupo.`);
      patch.name = name;
      if (name !== v.name) await audit('variant', id, 'rename', v.name, name);
    }
    validateNumbers(patch);
    for (const k of ['minimumStock', 'idealStock', 'optionalPriceInCents'] as const)
      if (patch[k] !== undefined && patch[k] !== v[k]) await audit('variant', id, `set_${k}`, v[k], patch[k]);
    await db.variants.update(id, { ...patch, updatedAt: nowIso() });
  });
}

export async function setVariantActive(id: string, active: boolean) {
  await db.variants.update(id, { active, updatedAt: nowIso() });
  await audit('variant', id, active ? 'activate' : 'deactivate');
}

export async function archiveVariant(id: string, archived: boolean) {
  if (!archived) {
    const v = await db.variants.get(id);
    const sib = v ? await db.variants.where('groupId').equals(v.groupId).toArray() : [];
    if (v && sib.some((x) => x.id !== id && !x.archivedAt && normalize(x.name) === normalize(v.name)))
      throw new UserError(`O grupo já tem outra "${v.name}" ativa. Renomeie uma delas antes.`);
  }
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
  // se já foi cadastrado por outro caminho, só liga a seleção ao grupo existente
  const existing = (await db.groups.toArray()).find((x) => !x.archivedAt && normalize(x.name) === normalize(name));
  const g = existing ?? await createGroup({ name, icon: '👑' });
  await setForSale((await db.variants.where('groupId').equals(g.id).toArray()).map((v) => v.id), true);
  const sell = await getSetting('sellGroups');
  await setSetting('sellGroups', sell.map((s) => (s.pendingName === pendingName ? { groupId: g.id, highlight: s.highlight } : s)));
  return g;
}

/** Coloca ou tira peças da venda (ficam no estoque, só não aparecem em Vender). */
export async function setForSale(variantIds: string[], forSale: boolean) {
  await db.transaction('rw', db.variants, db.auditLogs, async () => {
    for (const id of variantIds) {
      const v = await db.variants.get(id);
      if (!v || (v.forSale !== false) === forSale) continue;
      await db.variants.update(id, { forSale, updatedAt: nowIso() });
      await audit('variant', id, forSale ? 'for_sale_on' : 'for_sale_off');
    }
  });
}

/** O grupo está em "Para vender" (ou já tem peça à venda)? Usado para a variação nova já nascer certa. */
async function groupIsForSale(groupId: string) {
  const sell = await getSetting('sellGroups');
  if (sell.some((e) => e.groupId === groupId)) return true;
  return (await db.variants.where('groupId').equals(groupId).toArray()).some((v) => v.forSale !== false && !v.archivedAt);
}
