/**
 * Telas de apoio (só ajudam a decidir; não mudam nenhuma regra antiga):
 * - Contagem da loja: contar tudo de uma vez, ver antes → depois e só então gravar.
 * - Mais vendidas, paradas e lucro: por período.
 */
import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { money, normalize } from '../lib/util';
import { variantLabel } from '../services/catalog';
import { loadStockRows, type StockRow } from '../services/summary';
import { applyCount, condicionalByVariant, salesInsights } from '../services/insights';
import { useApp } from '../state';
import { Button, Card, Chip, Empty, Input, Sheet, Swatch, useBusy, useUi } from '../components/ui';

const isOld = (r: StockRow) => !!(r.variant.archivedAt || r.variant.deletedAt || r.group.archivedAt);

/** Contagem da loja: digite o que contou em cada cor. Vazio = não contou (não muda). */
export function CountSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { day } = useApp();
  const { run, confirm, toast } = useUi();
  const [busy, wrap] = useBusy();
  const [q, setQ] = useState('');
  const [counts, setCounts] = useState<Record<string, string>>({});
  const data = useLiveQuery(async () => {
    if (!day) return null;
    const [rows, out] = await Promise.all([loadStockRows(day.id, day.date), condicionalByVariant()]);
    return { rows: rows.filter((r) => !isOld(r)), out };
  }, [day?.id]);
  const diffs = useMemo(() => {
    if (!data) return [];
    return data.rows.flatMap((r) => {
      const t = counts[r.variant.id];
      if (t === undefined || t.trim() === '') return [];
      const n = Number(t);
      if (!Number.isInteger(n) || n < 0) return [];
      const to = n + (data.out.get(r.variant.id) ?? 0);
      return to === r.item.currentQuantity ? [] : [{ r, counted: n, to, delta: to - r.item.currentQuantity }];
    });
  }, [data, counts]);
  if (!open) return null;
  const locked = day?.status !== 'open';
  const typed = Object.values(counts).filter((t) => t.trim() !== '').length;
  const nq = normalize(q);
  const shown = (data?.rows ?? []).filter((r) => !nq || normalize(`${r.group.name} ${variantLabel(r.variant)}`).includes(nq));
  const groups = new Map<string, StockRow[]>();
  for (const r of shown) groups.set(r.group.id, [...(groups.get(r.group.id) ?? []), r]);

  const save = () => wrap(async () => {
    if (!day || !diffs.length) return;
    if (!(await confirm({ title: `Gravar a contagem? (${diffs.length} ${diffs.length === 1 ? 'cor muda' : 'cores mudam'})`, confirm: 'Gravar contagem', tone: 'warning',
      message: <ul className="space-y-1 max-h-60 overflow-auto">{diffs.map((d) => (
        <li key={d.r.variant.id} className="flex justify-between gap-2"><span className="min-w-0 break-words">{d.r.group.name} · {variantLabel(d.r.variant)}</span>
          <b className="tabular-nums shrink-0">{d.r.item.currentQuantity} → {d.to} <span className={d.delta > 0 ? 'text-emerald-700' : 'text-red-600'}>({d.delta > 0 ? '+' : '−'}{Math.abs(d.delta)})</span></b></li>
      ))}</ul> }))) return;
    const r = await run(() => applyCount(day.id, diffs.map((d) => ({ variantId: d.r.variant.id, counted: d.counted }))));
    if (r) { toast(`✅ Contagem gravada: ${r.length} ${r.length === 1 ? 'cor ajustada' : 'cores ajustadas'}`); setCounts({}); onClose(); }
  });

  return (
    <Sheet open onClose={onClose} title="🔢 Contagem da loja" tall
      footer={<Button size="lg" className="w-full" disabled={locked || busy || !diffs.length} onClick={save}>
        {diffs.length ? `Revisar e gravar · ${diffs.length} ${diffs.length === 1 ? 'mudança' : 'mudanças'}` : typed ? 'Tudo bate com o sistema ✅' : 'Digite o que contou'}
      </Button>}>
      <div className="rounded-xl bg-blue-50 border border-blue-200 px-3 py-2 mb-3 text-[13px] text-blue-900 leading-snug">
        Conte as peças <b>na loja</b> e digite em cada cor. Deixe vazio o que não contou (não muda nada).
        Peças em <b>condicional</b> (na casa da cliente) já entram sozinhas. Nada é gravado antes de você revisar.
      </div>
      {locked && <p className="text-sm text-orange-700 mb-2">Abra o dia de hoje para contar.</p>}
      <Input placeholder="🔍 Buscar grupo ou cor..." value={q} onChange={(e) => setQ(e.target.value)} />
      {!shown.length && <Empty icon="🔍" title="Nada encontrado" />}
      <div className="space-y-2.5 mt-3">
        {[...groups.values()].map((rs) => (
          <Card key={rs[0].group.id} className="overflow-hidden">
            <div className="px-3 py-2 bg-slate-50 font-bold text-slate-800 text-[15px]">{rs[0].group.icon || '📦'} {rs[0].group.name}</div>
            <div className="divide-y divide-slate-100">
              {rs.map((r) => {
                const out = data?.out.get(r.variant.id) ?? 0;
                const d = diffs.find((x) => x.r.variant.id === r.variant.id);
                return (
                  <label key={r.variant.id} className="flex items-center gap-3 px-3 py-2">
                    <Swatch color={r.variant.color} size={22} />
                    <span className="flex-1 min-w-0">
                      <span className="block font-semibold text-slate-800 break-words">{variantLabel(r.variant)}</span>
                      <span className="block text-[12px] text-slate-500">no sistema {r.item.currentQuantity}{out ? ` · 👜 ${out} em condicional` : ''}</span>
                      {d && <span className={`block text-[12px] font-bold ${d.delta > 0 ? 'text-emerald-700' : 'text-red-600'}`}>vai ficar {d.to} ({d.delta > 0 ? '+' : '−'}{Math.abs(d.delta)})</span>}
                    </span>
                    <input inputMode="numeric" aria-label={`Contei ${r.variant.name}`} placeholder="contei" disabled={locked}
                      value={counts[r.variant.id] ?? ''} onChange={(e) => setCounts({ ...counts, [r.variant.id]: e.target.value.replace(/\D/g, '').slice(0, 5) })}
                      className="w-20 h-11 px-2 rounded-lg border border-slate-300 text-center font-bold text-lg tabular-nums outline-none focus:border-blue-500" />
                  </label>
                );
              })}
            </div>
          </Card>
        ))}
      </div>
    </Sheet>
  );
}

/** Mais vendidas, paradas e lucro no período. */
export function InsightsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [days, setDays] = useState(7);
  const [tab, setTab] = useState<'top' | 'stale' | 'lucro'>('top');
  const data = useLiveQuery(() => (open ? salesInsights(days) : Promise.resolve(null)), [open, days]);
  if (!open) return null;
  const when = (d: string | null) => (d ? `${d.slice(8)}/${d.slice(5, 7)}` : 'nunca');
  return (
    <Sheet open onClose={onClose} title="📊 Mais vendidas, paradas e lucro" tall>
      <div className="flex gap-2 mb-2">
        {[7, 30, 90].map((n) => <Chip key={n} active={days === n} onClick={() => setDays(n)}>{n} dias</Chip>)}
      </div>
      <div className="grid grid-cols-3 gap-1.5 mb-3">
        {([['top', '🏆 Mais vendidas'], ['stale', '😴 Paradas'], ['lucro', '💰 Lucro']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`min-h-10 rounded-xl text-[13px] font-bold ${tab === k ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-700'}`}>{l}</button>
        ))}
      </div>
      {!data ? null : tab === 'top' ? (
        <>
          <p className="text-[13px] text-slate-600 mb-2">{data.pieces} peças vendidas · {money(data.revenue)} nos últimos {days} dias</p>
          {!data.top.length && <Empty icon="🛍️" title="Nenhuma venda no período" />}
          <div className="space-y-1.5">
            {data.top.slice(0, 30).map((r, i) => (
              <Card key={r.variant.id} className="px-3 py-2 flex items-center gap-2.5">
                <span className="w-6 text-center font-extrabold text-slate-400 tabular-nums">{i + 1}</span>
                <Swatch color={r.variant.color} size={20} />
                <span className="flex-1 min-w-0 text-[14px]"><b className="text-slate-800">{r.group.name}</b> › {variantLabel(r.variant)}<span className="block text-[12px] text-slate-500">tem {r.stock} agora</span></span>
                <span className="text-right shrink-0"><b className="block tabular-nums">{r.qty} {r.qty === 1 ? 'peça' : 'peças'}</b><span className="text-[12px] text-slate-500 tabular-nums">{money(r.revenue)}</span></span>
              </Card>
            ))}
          </div>
        </>
      ) : tab === 'stale' ? (
        <>
          <p className="text-[13px] text-slate-600 mb-2">Têm peça e <b>não venderam nada</b> nos últimos {days} dias. Bom para pensar em promoção ou parar de repor.</p>
          {!data.stale.length && <Empty icon="🎉" title="Nenhuma parada" >Tudo que tem peça vendeu no período.</Empty>}
          <div className="space-y-1.5">
            {data.stale.map((r) => (
              <Card key={r.variant.id} className="px-3 py-2 flex items-center gap-2.5">
                <Swatch color={r.variant.color} size={20} />
                <span className="flex-1 min-w-0 text-[14px]"><b className="text-slate-800">{r.group.name}</b> › {variantLabel(r.variant)}<span className="block text-[12px] text-slate-500">última venda: {when(r.lastSale)}</span></span>
                <b className="shrink-0 tabular-nums">{r.stock} {r.stock === 1 ? 'peça' : 'peças'}</b>
              </Card>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Card className="p-2.5"><div className="text-[11px] text-slate-500">Vendido</div><div className="text-lg font-extrabold tabular-nums">{money(data.profit.revenueWithCost)}</div></Card>
            <Card className="p-2.5"><div className="text-[11px] text-slate-500">Custo</div><div className="text-lg font-extrabold tabular-nums text-red-600">{money(data.profit.cost)}</div></Card>
            <Card className="p-2.5"><div className="text-[11px] text-slate-500">Lucro</div><div className={`text-lg font-extrabold tabular-nums ${data.profit.profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{money(data.profit.profit)}</div></Card>
          </div>
          <p className="text-[13px] text-slate-600 mt-2 leading-snug">
            Só das peças com <b>custo cadastrado</b> (Produtos › cor › Custo).
            {data.profit.piecesNoCost > 0 && <> <b className="text-orange-700">{data.profit.piecesNoCost} {data.profit.piecesNoCost === 1 ? 'peça vendida não tem' : 'peças vendidas não têm'} custo</b> e ficaram fora da conta.</>}
          </p>
          <div className="space-y-1.5 mt-3">
            {data.top.filter((r) => r.cost !== null).map((r) => (
              <Card key={r.variant.id} className="px-3 py-2 flex items-center gap-2.5">
                <Swatch color={r.variant.color} size={20} />
                <span className="flex-1 min-w-0 text-[14px]"><b className="text-slate-800">{r.group.name}</b> › {variantLabel(r.variant)}<span className="block text-[12px] text-slate-500">{r.qty} × · vendeu {money(r.revenue)} · custo {money(r.cost)}</span></span>
                <b className={`shrink-0 tabular-nums ${r.revenue - (r.cost ?? 0) >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{money(r.revenue - (r.cost ?? 0))}</b>
              </Card>
            ))}
          </div>
        </>
      )}
    </Sheet>
  );
}
