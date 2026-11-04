import { variantLabel } from '../services/catalog';
import { EntryReasonPicker, type IncreaseReason } from '../components/EntryReason';
import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { EntryKind, MovementType, StockMovement } from '../db/types';
import { normalize } from '../lib/util';
import { moveStock, ReservedError, setStock, undoMovement, type StockOpts } from '../services/days';
import { setForSale } from '../services/catalog';
import { effectiveMovements, loadStockRows, type StockRow } from '../services/summary';
import { useApp } from '../state';
import { DayNotices, DayBar, StartDayCard } from '../components/day';
import { StockFlow } from '../components/StockFlow';
import { useSettleRetired } from '../components/RetiredStock';
import { Badge, Button, Card, Chip, Empty, Field, HelpButton, InfoTip, Input, Sheet, Swatch, useBusy, useUi } from '../components/ui';

/** Cor antiga: arquivada/excluída (ou grupo arquivado). Não conta no total, não vende e não recebe + (só “Resolver”). */
export const isOldRow = (r: StockRow) => !!(r.variant.archivedAt || r.variant.deletedAt || r.group.archivedAt);

type Filter = 'todos' | 'com' | 'sem' | 'baixo' | 'vender' | 'ideal' | 'semideal' | 'res';
const FILTERS: [Filter, string][] = [['todos', 'Todos'], ['baixo', 'Para repor'], ['com', 'Com estoque'], ['sem', 'Sem estoque'], ['res', '🔒 Reservadas'], ['vender', 'Para vender'], ['ideal', '🎯 Com ideal'], ['semideal', 'Sem ideal']];

export const MOVE_LABEL: Record<MovementType, string> = {
  venda: 'Venda', entrada: 'Entrada', saida: 'Saída', perda: 'Perda', ajuste: 'Ajuste', correcao: 'Correção',
  reserva: 'Reserva', cancelamento: 'Cancelamento',
};

export default function Stock() {
  const { day, settings, setOverlay } = useApp();
  const { run, toast } = useUi();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('todos');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [sel, setSel] = useState<StockRow | null>(null);
  const [showMoves, setShowMoves] = useState(false);
  const rows = useLiveQuery(() => (day ? loadStockRows(day.id, day.date) : Promise.resolve([])), [day?.id]);
  const locked = day?.status !== 'open';
  const sellIds = new Set(settings.sellGroups.map((s) => s.groupId));

  const groups = useMemo(() => {
    if (!rows) return [];
    const nq = normalize(q);
    const filtered = rows.filter((r) => {
      if (nq && !normalize(`${r.group.name} ${variantLabel(r.variant)}`).includes(nq)) return false;
      // cor antiga com peças aparece (separada, para resolver) em Todos e Com estoque; sem peças, some
      if (isOldRow(r)) return r.item.currentQuantity !== 0 && (filter === 'todos' || filter === 'com');
      if (filter === 'com') return r.item.currentQuantity > 0;
      if (filter === 'sem') return r.item.currentQuantity <= 0;
      if (filter === 'baixo') return r.restock > 0 || r.out;
      if (filter === 'vender') return sellIds.has(r.group.id);
      if (filter === 'ideal') return !r.variant.restockOff;
      if (filter === 'semideal') return !!r.variant.restockOff;
      if (filter === 'res') return r.reserved > 0;
      return true;
    });
    const map = new Map<string, { group: StockRow['group']; rows: StockRow[]; old: StockRow[] }>();
    for (const r of filtered) {
      if (!map.has(r.group.id)) map.set(r.group.id, { group: r.group, rows: [], old: [] });
      map.get(r.group.id)![isOldRow(r) ? 'old' : 'rows'].push(r);
    }
    return [...map.values()];
  }, [rows, q, filter, settings.sellGroups]);

  const guarded = useReserveGuard();
  const quick = async (r: StockRow, delta: number) => {
    const mv = await guarded((o) => moveStock(r.item.dailyRecordId, r.variant.id, delta, delta > 0 ? 'entrada' : 'saida', undefined, delta > 0 ? { ...o, entryKind: settings.entryNewByDefault ? 'nova' : 'reposicao' } : o));
    if (mv) toast(`${delta > 0 ? 'Entrada +1' : 'Saída −1'} · ${r.variant.name}${delta < 0 ? ' (não é venda)' : ''}`, 'info',
      { label: 'Desfazer', fn: () => run(() => undoMovement(mv.id)) });
  };

  // o total é o mesmo do relatório: só cores ativas (cor antiga repetida não soma peça que não existe)
  const total = (rows ?? []).filter((r) => !isOldRow(r)).reduce((s, r) => s + r.item.currentQuantity, 0);
  const oldWithStock = (rows ?? []).filter((r) => isOldRow(r) && r.item.currentQuantity !== 0);
  const settle = useSettleRetired();
  // nome repetido entre cores ativas do mesmo grupo (ex.: “Poa” duas vezes): marca as duas
  const dupNames = useMemo(() => {
    const seen = new Map<string, number>();
    for (const r of rows ?? []) if (!isOldRow(r)) { const k = `${r.group.id}|${normalize(variantLabel(r.variant))}`; seen.set(k, (seen.get(k) ?? 0) + 1); }
    return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
  }, [rows]);
  const live = (rows ?? []).filter((r) => !r.variant.archivedAt && !r.group.archivedAt && r.variant.active && r.group.active);
  const restockTotal = live.reduce((s, r) => s + r.restock, 0);
  const outCount = live.filter((r) => r.out).length;

  return (
    <div>
      <DayBar compact />
      <DayNotices />
      {day === null && <StartDayCard />}
      {day && (
        <>
          {/* resumo + ajuda + movimentos */}
          <Card className="p-3.5 mb-3">
            <div className="flex items-center gap-3">
              <span className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center text-2xl">📦</span>
              <div className="flex-1 min-w-0">
                <div className="text-[28px] font-extrabold tabular-nums leading-none">{total}</div>
                <div className="text-[13px] text-slate-500">peças no estoque</div>
              </div>
              <div className="flex flex-col items-end gap-1">
                {restockTotal > 0 && <button onClick={() => setFilter('baixo')} className="rounded-full bg-orange-100 text-orange-700 px-2.5 py-1 text-[12px] font-bold">🔁 repor {restockTotal}</button>}
                {outCount > 0 && <button onClick={() => setFilter('sem')} className="rounded-full bg-red-100 text-red-700 px-2.5 py-1 text-[12px] font-bold">🚫 {outCount} esgotado{outCount > 1 ? 's' : ''}</button>}
              </div>
            </div>
            {/* celular estreito / letra grande: Movimentos ocupa a linha toda (não quebra “Movimentos / do dia”); os outros dividem a de baixo */}
            <div className="grid grid-cols-2 gap-2 mt-3">
              <button onClick={() => setShowMoves(true)} className="col-span-2 min-h-11 px-3 rounded-xl bg-slate-100 text-[14px] font-semibold text-slate-700 active:bg-slate-200 flex items-center justify-center gap-2">
                <span>🧾</span><span>Movimentos do dia</span>
              </button>
              <button onClick={() => setOverlay('importar')} className={`min-h-11 px-3 rounded-xl bg-lime-100 text-[14px] font-semibold text-lime-900 active:bg-lime-200 flex items-center justify-center gap-2 ${locked ? 'col-span-2' : ''}`}>
                <span>📋</span><span>Importar</span>
              </button>
              {!locked && (
                <HelpButton icon="❓" label="Como usar" title="Estoque: + e −" example={[
                  ['📥', <>Chegaram 3 Plomo Vermelho → 3× no <b>+</b></>],
                  ['💔', <>Uma peça manchou → 1× no <b>−</b></>],
                  ['🔢', <>Contou 12 em vez de 14 → toque no <b>número</b> › Definir › 12</>],
                  ['🛍️', <>Vendeu? Use a aba <b>Vender</b> (o dinheiro entra no caixa)</>],
                ]}>
                  <span className="grid grid-cols-3 gap-2 text-center mb-2">
                    <span className="rounded-lg bg-emerald-50 py-2"><b className="block text-lg text-emerald-600">+</b><span className="text-[12px] text-emerald-800">Entrou peça</span></span>
                    <span className="rounded-lg bg-red-50 py-2"><b className="block text-lg text-red-600">−</b><span className="text-[12px] text-red-800">Saiu (não é venda)</span></span>
                    <span className="rounded-lg bg-slate-100 py-2"><b className="block text-lg text-slate-700">12</b><span className="text-[12px] text-slate-700">Toque: ajustar</span></span>
                  </span>
                  Aqui você mexe só no estoque. Errou um toque? Aparece “Desfazer” na hora, e também em Movimentos do dia.
                </HelpButton>
              )}
            </div>
          </Card>
          {oldWithStock.length > 0 && (
            <div role="alert" className="mb-3 rounded-2xl border-2 border-amber-300 bg-amber-50 p-3">
              <div className="font-bold text-amber-900 text-[15px]">⚠️ {oldWithStock.length} {oldWithStock.length === 1 ? 'cor antiga ainda tem' : 'cores antigas ainda têm'} peças</div>
              <div className="text-[13px] text-amber-900/90 mt-0.5">
                São cores arquivadas/excluídas (muitas vezes repetidas de uma cor nova com o mesmo nome).
                Elas <b>não contam no total</b> e não aparecem em Vender. Toque em cada uma para resolver.
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {oldWithStock.map((r) => (
                  <button key={r.variant.id} onClick={() => settle(r.variant, 'resolver')} disabled={locked}
                    className="rounded-full bg-white border border-amber-300 px-2.5 py-1 text-[12px] font-semibold text-amber-900 active:bg-amber-100 disabled:opacity-50">
                    {r.group.name} › {variantLabel(r.variant)}: {r.item.currentQuantity}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="sticky top-[calc(64px+env(safe-area-inset-top))] z-10 bg-slate-100 -mx-4 px-4 pt-1 pb-2 mb-1">
            <Input placeholder="🔍 Buscar grupo ou cor..." value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="flex gap-2 overflow-x-auto no-scrollbar mt-2 -mx-4 px-4 pb-1">
              {FILTERS.map(([k, l]) => <Chip key={k} active={filter === k} onClick={() => setFilter(k)}>{l}</Chip>)}
            </div>
          </div>
          {groups.length > 0 && (
            <div className="flex items-center gap-2.5 mb-2.5 rounded-xl bg-blue-50 border border-blue-200 pl-3 pr-2 py-2">
              <span className="text-lg">📖</span>
              <span className="flex-1 text-[13px] text-blue-900 leading-snug">
                Cada peça mostra <b className="whitespace-nowrap">começou → agora</b>.
                <span className="block text-[12px] text-blue-800/80">Toque no <b>número</b> para ajustar · <b>+</b> entrou · <b>−</b> saiu</span>
              </span>
              <InfoTip title="Como ler cada linha" example={[
                ['🌅', <><b>Começou com 14</b> = quantas tinha quando o dia começou</>],
                ['🌙', <><b>Agora 12</b> = quantas tem neste momento (no fim do dia, é o “terminou com”)</>],
                [<span className="rounded-full bg-red-100 text-red-700 px-1.5 text-[12px] font-bold">−2</span>, 'Diminuiu 2 hoje (vendeu, saiu ou perdeu)'],
                [<span className="rounded-full bg-emerald-100 text-emerald-700 px-1.5 text-[12px] font-bold">+3</span>, 'Aumentou 3 hoje (chegou mercadoria)'],
                [<span className="rounded-full bg-orange-100 text-orange-700 px-1.5 text-[12px] font-bold">repor 2</span>, 'Faltam 2 para voltar ao estoque ideal → já aparece para repor'],
              ]}>Assim dá para ver de relance o que mudou em cada cor hoje.</InfoTip>
            </div>
          )}
          {!groups.length && <Empty icon="🔍" title="Nada encontrado">Tente outro filtro ou busca.</Empty>}
          <div className="space-y-2.5">
            {groups.map(({ group, rows: gr, old }) => {
              const isOpen = open[group.id] ?? (!!q || filter !== 'todos');
              const sum = gr.reduce((s, r) => s + r.item.currentQuantity, 0);
              const alerts = gr.reduce((s, r) => s + r.restock, 0);
              return (
                <Card key={group.id} className="overflow-hidden">
                  <button className="relative w-full flex items-center gap-3 pl-4 pr-3 py-3 text-left active:bg-slate-50" onClick={() => setOpen({ ...open, [group.id]: !isOpen })}>
                    <span className="absolute left-0 top-0 bottom-0 w-1.5" style={{ background: group.color }} />
                    <span className="w-11 h-11 rounded-xl flex items-center justify-center text-xl shrink-0" style={{ background: group.color + '22' }}>{group.icon || '📦'}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block font-bold text-slate-800 break-words text-[16px]">{group.name} {group.archivedAt && <Badge>arquivado</Badge>}</span>
                      <span className="block text-[11px] text-slate-500 font-semibold mt-0.5">🎨 {gr.length} {gr.length === 1 ? 'cor' : 'cores'}{old.length > 0 && <span className="text-amber-700"> · ⚠️ {old.length} antiga{old.length > 1 ? 's' : ''} fora do total</span>}</span>
                      <StockFlow size="sm" start={gr.reduce((n, r) => n + r.item.initialQuantity, 0)} now={sum} restock={alerts} />
                    </span>
                    <span className="text-right">
                      <span className="block text-2xl font-extrabold tabular-nums leading-none">{sum}</span>
                      <span className="block text-[11px] text-slate-500">peças</span>
                    </span>
                    <span className={`text-slate-400 text-lg transition ${isOpen ? 'rotate-90' : ''}`}>›</span>
                  </button>
                  {isOpen && (
                    <div className="border-t border-slate-100 divide-y divide-slate-100">
                      {(() => {
                        const off = gr.filter((r) => r.variant.forSale === false).length;
                        const allOff = off === gr.length;
                        if (!gr.length) return null;
                        return (
                          <div className="flex items-center gap-2 px-3.5 py-2 bg-slate-50 text-[12px] text-slate-600">
                            <span className="flex-1">{off === 0 ? '🏷️ Todas as cores estão à venda' : allOff ? '🔒 Grupo inteiro guardado (fora da venda)' : `🏷️ ${gr.length - off} à venda · 🔒 ${off} guardada${off > 1 ? 's' : ''}`}</span>
                            <button onClick={() => run(() => setForSale(gr.map((r) => r.variant.id), allOff), allOff ? 'Grupo à venda' : 'Grupo guardado')}
                              className={`h-9 px-3 rounded-lg font-semibold ${allOff ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200 text-slate-700'}`}>
                              {allOff ? '🏷️ Pôr à venda' : '🔒 Guardar todas'}
                            </button>
                          </div>
                        );
                      })()}
                      {gr.map((r) => (
                        <div key={r.variant.id} className="flex items-center gap-2 pl-3.5 pr-2 py-2">
                          <button className="flex-1 flex items-center gap-3 min-w-0 text-left py-1" onClick={() => setSel(r)}>
                            <Swatch color={r.variant.color} size={24} />
                            <span className="min-w-0">
                              <span className="block font-semibold text-slate-800 break-words">{variantLabel(r.variant)}</span>
                              {dupNames.has(`${r.group.id}|${normalize(variantLabel(r.variant))}`) && (
                                <span className="inline-block mb-1 rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 text-[10px] font-bold">⚠️ nome repetido neste grupo · confira</span>
                              )}
                              <StockFlow start={r.item.initialQuantity} now={r.item.currentQuantity} restock={r.restock} out={r.out} reserved={r.reserved} />
                              {r.variant.forSale === false && <span className="inline-block mt-1 rounded-full bg-slate-800 text-white px-2 py-0.5 text-[10px] font-bold">🔒 guardada · fora da venda</span>}
                            </span>
                          </button>
                          <button disabled={locked || r.item.currentQuantity <= 0} onClick={() => quick(r, -1)} aria-label={`Saiu 1 ${r.variant.name}`}
                            className="w-11 h-11 rounded-xl bg-red-50 text-red-600 text-xl font-bold disabled:opacity-30 active:scale-95">−</button>
                          <button onClick={() => setSel(r)} title="Toque para ajustar"
                            className={`w-12 h-11 rounded-xl border border-slate-200 bg-white text-center text-xl font-extrabold tabular-nums active:bg-slate-50 ${r.item.currentQuantity <= 0 ? 'text-red-600' : ''}`}>
                            {r.item.currentQuantity}
                          </button>
                          <button disabled={locked} onClick={() => quick(r, 1)} aria-label={`Entrou 1 ${r.variant.name}`}
                            className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-600 text-xl font-bold disabled:opacity-30 active:scale-95">+</button>
                        </div>
                      ))}
                      {old.length > 0 && (
                        <div className="bg-amber-50/70">
                          <div className="px-3.5 pt-2 pb-1 text-[12px] font-bold text-amber-900">🗄️ Cores antigas · não contam no total nem aparecem em Vender</div>
                          {old.map((r) => (
                            <div key={r.variant.id} className="flex items-center gap-3 pl-3.5 pr-2 py-2 border-t border-amber-100">
                              <Swatch color={r.variant.color} size={24} />
                              <span className="flex-1 min-w-0">
                                <span className="block font-semibold text-slate-500 break-words">{variantLabel(r.variant)}</span>
                                <span className="inline-block rounded-full bg-amber-200 text-amber-900 px-2 py-0.5 text-[11px] font-bold">
                                  {r.variant.deletedAt ? 'excluída' : 'arquivada'} · {r.item.currentQuantity} {Math.abs(r.item.currentQuantity) === 1 ? 'peça' : 'peças'} fora do total
                                </span>
                              </span>
                              <button disabled={locked} onClick={() => settle(r.variant, 'resolver')} aria-label={`Resolver ${r.variant.name}`}
                                className="h-11 px-3 rounded-xl bg-amber-500 text-white text-[14px] font-bold disabled:opacity-40 active:scale-95">Resolver</button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>

        </>
      )}
      <VariantSheet row={sel} onClose={() => setSel(null)} locked={locked} />
      <MovesSheet open={showMoves} onClose={() => setShowMoves(false)} />
    </div>
  );
}

/**
 * Saída/perda/ajuste que deixaria menos peças do que as reservadas: pergunta antes.
 * Venda não passa por aqui (ela já respeita as reservas).
 */
function useReserveGuard() {
  const { run, confirm, toast } = useUi();
  return async <T,>(fn: (o: StockOpts) => Promise<T>, okMsg?: string): Promise<T | undefined> => {
    try {
      const r = await fn({});
      if (okMsg) toast(okMsg);
      return r;
    } catch (e) {
      if (!(e instanceof ReservedError)) { toast((e as Error).message, 'err'); return undefined; }
      const go = await confirm({ title: 'Tem peça reservada', tone: 'warning', confirm: 'Continuar mesmo assim',
        message: `${e.message} Se continuar, vai faltar peça para a reserva. Se a reserva não vale mais, cancele ela na aba Vender.` });
      return go ? run(() => fn({ allowBelowReserved: true }), okMsg) : undefined;
    }
  };
}

/** À venda x guardada (fica no estoque, mas some de Vender). */
function ForSaleSwitch({ variantId }: { variantId: string }) {
  const { run } = useUi();
  const v = useLiveQuery(() => db.variants.get(variantId), [variantId]);
  if (!v) return null;
  const on = v.forSale !== false;
  return (
    <div className={`flex items-center gap-3 rounded-xl border px-3 py-2 mb-3 ${on ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-100 border-slate-300'}`}>
      <span className="text-xl">{on ? '🏷️' : '🔒'}</span>
      <span className="flex-1 min-w-0">
        <span className="block font-bold text-slate-800 text-[14px]">{on ? 'À venda' : 'Guardada (fora da venda)'}</span>
        <span className="block text-[12px] text-slate-500">{on ? 'Aparece na aba Vender' : 'Fica no estoque, mas não aparece em Vender'}</span>
      </span>
      <InfoTip title="À venda ou guardada?" example={[
        ['🏷️', <><b>À venda:</b> aparece em Vender (o normal)</>],
        ['🔒', <><b>Guardada:</b> peça de mostruário, separada para encomenda ou com defeito</>],
        ['📦', 'Guardada continua contando no estoque e no relatório'],
        ['🔁', 'Dá para colocar à venda de novo a qualquer momento'],
      ]}>Use para peças que você tem, mas não quer vender agora.</InfoTip>
      <button type="button" role="switch" aria-checked={on} aria-label={on ? 'À venda' : 'Guardada'}
        onClick={() => run(() => setForSale([variantId], !on), on ? 'Peça guardada' : 'Peça à venda')} className="min-h-11 flex items-center">
        <span className={`w-12 h-7 rounded-full p-0.5 transition ${on ? 'bg-emerald-500' : 'bg-slate-400'}`}>
          <span className={`block w-6 h-6 rounded-full bg-white shadow transition ${on ? 'translate-x-5' : ''}`} />
        </span>
      </button>
    </div>
  );
}

function VariantSheet({ row, onClose, locked }: { row: StockRow | null; onClose: () => void; locked: boolean }) {
  const guarded = useReserveGuard();
  const [busy, wrap] = useBusy();
  const { settings, openHistory } = useApp();
  const [type, setType] = useState<'entrada' | 'saida' | 'perda' | 'ajuste'>('entrada');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [kind, setKind] = useState<IncreaseReason | null>(null);
  const live = useLiveQuery(async () => {
    if (!row) return null;
    const item = await db.dailyStockItems.where('[dailyRecordId+variantId]').equals([row.item.dailyRecordId, row.variant.id]).first();
    const moves = (await db.stockMovements.where('dailyRecordId').equals(row.item.dailyRecordId).toArray())
      .filter((m) => m.variantId === row.variant.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { item, moves };
  }, [row?.item.dailyRecordId, row?.variant.id]);
  if (!row) return null;
  const current = live?.item?.currentQuantity ?? row.item.currentQuantity;
  const n = Number(qty);
  // entrada: nova ou reposição (padrão nas Configurações); “Definir” que sobe: pergunta o motivo
  const entryKind = kind && kind !== 'ajuste' ? kind : (settings.entryNewByDefault ? 'nova' : 'reposicao');
  const definirSobe = type === 'ajuste' && qty !== '' && n > current;
  const valid = qty !== '' && Number.isInteger(n) && (type === 'ajuste' ? n >= 0 : n > 0) && (!definirSobe || kind !== null);
  const save = () => wrap(async () => {
    const r = await guarded(async (o) => {
      if (type === 'ajuste') return setStock(row.item.dailyRecordId, row.variant.id, n, note || 'Ajuste manual', definirSobe && kind !== 'ajuste' ? { ...o, entryKind: kind as EntryKind } : o);
      return moveStock(row.item.dailyRecordId, row.variant.id, type === 'entrada' ? n : -n, type, note || undefined, type === 'entrada' ? { ...o, entryKind } : o);
    }, 'Salvo');
    if (r !== undefined) { setQty(''); setNote(''); setKind(null); }
  });
  return (
    <Sheet open onClose={onClose} title={<span className="flex items-center gap-2"><Swatch color={row.variant.color} />{row.group.name} · {variantLabel(row.variant)}</span>}>
      <ForSaleSwitch variantId={row.variant.id} />
      <div className="grid grid-cols-4 gap-1.5 text-center mb-2">
        <Card className="p-2"><div className="text-[11px] text-slate-500 leading-tight">Começou o dia</div><div className="text-xl font-bold">{row.item.initialQuantity}</div></Card>
        <Card className="p-2 ring-2 ring-blue-200"><div className="text-[11px] text-slate-500 leading-tight">📦 Físico agora</div><div className="text-xl font-extrabold text-blue-600">{current}</div></Card>
        <Card className="p-2"><div className="text-[11px] text-slate-500 leading-tight">🔒 Reservado</div><div className={`text-xl font-bold ${row.reserved ? 'text-purple-700' : 'text-slate-400'}`}>{row.reserved}</div></Card>
        <Card className="p-2"><div className="text-[11px] text-slate-500 leading-tight">🏷️ Disponível</div><div className="text-xl font-bold">{Math.max(0, current - row.reserved)}</div></Card>
      </div>
      <p className="text-[12px] text-slate-500 mb-4 leading-snug">
        {current > 0 && current - row.reserved <= 0 ? <><b className="text-purple-700">Tudo reservado:</b> as {current} peça(s) estão no estoque, guardadas para alguém, por isso não aparecem para vender. </> : null}
        {row.variant.restockOff ? 'Sem estoque ideal.' : <>🎯 Estoque ideal {row.ideal} (meta, não é estoque){row.restock > 0 ? ` → repor ${row.restock}` : ''}.</>}
      </p>
      {!locked && (
        <>
          <div className="grid grid-cols-4 gap-1.5 mb-3">
            {(['entrada', 'saida', 'perda', 'ajuste'] as const).map((t) => (
              <button key={t} onClick={() => { setType(t); setKind(null); }}
                className={`h-11 rounded-xl text-sm font-semibold border ${type === t ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-slate-200 text-slate-600'}`}>
                {t === 'ajuste' ? 'Definir' : MOVE_LABEL[t]}
              </button>
            ))}
          </div>
          <Field label={type === 'ajuste' ? 'Quantidade correta agora' : 'Quantidade'}
            hint={type === 'ajuste' ? 'Gera um ajuste com a diferença. Ajuste não conta como venda.' : undefined}>
            {/* sem autoFocus: o teclado só abre quando a pessoa toca no campo */}
            <Input inputMode="numeric" pattern="[0-9]*" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))} placeholder="0" />
          </Field>
          {type === 'entrada' && <EntryReasonPicker value={kind ?? entryKind} onChange={setKind} />}
          {definirSobe && (
            <>
              <div className="text-[13px] font-semibold text-slate-700 mb-1.5">Por que aumentou? (+{n - current})</div>
              <EntryReasonPicker withAdjust value={kind} onChange={setKind} />
            </>
          )}
          <Field label="Observação (opcional)"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <Button className="w-full" size="lg" disabled={!valid || busy} onClick={save}>Salvar</Button>
        </>
      )}
      <Button className="w-full mt-3" variant="outline" onClick={() => openHistory(row.variant.id)}>📜 Histórico desta peça (desde o cadastro)</Button>
      <h3 className="font-bold text-slate-700 mt-5 mb-2">Movimentos do dia</h3>
      <MoveList moves={live?.moves ?? []} locked={locked} />
    </Sheet>
  );
}

const MOVE_ICON: Record<MovementType, string> = {
  venda: '🛍️', entrada: '📥', saida: '📤', perda: '💔', ajuste: '✏️', correcao: '↩️', reserva: '📌', cancelamento: '✖️',
};

/** Frase curta e direta: "Vendeu 2", "Entrou 5", "Ajustou para 10"... */
function moveText(m: StockMovement) {
  const n = Math.abs(m.quantity);
  switch (m.type) {
    case 'venda': return m.description?.startsWith('Troca') ? `Troca: ${m.quantity > 0 ? 'voltou' : 'saiu'} ${n}` : `Vendeu ${n}`;
    case 'entrada': return `Entrou ${n}`;
    case 'saida': return `Saiu ${n}`;
    case 'perda': return `Perdeu ${n}`;
    case 'ajuste': return `Ajustou para ${m.newBalance}`;
    case 'correcao': return m.reversedMovementId ? `Desfeito (${m.quantity > 0 ? '+' : '−'}${n})` : `Correção ${m.quantity > 0 ? '+' : '−'}${n}`;
    case 'cancelamento': return `Venda cancelada (+${n} de volta)`;
    case 'reserva': return m.description || 'Reserva';
  }
}

type Piece = { group: string; icon: string; groupColor: string; name: string; color?: string };

const MOVE_TONE: Record<MovementType, string> = {
  venda: 'bg-blue-100 text-blue-800', entrada: 'bg-emerald-100 text-emerald-800', saida: 'bg-red-100 text-red-700', perda: 'bg-red-100 text-red-700',
  ajuste: 'bg-slate-200 text-slate-700', correcao: 'bg-slate-200 text-slate-700', reserva: 'bg-purple-100 text-purple-800', cancelamento: 'bg-amber-100 text-amber-800',
};

/** Toques seguidos na mesma peça (ex.: “Saiu 1” quatro vezes) viram uma linha só. */
function groupMoves(moves: StockMovement[], undone: Set<string | null | undefined>) {
  const out: StockMovement[][] = [];
  for (const m of moves) {
    const last = out[out.length - 1];
    const head = last?.[0];
    const sameKind = head && head.variantId === m.variantId && head.type === m.type && ['entrada', 'saida', 'perda'].includes(m.type)
      && !m.orderId && !head.orderId && !m.reversedMovementId && !head.reversedMovementId && undone.has(m.id) === undone.has(head.id)
      && Math.abs(Date.parse(head.createdAt) - Date.parse(m.createdAt)) < 10 * 60_000;
    if (sameKind) last.push(m); else out.push([m]);
  }
  return out;
}

function MoveList({ moves, locked, pieces }: { moves: StockMovement[]; locked: boolean; pieces?: Map<string, Piece> }) {
  const { run, confirm } = useUi();
  const undone = new Set(moves.map((m) => m.reversedMovementId).filter(Boolean));
  if (!moves.length) return <Empty icon="🧾" title="Nenhum movimento aqui">Vendas, entradas e ajustes do dia aparecem aqui.</Empty>;
  return (
    <div className="space-y-2">
      {groupMoves(moves, undone).map((grp) => {
        const m = grp[0]; // mais recente
        const oldest = grp[grp.length - 1];
        const total = grp.reduce((s, x) => s + x.quantity, 0);
        const shown = { ...m, quantity: total, previousBalance: oldest.previousBalance };
        const isUndone = undone.has(m.id);
        const pc = pieces?.get(m.variantId);
        const canUndo = !locked && m.quantity !== 0 && !m.orderId && !m.reversedMovementId && !isUndone;
        return (
          <div key={m.id} className={`bg-white rounded-2xl border border-slate-200 px-3 py-2.5 ${isUndone ? 'opacity-50' : ''}`}>
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-bold ${MOVE_TONE[m.type]} ${isUndone ? 'line-through' : ''}`}>
                {MOVE_ICON[m.type]} {moveText(shown)}
              </span>
              {grp.length > 1 && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">{grp.length} toques</span>}
              {isUndone && <span className="text-[11px] font-semibold text-slate-500">desfeito</span>}
              <span className="flex-1" />
              <span className="text-[12px] text-slate-400 tabular-nums">🕒 {new Date(m.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            <div className="flex items-center gap-2 mt-2">
              {pc ? (
                <span className="flex items-center gap-1.5 min-w-0 flex-1">
                  <span>{pc.icon}</span>
                  <span className="text-[13px] font-bold shrink-0" style={{ color: pc.groupColor }}>{pc.group}</span>
                  <span className="shrink-0 text-slate-300">›</span>
                  <Swatch color={pc.color} size={14} />
                  <span className="text-[14px] font-semibold text-slate-800 break-words">{pc.name}</span>
                </span>
              ) : <span className="flex-1 text-[12px] text-slate-500 break-words">{m.type !== 'reserva' && m.description && m.description !== 'Desfazer movimentação' ? m.description : ''}</span>}
              {shown.quantity !== 0 && (
                <span className="flex items-center gap-1 text-[13px] tabular-nums shrink-0" title="Estoque antes → depois">
                  <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-slate-500">{shown.previousBalance}</span>
                  <span className="text-slate-400">→</span>
                  <span className={`rounded-md px-1.5 py-0.5 font-bold ${shown.quantity > 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-700'}`}>{m.newBalance}</span>
                </span>
              )}
              {canUndo && (
                <button aria-label={`Desfazer ${moveText(m)}`} className="h-10 px-2.5 rounded-lg bg-slate-100 text-[12px] text-slate-700 font-semibold active:bg-slate-200 shrink-0" onClick={async () => {
                  if (await confirm({ title: grp.length > 1 ? 'Desfazer o último toque?' : 'Desfazer este movimento?',
                    message: `“${moveText(m)}” volta atrás${grp.length > 1 ? ` (os outros ${grp.length - 1} continuam)` : ''}. Fica registrado como desfeito; nada é apagado.`, confirm: 'Desfazer' }))
                    run(() => undoMovement(m.id), 'Desfeito');
                }}>↩️ {grp.length > 1 ? 'Desfazer 1' : 'Desfazer'}</button>
              )}
            </div>
            {pc && m.type !== 'reserva' && m.description && m.description !== 'Desfazer movimentação' && (
              <div className="text-[12px] text-slate-500 mt-1 break-words">📝 {m.description}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

type MoveFilter = 'todos' | 'venda' | 'entrada' | 'saida' | 'ajuste';
const MOVE_FILTERS: [MoveFilter, string, MovementType[]][] = [
  ['todos', 'Todos', []], ['venda', '🛍️ Vendas', ['venda', 'cancelamento']], ['entrada', '📥 Entradas', ['entrada']],
  ['saida', '📤 Saídas e perdas', ['saida', 'perda']], ['ajuste', '✏️ Ajustes', ['ajuste', 'correcao']],
];

function MovesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { day } = useApp();
  const [filter, setFilter] = useState<MoveFilter>('todos');
  const [q, setQ] = useState('');
  const data = useLiveQuery(async () => {
    if (!day || !open) return null;
    const [moves, variants, groups] = await Promise.all([
      db.stockMovements.where('dailyRecordId').equals(day.id).reverse().sortBy('createdAt'),
      db.variants.toArray(), db.groups.toArray(),
    ]);
    const gr = new Map(groups.map((x) => [x.id, x]));
    const pieces = new Map<string, Piece>(variants.map((v) => {
      const gg = gr.get(v.groupId);
      return [v.id, { group: gg?.name ?? '—', icon: gg?.icon ?? '📦', groupColor: gg?.color ?? '#94a3b8', name: v.name + (v.deletedAt ? ' (cor excluída)' : v.archivedAt ? ' (cor arquivada)' : ''), color: v.color }];
    }));
    return { moves, pieces };
  }, [day?.id, open]);
  const moves = data?.moves ?? [];
  const eff = effectiveMovements(moves);
  const sum = (types: MovementType[]) => eff.filter((m) => types.includes(m.type)).reduce((s, m) => s + m.quantity, 0);
  const types = MOVE_FILTERS.find((f) => f[0] === filter)![2];
  const nq = normalize(q);
  const shown = moves
    .filter((m) => filter === 'todos' || types.includes(m.type))
    .filter((m) => { if (!nq) return true; const pc = data?.pieces.get(m.variantId); return normalize(`${pc?.group ?? ''} ${pc?.name ?? ''}`).includes(nq); });
  const tiles: [MoveFilter, string, number, string][] = [
    ['todos', 'Todos', moves.length, 'text-slate-800'],
    ['venda', 'Vendidas', -sum(['venda', 'cancelamento']), 'text-blue-700'],
    ['entrada', 'Entraram', sum(['entrada']), 'text-emerald-600'],
    ['saida', 'Saíram', -sum(['saida', 'perda']), 'text-red-600'],
    ['ajuste', 'Ajustes', sum(['ajuste', 'correcao']), 'text-slate-700'],
  ];
  return (
    <Sheet open={open} onClose={onClose} title="🧾 Movimentos do dia" tall>
      <div className="flex items-center gap-2 mb-3 text-[12px] text-emerald-700 font-semibold">
        <span className="w-4 h-4 rounded-full bg-emerald-500 text-white text-[10px] flex items-center justify-center">✓</span>
        Tudo aqui já está salvo no sistema
      </div>
      {/* os números são os filtros: toque para ver só aquele tipo */}
      <div className="grid grid-cols-5 gap-1.5 mb-2.5">
        {tiles.map(([k, l, v, c]) => (
          <button key={k} onClick={() => setFilter(k)} aria-pressed={filter === k}
            className={`rounded-xl border py-2 text-center transition ${filter === k ? 'bg-slate-800 border-slate-800' : 'bg-white border-slate-200 active:bg-slate-50'}`}>
            <div className={`text-[18px] font-extrabold tabular-nums leading-tight ${filter === k ? 'text-white' : c}`}>{k === 'ajuste' && v > 0 ? '+' : ''}{v}</div>
            <div className={`text-[10px] font-semibold ${filter === k ? 'text-slate-200' : 'text-slate-500'}`}>{l}</div>
          </button>
        ))}
      </div>
      <Input placeholder="🔍 Buscar peça ou cor..." value={q} onChange={(e) => setQ(e.target.value)} className="mb-3" />
      <MoveList moves={shown} locked={day?.status !== 'open'} pieces={data?.pieces} />
      <div className="mt-4 flex items-start gap-3 rounded-2xl bg-blue-50 border border-blue-200 px-3.5 py-3">
        <span className="text-2xl">↩️</span>
        <div className="flex-1 text-[14px] text-blue-900 leading-snug">
          <b>Errou um + ou −?</b> Toque em <b>Desfazer</b> no movimento.
          <span className="block text-[13px] text-blue-800/80 mt-0.5">Venda errada se cancela na aba <b>Caixa</b> (as peças voltam sozinhas).</span>
        </div>
        <InfoTip title="Como corrigir um erro" example={[
          ['👆', 'Tocou 2× no + mas chegou só 1 peça'],
          ['↩️', <>Movimentos do dia › no “Entrou 1” a mais › <b>Desfazer</b></>],
          ['🛍️', 'Lançou uma venda que não aconteceu'],
          ['💰', <>Caixa › na venda › <b>Cancelar venda</b></>],
        ]}>
          Nada é apagado: o desfazer lança o contrário e o movimento fica riscado como “desfeito”, para você conferir depois.
        </InfoTip>
      </div>
    </Sheet>
  );
}
