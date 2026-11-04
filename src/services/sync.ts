/**
 * Juntar celulares: um celular gera um código (texto em base64 com TUDO), o outro importa e as
 * vendas se SOMAM (diferente do "Passar para outro celular", que substitui tudo).
 *
 * Regras:
 *  - produtos casam por nome (grupo + cor): cada celular gerou os próprios identificadores;
 *  - dias casam pela data; vendas, peças, lançamentos e movimentos casam pelo identificador (não duplicam);
 *  - venda cancelada em um celular fica cancelada; venda mexida dos dois lados: vale a versão com mais mudanças;
 *  - diária automática e linhas do caderno não duplicam; o que foi apagado (✕) não volta;
 *  - o estoque de cada dia é refeito a partir dos movimentos;
 *  - antes de juntar, guarda uma cópia ("Voltar como estava").
 * Importar o mesmo código duas vezes não muda nada.
 */
import { REPORT_PREFS_AT } from './settings';
import { db } from '../db/db';
import type {
  CashMovement, CashRecord, DailyRecord, DailyStockItem, Group, Order, Reservation, Sale, StockMovement, Variant, ImportRecord,
} from '../db/types';
import { normalize, nowIso, uid } from '../lib/util';
import { buildBackup, summarizeBackup, validateBackup, type BackupFile } from './backup';

const TOMB_KEY = 'tombstones';
const TOMB_MAX = 5000;

/** Guarda ids apagados (para não voltarem ao juntar com outro celular). Use dentro de transação com db.settings. */
export async function addTombstones(ids: string[]) {
  if (!ids.length) return;
  const row = await db.settings.where('key').equals(TOMB_KEY).first();
  const list = [...new Set([...((row?.value as string[] | undefined) ?? []), ...ids])].slice(-TOMB_MAX);
  if (row) await db.settings.update(row.id, { value: list });
  else await db.settings.add({ id: uid(), key: TOMB_KEY, value: list });
}

export interface MergeResult { days: number; orders: number; cash: number; variants: number; groups: number; moves: number
  /** peças que ficaram negativas: os dois celulares venderam a mesma última peça */
  oversold: string[] }

type Rows<T> = T[];

export async function mergeBackup(raw: unknown): Promise<MergeResult> {
  const b: BackupFile = validateBackup(raw);
  const d = b.data as unknown as {
    groups: Rows<Group>; variants: Rows<Variant>; dailyRecords: Rows<DailyRecord>; dailyStockItems: Rows<DailyStockItem>;
    stockMovements: Rows<StockMovement>; orders: Rows<Order>; sales: Rows<Sale>; reservations: Rows<Reservation>;
    cashRecords: Rows<CashRecord>; cashMovements: Rows<CashMovement>; settings: Rows<{ id: string; key: string; value: unknown }>;
    auditLogs: Rows<{ id: string }>;
  };

  // cópia de segurança antes de juntar
  const current = await buildBackup();
  const s = summarizeBackup(current);
  await db.safety.put({ id: 'last', createdAt: nowIso(), json: JSON.stringify(current),
    summary: `${s.days} dia(s) · ${s.orders} venda(s) · ${s.variants} cores/modelos` });

  const res: MergeResult = { days: 0, orders: 0, cash: 0, variants: 0, groups: 0, moves: 0, oversold: [] };
  await db.transaction('rw', db.allTables, async () => {
    // ---- o que foi apagado em qualquer um dos dois não volta
    const localTomb = ((await db.settings.where('key').equals(TOMB_KEY).first())?.value as string[] | undefined) ?? [];
    const inTomb = (d.settings.find((x) => x.key === TOMB_KEY)?.value as string[] | undefined) ?? [];
    const tomb = new Set([...localTomb, ...inTomb]);
    await addTombstones(inTomb);
    for (const id of inTomb) { await db.cashMovements.delete(id); await db.sales.delete(id); }

    // ---- grupos e cores: por id, senão por nome
    const gMap = new Map<string, string>();
    const localGroups = await db.groups.toArray();
    for (const g of d.groups) {
      const same = localGroups.find((x) => x.id === g.id) ?? localGroups.find((x) => normalize(x.name) === normalize(g.name) && !x.archivedAt)
        ?? localGroups.find((x) => normalize(x.name) === normalize(g.name));
      if (same) { gMap.set(g.id, same.id); continue; }
      await db.groups.add(g); localGroups.push(g); gMap.set(g.id, g.id); res.groups++;
    }
    const vMap = new Map<string, string>();
    const localVariants = await db.variants.toArray();
    for (const v of d.variants) {
      if (tomb.has(v.id)) continue;
      const groupId = gMap.get(v.groupId) ?? v.groupId;
      const sameName = (x: typeof v) => x.groupId === groupId && normalize(x.name) === normalize(v.name) && (x.size ?? null) === (v.size ?? null);
      const old = !!(v.archivedAt || v.deletedAt);
      const same = localVariants.find((x) => x.id === v.id)
        ?? localVariants.find((x) => sameName(x) && !!(x.archivedAt || x.deletedAt) === old)
        // cor ativa de lá casa com a ativa daqui; cor ANTIGA de lá nunca entra na ativa daqui (vira cor antiga aqui também)
        ?? (old ? undefined : localVariants.find((x) => sameName(x)));
      if (same) { vMap.set(v.id, same.id); continue; }
      const nv = { ...v, groupId };
      await db.variants.add(nv); localVariants.push(nv); vMap.set(v.id, v.id); res.variants++;
    }
    const mv = (id: string) => vMap.get(id) ?? id;

    // ---- dias: pela data
    const dMap = new Map<string, string>();
    const touchedDays = new Set<string>();
    const localDays = await db.dailyRecords.toArray();
    // situação do dia (aberto/encerrado): vale o que foi feito por último nos dois celulares
    // (encerrar, encerrar sozinho na virada ou reabrir de propósito)
    const statusAt = (x: DailyRecord) => (x.status === 'closed' ? (x.closedAt ?? x.updatedAt ?? '') : (x.reopenedAt ?? ''));
    const statusChanged = new Set<string>();
    for (const day of d.dailyRecords) {
      const same = localDays.find((x) => x.date === day.date);
      if (same) {
        dMap.set(day.id, same.id); touchedDays.add(same.id);
        if (same.status !== day.status && statusAt(day) > statusAt(same)) {
          const patch = { status: day.status, closedAt: day.closedAt ?? null, autoClosedAt: day.autoClosedAt ?? null, reopenedAt: day.reopenedAt ?? null };
          await db.dailyRecords.update(same.id, patch); Object.assign(same, patch); statusChanged.add(same.id);
        }
        continue;
      }
      await db.dailyRecords.add(day); localDays.push(day); dMap.set(day.id, day.id); touchedDays.add(day.id); res.days++;
    }
    const md = (id: string) => dMap.get(id) ?? id;

    // estoque do dia: dia novo traz o seu; dia que já existe mantém o início daqui (cor nova entra)
    for (const it of d.dailyStockItems) {
      const dayId = md(it.dailyRecordId), variantId = mv(it.variantId);
      const has = await db.dailyStockItems.where('[dailyRecordId+variantId]').equals([dayId, variantId]).first();
      if (!has) await db.dailyStockItems.add({ ...it, id: uid(), dailyRecordId: dayId, variantId });
    }

    // caixa de cada dia: um registro por dia (dia novo traz o seu; conferido/diária somam)
    for (const cr of d.cashRecords) {
      const dayId = md(cr.dailyRecordId);
      const has = await db.cashRecords.where('dailyRecordId').equals(dayId).first();
      if (!has) { await db.cashRecords.add({ ...cr, id: uid(), dailyRecordId: dayId }); continue; }
      const patch: Partial<CashRecord> = {};
      if ((has.countedBalanceInCents ?? null) === null && cr.countedBalanceInCents != null) patch.countedBalanceInCents = cr.countedBalanceInCents;
      if (cr.dailyPayDone && !has.dailyPayDone) patch.dailyPayDone = true;
      if (Object.keys(patch).length) await db.cashRecords.update(has.id, patch);
    }
    // o caixa do dia acompanha a situação do dia
    for (const id of statusChanged) {
      const cr = await db.cashRecords.where('dailyRecordId').equals(id).first();
      const day = localDays.find((x) => x.id === id);
      if (cr && day) await db.cashRecords.update(cr.id, { status: day.status });
    }

    // ---- importações (texto colado e o que mudou): entram pelo id, não duplicam
    for (const im of (d as unknown as { imports?: Rows<ImportRecord> }).imports ?? []) {
      if (await db.imports.get(im.id)) continue;
      await db.imports.add({ ...im, dailyRecordId: md(im.dailyRecordId), lines: im.lines.map((l) => ({ ...l, variantId: mv(l.variantId) })) });
    }

    // ---- chaves da mensagem do WhatsApp: vale o celular que mudou por último
    const inPrefsAt = d.settings.find((x) => x.key === REPORT_PREFS_AT)?.value as string | undefined;
    const localPrefsAt = (await db.settings.where('key').equals(REPORT_PREFS_AT).first())?.value as string | undefined;
    if (inPrefsAt && (!localPrefsAt || inPrefsAt > localPrefsAt)) {
      // o outro celular manda em todas: chave que ele nunca mudou volta ao padrão aqui também
      const inKeys = new Set(d.settings.filter((x) => x.key.startsWith('report')).map((x) => x.key));
      for (const row of await db.settings.toArray())
        if (row.key.startsWith('report') && !inKeys.has(row.key)) await db.settings.delete(row.id);
      for (const row of d.settings.filter((x) => x.key.startsWith('report'))) {
        const has = await db.settings.where('key').equals(row.key).first();
        if (has) await db.settings.update(has.id, { value: row.value });
        else await db.settings.add({ id: uid(), key: row.key, value: row.value });
      }
    }

    // ---- vendas: por id; mexida dos dois lados → vale a versão com mais mudanças (movimentos)
    const inCashByOrder = new Map<string, number>(), inMovesByOrder = new Map<string, number>();
    for (const c of d.cashMovements) if (c.relatedOrderId) inCashByOrder.set(c.relatedOrderId, (inCashByOrder.get(c.relatedOrderId) ?? 0) + 1);
    for (const m of d.stockMovements) if (m.orderId) inMovesByOrder.set(m.orderId, (inMovesByOrder.get(m.orderId) ?? 0) + 1);
    const inSalesByOrder = new Map<string, Sale[]>();
    for (const x of d.sales) if (!tomb.has(x.id)) inSalesByOrder.set(x.orderId, [...(inSalesByOrder.get(x.orderId) ?? []), x]);
    const mapSale = (x: Sale): Sale => ({ ...x, dailyRecordId: md(x.dailyRecordId), variantId: mv(x.variantId) });
    for (const o of d.orders) {
      const mo = { ...o, dailyRecordId: md(o.dailyRecordId) };
      const local = await db.orders.get(o.id);
      const inSales = (inSalesByOrder.get(o.id) ?? []).map(mapSale);
      if (!local) { await db.orders.add(mo); await db.sales.bulkPut(inSales); res.orders++; continue; }
      const localScore = (await db.cashMovements.where('relatedOrderId').equals(o.id).count()) + (await db.stockMovements.filter((m) => m.orderId === o.id).count());
      const inScore = (inCashByOrder.get(o.id) ?? 0) + (inMovesByOrder.get(o.id) ?? 0);
      const cancelledThere = o.status === 'cancelled' && local.status !== 'cancelled';
      // Pix conferido: vale a conferência mais recente dos dois celulares (conferir não gera movimento)
      const pix = (o.pixConfirmedAt ?? '') > (local.pixConfirmedAt ?? '')
        ? { pixConfirmedAt: o.pixConfirmedAt, pixConfirmedCents: o.pixConfirmedCents ?? null }
        : { pixConfirmedAt: local.pixConfirmedAt ?? null, pixConfirmedCents: local.pixConfirmedCents ?? null };
      if (cancelledThere || inScore > localScore) {
        await db.orders.put({ ...mo, ...pix });
        await db.sales.where('orderId').equals(o.id).delete();
        await db.sales.bulkPut(inSales);
      } else if (pix.pixConfirmedAt !== (local.pixConfirmedAt ?? null)) {
        await db.orders.update(o.id, pix);
      }
    }

    // ---- movimentos de estoque: só acrescentam
    for (const m of d.stockMovements) {
      if (await db.stockMovements.get(m.id)) continue;
      await db.stockMovements.add({ ...m, dailyRecordId: md(m.dailyRecordId), variantId: mv(m.variantId) }); res.moves++;
    }

    // ---- reservas: por id; cancelada/convertida ganha de ativa
    for (const r of d.reservations) {
      const local = await db.reservations.get(r.id);
      const mr = { ...r, dailyRecordId: md(r.dailyRecordId), variantId: mv(r.variantId) };
      if (!local) await db.reservations.add(mr);
      else if (local.status === 'active' && r.status !== 'active') await db.reservations.put(mr);
    }

    // ---- caixa: por id; diária e caderno não duplicam; apagado não volta
    const dateOf = new Map(localDays.map((x) => [x.id, x.date]));
    const keyOf = (c: CashMovement) => {
      if (c.relatedOrderId) return null;
      const date = dateOf.get(c.dailyRecordId) ?? c.dailyRecordId;
      if (c.type === 'pagamento' && c.description?.startsWith('diária de ')) return `${date}|diaria|${c.description}`;
      if (c.description?.includes('caderno')) return `${date}|${c.type}|${c.amountInCents}|${c.createdAt}|${c.description}`;
      return null;
    };
    const localKeys = new Set((await db.cashMovements.toArray()).map(keyOf).filter(Boolean) as string[]);
    for (const c of d.cashMovements) {
      if (tomb.has(c.id) || (await db.cashMovements.get(c.id))) continue;
      const mc = { ...c, dailyRecordId: md(c.dailyRecordId) };
      const k = keyOf(mc);
      if (k && localKeys.has(k)) continue;
      if (k) localKeys.add(k);
      await db.cashMovements.add(mc); res.cash++;
    }

    // ---- histórico de auditoria: só acrescenta
    for (const a of d.auditLogs) if (!(await db.auditLogs.get(a.id))) await db.auditLogs.add(a as never);

    // ---- estoque de cada dia mexido = início + movimentos
    for (const dayId of touchedDays) {
      const moves = await db.stockMovements.where('dailyRecordId').equals(dayId).toArray();
      const sum = new Map<string, number>();
      for (const m of moves) sum.set(m.variantId, (sum.get(m.variantId) ?? 0) + m.quantity);
      for (const it of await db.dailyStockItems.where('dailyRecordId').equals(dayId).toArray()) {
        const q = it.initialQuantity + (sum.get(it.variantId) ?? 0);
        if (q !== it.currentQuantity) await db.dailyStockItems.update(it.id, { currentQuantity: q });
        if (q < 0) {
          const v = localVariants.find((x) => x.id === it.variantId);
          const g = v && localGroups.find((x) => x.id === v.groupId);
          res.oversold.push(`${g?.name ?? ''} ${v?.name ?? ''} (${q})`.trim());
        }
      }
    }
  });
  return res;
}
