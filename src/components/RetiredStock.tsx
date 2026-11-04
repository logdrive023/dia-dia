import { db } from '../db/db';
import type { Variant } from '../db/types';
import { normalize } from '../lib/util';
import { variantLabel } from '../services/catalog';
import { settleRetiredStock } from '../services/days';
import { useApp } from '../state';
import { useUi } from './ui';

/** Cores ativas do mesmo grupo com o mesmo nome (a “nova” de uma cor que foi recriada). */
export async function twinsOf(v: Variant) {
  const sib = await db.variants.where('groupId').equals(v.groupId).toArray();
  return sib.filter((x) => x.id !== v.id && !x.archivedAt && normalize(variantLabel(x)) === normalize(variantLabel(v)));
}

const pecas = (n: number) => `${n} ${n === 1 ? 'peça' : 'peças'}`;

/**
 * Cor que vai sair (arquivar/excluir) ou que já saiu e ainda tem peças hoje: pergunta o que fazer com elas.
 * Evita o caso real “Poa 7 + Poa 7 = 14”, quando só existiam 7 (a cor antiga continuava somando).
 * Retorna true para seguir (sem peças, resolvido ou mantido) e false se a pessoa voltou.
 */
export function useSettleRetired() {
  const { day } = useApp();
  const { choose, run } = useUi();
  return async (v: Variant, why: 'arquivar' | 'excluir' | 'resolver'): Promise<boolean> => {
    if (!day || day.status !== 'open') return true;
    const item = await db.dailyStockItems.where('[dailyRecordId+variantId]').equals([day.id, v.id]).first();
    const n = item?.currentQuantity ?? 0;
    if (n <= 0) return true;
    const twins = await twinsOf(v);
    const qty = new Map((await db.dailyStockItems.where('dailyRecordId').equals(day.id).toArray()).map((i) => [i.variantId, i.currentQuantity]));
    const t0 = twins[0];
    const options = [
      ...twins.map((t) => ({
        value: t.id, tone: 'primary' as const,
        label: <span className="block">➡️ Passar as {n} para “{variantLabel(t)}”<span className="block text-[12px] font-normal opacity-90">ela vai de {qty.get(t.id) ?? 0} para {(qty.get(t.id) ?? 0) + n}</span></span>,
      })),
      { value: 'zerar', tone: 'danger' as const,
        label: <span className="block">🗑️ Zerar: essas {n} não existem<span className="block text-[12px] font-normal opacity-90">eram repetidas / já contadas em outra cor</span></span> },
      ...(why === 'arquivar' ? [{ value: 'manter', label: <span className="block">📦 Manter separadas<span className="block text-[12px] font-normal text-slate-500">ficam como “cor antiga”, fora do total e de Vender</span></span> }] : []),
    ];
    const pick = await choose({
      title: `“${variantLabel(v)}” ainda tem ${pecas(n)} hoje`,
      message: t0
        ? <>Já existe outra <b>“{variantLabel(t0)}”</b> ativa com <b>{qty.get(t0.id) ?? 0}</b>. Conte as peças na loja: se as {n} já estão contadas nela, <b>zere</b>. Se são peças a mais, <b>passe</b> para ela.</>
        : <>Conte as peças na loja. Se elas não existem, <b>zere</b>.{why === 'excluir' && <> Se existem, volte e use <b>Mover</b> ou <b>Arquivar</b> em vez de excluir.</>}</>,
      options,
    });
    if (pick === null) return false;
    if (pick === 'manter') return true;
    const r = await run(() => settleRetiredStock(day.id, v.id, pick === 'zerar' ? null : pick),
      pick === 'zerar' ? `${variantLabel(v)}: ${pecas(n)} zeradas` : `${pecas(n)} passaram para ${variantLabel(twins.find((t) => t.id === pick)!)}`);
    return r !== undefined;
  };
}
