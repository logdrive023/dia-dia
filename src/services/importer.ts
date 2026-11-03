/**
 * Importação em quantidade: cola um texto com grupos, produtos (e tamanhos) e quantidades.
 * 1) lê o texto, 2) compara com o catálogo e mostra a prévia (nada é aplicado),
 * 3) confirma: tudo numa transação só, com o texto original guardado, 4) dá para desfazer
 * sem apagar nada e sem passar por cima do que aconteceu depois (vendas, saídas).
 *
 * Formatos aceitos (pode misturar):
 *   Plomo            ← linha sem número = grupo
 *   Azul: 6          ← produto: quantidade   (também “Azul 6”, “Azul = 6”, “• Cor Azul: 6”)
 *   Azul · P: 3      ← com tamanho           (também “Azul (P): 3” ou “Azul P: 3” se P for um tamanho)
 *   Lila > Rosa > 4  ← tudo numa linha       (também “Lila; Rosa; 4”, “Lila | Rosa | M | 2” ou separado por tab)
 */
import { db } from '../db/db';
import type { EntryKind, Group, ImportLine, ImportRecord, Variant } from '../db/types';
import { MAX_QTY, normalize, nowIso, todayStr, uid } from '../lib/util';
import { actor } from '../lib/actor';
import { audit } from './audit';
import { applyStockDelta } from './days';
import { cleanSize, createGroup, createVariant, sameProduct, UserError, variantLabel } from './catalog';

export interface ParsedLine {
  lineNo: number;
  raw: string;
  group: string;
  name: string;
  size: string | null;
  /** null = linha sem quantidade (ex.: modelo ainda não preenchido) */
  qty: number | null;
  error?: string;
}

const SEP = /\s*(?:>|;|\||\t)\s*/;

/** Lê o texto colado. Não olha o catálogo (isso é a prévia). */
export function parseImportText(text: string, sizes: string[]): ParsedLine[] {
  const sizeSet = new Set(sizes.map((s) => s.toUpperCase()));
  const out: ParsedLine[] = [];
  let group = '';
  const splitSize = (name: string): [string, string | null] => {
    let m = name.match(/^(.*?)\s*[·(/]\s*([^)·/]+?)\s*\)?\s*$/);
    if (m && m[1] && sizeSet.has(m[2].toUpperCase())) return [m[1].trim(), m[2].toUpperCase()];
    m = name.match(/^(.*\S)\s+(\S+)$/);
    if (m && sizeSet.has(m[2].toUpperCase())) return [m[1].trim(), m[2].toUpperCase()];
    return [name.trim(), null];
  };
  text.split(/\r?\n/).forEach((rawLine, idx) => {
    const raw = rawLine.trim();
    if (!raw || raw.startsWith('#') || raw.startsWith('//')) return;
    // tira enfeites: marcadores, emojis do começo, asteriscos do WhatsApp e o “Cor ” do relatório
    const clean = raw.replace(/\*/g, '').replace(/^[\s•\-–*·▪️➤]+/u, '').replace(/^\p{Extended_Pictographic}+️?\s*/u, '').replace(/^Cor\s+/i, '').trim();
    const lineNo = idx + 1;
    if (SEP.test(clean) && clean.split(SEP).length >= 2) {
      const parts = clean.split(SEP).filter(Boolean);
      const last = parts[parts.length - 1];
      const qty = /^\d+$/.test(last) ? Number(last) : null;
      const names = qty === null ? parts : parts.slice(0, -1);
      if (names.length === 1) { // “Rosa; 4” dentro de um grupo
        if (!group) { out.push({ lineNo, raw, group: '', name: names[0], size: null, qty, error: 'Falta o grupo: escreva o grupo numa linha antes, ou “Grupo > Produto > quantidade”.' }); return; }
        const [name, size] = splitSize(names[0]);
        out.push({ lineNo, raw, group, name, size, qty });
        return;
      }
      const g = names[0], n = names[1], s = names[2] ?? null;
      const [name, size] = s ? [n, s.toUpperCase()] : splitSize(n);
      out.push({ lineNo, raw, group: g, name, size, qty, error: qty !== null && qty > MAX_QTY ? 'Quantidade grande demais.' : undefined });
      return;
    }
    // “Azul: 6” — o primeiro número depois do “:” (aceita o “• Cor Azul: 6 ⚠️ repor 1” do relatório)
    let m = clean.match(/^(.+?)\s*[:=]\s*(\d*)/);
    if (m) {
      const qty = m[2] ? Number(m[2]) : null;
      // “Plomo:” antes de qualquer grupo = nome do grupo
      if (!group && qty === null) { group = m[1].trim(); return; }
      if (!group) { out.push({ lineNo, raw, group: '', name: m[1], size: null, qty, error: 'Falta o grupo: escreva o grupo numa linha antes.' }); return; }
      const [name, size] = splitSize(m[1]);
      out.push({ lineNo, raw, group, name, size, qty, error: qty !== null && qty > MAX_QTY ? 'Quantidade grande demais.' : undefined });
      return;
    }
    m = clean.match(/^(.+?)\s+-?\s*(\d+)$/);
    if (m && group) {
      const [name, size] = splitSize(m[1]);
      const qty = Number(m[2]);
      out.push({ lineNo, raw, group, name, size, qty, error: qty > MAX_QTY ? 'Quantidade grande demais.' : undefined });
      return;
    }
    if (/\d/.test(clean) && !group) { out.push({ lineNo, raw, group: '', name: clean, size: null, qty: null, error: 'Não entendi esta linha. Use “Produto: quantidade” abaixo do grupo.' }); return; }
    // linha sem número: é o nome do grupo (tira “(385 peças)” e afins)
    group = clean.replace(/\(.*\)\s*$/, '').replace(/:\s*$/, '').trim();
  });
  return out;
}

export type PlanStatus = 'existe' | 'nova' | 'parecida' | 'erro' | 'vazia';

export interface PlanLine extends ParsedLine {
  key: string;
  status: PlanStatus;
  groupId: string | null;
  /** grupo que ainda não existe (vai ser criado) */
  newGroup: boolean;
  variantId: string | null;
  /** parecidas no catálogo (a pessoa escolhe: é uma delas ou é nova) */
  candidates: { id: string; label: string }[];
  /** escolha da pessoa para uma “parecida”: id da existente ou 'nova' */
  choice?: string;
  before: number;
  delta: number;
  after: number;
  forSale: boolean;
  include: boolean;
  message?: string;
}

export interface PlanOptions { op: 'somar' | 'definir'; newForSale: boolean; sizes: string[] }

function lev(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** Prévia: compara cada linha com o catálogo e o estoque de hoje. Não grava nada. */
export async function buildImportPlan(text: string, opts: PlanOptions) {
  const today = await db.dailyRecords.where('date').equals(todayStr()).first();
  const [groups, variants, items, reservations] = await Promise.all([
    db.groups.toArray(), db.variants.toArray(),
    today ? db.dailyStockItems.where('dailyRecordId').equals(today.id).toArray() : Promise.resolve([]),
    db.reservations.where('status').equals('active').toArray(),
  ]);
  const stockOf = new Map(items.map((i) => [i.variantId, i.currentQuantity]));
  const reservedOf = new Map<string, number>();
  for (const r of reservations) reservedOf.set(r.variantId, (reservedOf.get(r.variantId) ?? 0) + r.quantity);
  const live = (v: Variant) => !v.deletedAt && !v.archivedAt;
  const findGroup = (name: string): Group | undefined =>
    groups.find((g) => !g.archivedAt && normalize(g.name) === normalize(name)) ?? groups.find((g) => normalize(g.name) === normalize(name));
  const running = new Map<string, number>(); // mesma peça duas vezes no texto: soma em sequência
  const seenDefinir = new Set<string>();
  const lines: PlanLine[] = parseImportText(text, opts.sizes).map((p) => {
    const base: PlanLine = { ...p, key: `${p.lineNo}`, status: 'nova', groupId: null, newGroup: false, variantId: null, candidates: [], before: 0, delta: 0, after: 0, forSale: opts.newForSale, include: true };
    if (p.error) return { ...base, status: 'erro', include: false, message: p.error };
    if (p.qty === null) return { ...base, status: 'vazia', include: false, message: 'Sem quantidade (fica de fora)' };
    const g = findGroup(p.group);
    if (!g) {
      const similar = groups.filter((x) => !x.archivedAt && lev(normalize(x.name), normalize(p.group)) <= 2).map((x) => x.name);
      return { ...base, status: 'nova', newGroup: true, delta: p.qty, after: p.qty,
        message: `Grupo novo “${p.group}”${similar.length ? ` — confira se não é “${similar.join('” ou “')}”` : ''}` };
    }
    const inGroup = variants.filter((v) => v.groupId === g.id);
    const exact = inGroup.find((v) => live(v) && sameProduct(v, p.name, p.size));
    const withStock = (v: Variant) => {
      const now = running.get(v.id) ?? stockOf.get(v.id) ?? 0;
      const after = opts.op === 'somar' ? now + p.qty! : p.qty!;
      return { before: now, delta: after - now, after };
    };
    if (exact) {
      const q = withStock(exact);
      if (opts.op === 'definir' && seenDefinir.has(exact.id)) return { ...base, status: 'erro', include: false, groupId: g.id, variantId: exact.id, message: 'Este produto aparece duas vezes no texto.' };
      seenDefinir.add(exact.id);
      const reserved = reservedOf.get(exact.id) ?? 0;
      if (q.after < reserved) return { ...base, ...q, status: 'erro', include: false, groupId: g.id, variantId: exact.id, message: `Ficaria com ${q.after}, mas tem ${reserved} reservada(s).` };
      running.set(exact.id, q.after);
      return { ...base, ...q, status: 'existe', groupId: g.id, variantId: exact.id, forSale: exact.forSale !== false };
    }
    const n = normalize(p.name);
    const candidates = inGroup.filter((v) => !v.deletedAt && (lev(normalize(v.name), n) <= 2 || normalize(v.name).startsWith(n) || n.startsWith(normalize(v.name)) || (normalize(v.name) === n)))
      .map((v) => ({ id: v.id, label: `${variantLabel(v)}${v.archivedAt ? ' (arquivada)' : ''}` }));
    if (candidates.length) return { ...base, status: 'parecida', groupId: g.id, candidates, delta: p.qty, after: p.qty, message: 'Parecido com um produto que já existe: escolha se é ele ou se é novo.' };
    return { ...base, status: 'nova', groupId: g.id, delta: opts.op === 'somar' ? p.qty : p.qty, after: p.qty };
  });
  return { lines, todayId: today?.status === 'open' ? today.id : null };
}

/** Uma “parecida” escolhida como existente: recalcula antes/depois com o estoque dela. */
export async function resolveChoice(line: PlanLine, choice: string, opts: PlanOptions): Promise<PlanLine> {
  if (choice === 'nova') return { ...line, choice, before: 0, delta: line.qty ?? 0, after: line.qty ?? 0 };
  const today = await db.dailyRecords.where('date').equals(todayStr()).first();
  const now = today ? (await db.dailyStockItems.where('[dailyRecordId+variantId]').equals([today.id, choice]).first())?.currentQuantity ?? 0 : 0;
  const after = opts.op === 'somar' ? now + (line.qty ?? 0) : line.qty ?? 0;
  return { ...line, choice, variantId: choice, before: now, delta: after - now, after };
}

/** Confere se a prévia pode ser confirmada (sem erro escondido, sem “parecida” sem escolha). */
export function planProblems(lines: PlanLine[]) {
  const pending = lines.filter((l) => l.include && l.status === 'parecida' && !l.choice);
  return { pending, ready: lines.some((l) => l.include && (l.status === 'existe' || l.status === 'nova' || (l.status === 'parecida' && !!l.choice))) && !pending.length };
}

/**
 * Aplica a importação numa transação só (ou tudo, ou nada). Produto novo: cria (origem “importação”)
 * e lança a entrada como mercadoria nova. Existente: entrada (somar) ou contagem (definir).
 */
export async function applyImport(text: string, lines: PlanLine[], opts: PlanOptions & { entryKind: EntryKind }) {
  // primeiro a escolha das “parecidas” (senão a mensagem seria “nada para importar”)
  if (planProblems(lines).pending.length) throw new UserError('Escolha o que é cada produto parecido antes de confirmar.');
  const use = lines.filter((l) => l.include && (l.status === 'existe' || l.status === 'nova' || (l.status === 'parecida' && l.choice)));
  if (!use.length) throw new UserError('Nada para importar.');
  return db.transaction('rw', [db.groups, db.variants, db.dailyRecords, db.dailyStockItems, db.stockMovements, db.reservations, db.settings, db.auditLogs, db.imports], async () => {
    const day = await db.dailyRecords.where('date').equals(todayStr()).first();
    if (!day || day.status !== 'open') throw new UserError('Inicie o dia de hoje antes de importar (a mercadoria entra hoje).');
    const id = uid();
    const result: ImportLine[] = [];
    const groupIds = new Map<string, string>();
    for (const l of use) {
      let groupId = l.groupId, createdGroup = false;
      if (!groupId) {
        const k = normalize(l.group);
        groupId = groupIds.get(k) ?? null;
        if (!groupId) {
          const existing = (await db.groups.toArray()).find((g) => !g.archivedAt && normalize(g.name) === k);
          groupId = existing ? existing.id : (await createGroup({ name: l.group })).id;
          createdGroup = !existing;
          groupIds.set(k, groupId);
        }
      }
      let variantId = l.status === 'parecida' && l.choice !== 'nova' ? l.choice! : l.variantId;
      let created = false;
      if (!variantId || (l.status === 'parecida' && l.choice === 'nova')) {
        const v = await createVariant({ groupId, name: l.name, size: cleanSize(l.size), startQuantity: 0, intoToday: true, origin: 'importacao', forSale: l.forSale });
        variantId = v.id; created = true;
      }
      const item = await db.dailyStockItems.where('[dailyRecordId+variantId]').equals([day.id, variantId]).first();
      const before = item?.currentQuantity ?? 0;
      const after = opts.op === 'somar' ? before + (l.qty ?? 0) : l.qty ?? 0;
      const delta = after - before;
      if (delta < 0) {
        const reserved = (await db.reservations.where('variantId').equals(variantId).toArray()).filter((r) => r.status === 'active').reduce((n, r) => n + r.quantity, 0);
        if (after < reserved) throw new UserError(`${l.name}: ficaria com ${after}, mas tem ${reserved} reservada(s).`);
      }
      let movementId: string | null = null;
      if (delta !== 0) {
        const mv = delta > 0
          ? await applyStockDelta(day.id, variantId, delta, 'entrada', { entryKind: created ? 'nova' : opts.entryKind, importId: id })
          : await applyStockDelta(day.id, variantId, delta, 'ajuste', { importId: id, description: 'Contagem (importação)' });
        movementId = mv.id;
      }
      result.push({ variantId, groupName: l.group, name: l.name, size: cleanSize(l.size), created, createdGroup, before, delta, after, movementId, forSale: l.forSale });
    }
    const rec: ImportRecord = { id, createdAt: nowIso(), dailyRecordId: day.id, date: day.date, by: actor(), text, op: opts.op, lines: result, status: 'aplicada' };
    await db.imports.add(rec);
    await audit('import', id, 'apply', null, { lines: result.length, units: result.reduce((n, r) => n + r.delta, 0) });
    return rec;
  });
}

export interface UndoLine { variantId: string; label: string; now: number; delta: number; after: number; ok: boolean; reason?: string }

/** O que desfazer faria agora (antes de confirmar): linha por linha, com o motivo quando não dá. */
export async function undoImportPreview(importId: string): Promise<{ rec: ImportRecord | undefined; lines: UndoLine[]; todayOpen: boolean }> {
  const rec = await db.imports.get(importId);
  const today = await db.dailyRecords.where('date').equals(todayStr()).first();
  if (!rec) return { rec, lines: [], todayOpen: !!today && today.status === 'open' };
  const undone = new Set((await db.stockMovements.toArray()).map((m) => m.reversedMovementId).filter(Boolean) as string[]);
  const out: UndoLine[] = [];
  for (const l of rec.lines) {
    const label = `${l.groupName} › ${l.name}${l.size ? ` · ${l.size}` : ''}`;
    if (!l.movementId || !l.delta) { out.push({ variantId: l.variantId, label, now: l.after, delta: 0, after: l.after, ok: false, reason: 'Não mexeu no estoque.' }); continue; }
    if (undone.has(l.movementId)) { out.push({ variantId: l.variantId, label, now: 0, delta: 0, after: 0, ok: false, reason: 'Já foi desfeita.' }); continue; }
    const now = today ? (await db.dailyStockItems.where('[dailyRecordId+variantId]').equals([today.id, l.variantId]).first())?.currentQuantity ?? 0 : 0;
    const reserved = (await db.reservations.where('variantId').equals(l.variantId).toArray()).filter((r) => r.status === 'active').reduce((n, r) => n + r.quantity, 0);
    const after = now - l.delta;
    if (after < 0) out.push({ variantId: l.variantId, label, now, delta: -l.delta, after, ok: false, reason: `Depois da importação saíram peças (vendas ou saídas): hoje tem ${now}, desfazer tiraria ${l.delta}.` });
    else if (after < reserved) out.push({ variantId: l.variantId, label, now, delta: -l.delta, after, ok: false, reason: `Ficaria com ${after}, mas tem ${reserved} reservada(s).` });
    else out.push({ variantId: l.variantId, label, now, delta: -l.delta, after, ok: true });
  }
  return { rec, lines: out, todayOpen: !!today && today.status === 'open' };
}

/**
 * Desfaz a importação no dia de hoje: cada entrada ganha um movimento inverso ligado a ela
 * (o original fica). Linha que não dá (vendeu depois, reservas) fica como está e o motivo é guardado.
 */
export async function undoImport(importId: string) {
  return db.transaction('rw', [db.imports, db.dailyRecords, db.dailyStockItems, db.stockMovements, db.reservations, db.auditLogs], async () => {
    const { rec, lines, todayOpen } = await undoImportPreview(importId);
    if (!rec) throw new UserError('Importação não encontrada.');
    if (rec.status === 'desfeita') throw new UserError('Esta importação já foi desfeita.');
    if (!todayOpen) throw new UserError('Inicie o dia de hoje para desfazer (o desfazimento entra hoje).');
    const today = (await db.dailyRecords.where('date').equals(todayStr()).first())!;
    let done = 0;
    const skipped: { variantId: string; reason: string }[] = [];
    for (const [i, l] of lines.entries()) {
      const orig = rec.lines[i];
      if (!l.ok) { if (l.reason && l.reason !== 'Não mexeu no estoque.' && l.reason !== 'Já foi desfeita.') skipped.push({ variantId: l.variantId, reason: l.reason }); continue; }
      await applyStockDelta(today.id, l.variantId, l.delta, 'correcao', { reversedMovementId: orig.movementId!, importId, description: 'Desfazer importação' });
      done++;
    }
    const status = skipped.length ? 'parcial' : 'desfeita';
    await db.imports.update(importId, { status, undoneAt: nowIso(), undoSkipped: skipped });
    await audit('import', importId, 'undo', null, { done, skipped: skipped.length });
    return { done, skipped };
  });
}

/** Modelo para copiar: o catálogo de hoje (grupos e produtos ativos), só faltando as quantidades. */
export async function importTemplate() {
  const [groups, variants] = await Promise.all([db.groups.toArray(), db.variants.toArray()]);
  const L: string[] = [];
  for (const g of groups.filter((x) => !x.archivedAt).sort((a, b) => a.displayOrder - b.displayOrder)) {
    const vs = variants.filter((v) => v.groupId === g.id && !v.archivedAt && !v.deletedAt).sort((a, b) => a.displayOrder - b.displayOrder);
    if (!vs.length) continue;
    if (L.length) L.push('');
    L.push(g.name);
    for (const v of vs) L.push(`${variantLabel(v)}: `);
  }
  return L.join('\n');
}
