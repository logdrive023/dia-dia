import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { MovementType, StockMovement } from '../db/types';
import { normalize } from '../lib/util';
import { moveStock, setStock, undoMovement } from '../services/days';
import { loadStockRows, type StockRow } from '../services/summary';
import { useApp } from '../state';
import { DayNotices, DayBar, StartDayCard } from '../components/day';
import { Badge, Button, Card, Chip, Empty, Field, Input, Sheet, Swatch, useBusy, useUi } from '../components/ui';

type Filter = 'todos' | 'com' | 'sem' | 'baixo' | 'vender';
const FILTERS: [Filter, string][] = [['todos', 'Todos'], ['com', 'Com estoque'], ['sem', 'Sem estoque'], ['baixo', 'Estoque baixo'], ['vender', 'Para vender']];

export const MOVE_LABEL: Record<MovementType, string> = {
  venda: 'Venda', entrada: 'Entrada', saida: 'Saída', perda: 'Perda', ajuste: 'Ajuste', correcao: 'Correção',
  reserva: 'Reserva', cancelamento: 'Cancelamento',
};

export default function Stock() {
  const { day, settings } = useApp();
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
      if (r.variant.archivedAt || r.group.archivedAt) return r.item.currentQuantity !== 0; // arquivado com saldo continua visível
      if (nq && !normalize(`${r.group.name} ${r.variant.name}`).includes(nq)) return false;
      if (filter === 'com') return r.item.currentQuantity > 0;
      if (filter === 'sem') return r.item.currentQuantity <= 0;
      if (filter === 'baixo') return r.low || r.out;
      if (filter === 'vender') return sellIds.has(r.group.id);
      return true;
    });
    const map = new Map<string, { group: StockRow['group']; rows: StockRow[] }>();
    for (const r of filtered) {
      if (!map.has(r.group.id)) map.set(r.group.id, { group: r.group, rows: [] });
      map.get(r.group.id)!.rows.push(r);
    }
    return [...map.values()];
  }, [rows, q, filter, settings.sellGroups]);

  const quick = async (r: StockRow, delta: number) => {
    const mv = await run(() => moveStock(r.item.dailyRecordId, r.variant.id, delta, delta > 0 ? 'entrada' : 'saida'));
    if (mv) toast(`${delta > 0 ? 'Entrada +1' : 'Saída −1'} · ${r.variant.name}${delta < 0 ? ' (não é venda)' : ''}`, 'info',
      { label: 'Desfazer', fn: () => run(() => undoMovement(mv.id)) });
  };

  const total = rows?.reduce((s, r) => s + r.item.currentQuantity, 0) ?? 0;

  return (
    <div>
      <DayBar />
      <DayNotices />
      {day === null && <StartDayCard />}
      {day && (
        <>
          <div className="flex items-center justify-between mb-2">
            <div><span className="text-2xl font-extrabold tabular-nums">{total}</span> <span className="text-slate-500 text-sm">peças no total</span></div>
            <Button size="sm" variant="outline" className="whitespace-nowrap" onClick={() => setShowMoves(true)}>🧾 Movimentos do dia</Button>
          </div>
          <Input placeholder="🔍 Buscar grupo ou cor..." value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="flex gap-2 overflow-x-auto no-scrollbar my-3 -mx-4 px-4">
            {FILTERS.map(([k, l]) => <Chip key={k} active={filter === k} onClick={() => setFilter(k)}>{l}</Chip>)}
          </div>
          {!groups.length && <Empty icon="🔍" title="Nada encontrado">Tente outro filtro ou busca.</Empty>}
          <div className="space-y-2.5">
            {groups.map(({ group, rows: gr }) => {
              const isOpen = open[group.id] ?? (!!q || filter !== 'todos');
              const sum = gr.reduce((s, r) => s + r.item.currentQuantity, 0);
              const alerts = gr.filter((r) => r.low || r.out).length;
              return (
                <Card key={group.id} className="overflow-hidden">
                  <button className="w-full flex items-center gap-3 p-3.5 text-left" onClick={() => setOpen({ ...open, [group.id]: !isOpen })}>
                    <span className="w-10 h-10 rounded-xl flex items-center justify-center text-xl" style={{ background: group.color + '22' }}>{group.icon || '📦'}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block font-bold text-slate-800 truncate">{group.name} {group.archivedAt && <Badge>arquivado</Badge>}</span>
                      <span className="block text-xs text-slate-500">{gr.length} variações{alerts ? ` · ${alerts} p/ repor` : ''}</span>
                    </span>
                    <span className="text-2xl font-extrabold tabular-nums">{sum}</span>
                    <span className={`text-slate-400 transition ${isOpen ? 'rotate-90' : ''}`}>›</span>
                  </button>
                  {isOpen && (
                    <div className="border-t border-slate-100 divide-y divide-slate-100">
                      {gr.map((r) => (
                        <div key={r.variant.id} className="flex items-center gap-2 pl-3.5 pr-2 py-2">
                          <button className="flex-1 flex items-center gap-2.5 min-w-0 text-left py-1" onClick={() => setSel(r)}>
                            <Swatch color={r.variant.color} />
                            <span className="min-w-0">
                              <span className="block font-medium text-slate-800 truncate">{r.variant.name}</span>
                              <span className="block text-[11px]">
                                {r.out ? <span className="text-red-600 font-semibold">esgotado</span>
                                  : r.low ? <span className="text-orange-600 font-semibold">baixo (mín. {r.min})</span>
                                  : <span className="text-slate-400">início {r.item.initialQuantity}</span>}
                                {r.reserved > 0 && <span className="text-purple-600 font-semibold"> · {r.reserved} reserv.</span>}
                              </span>
                            </span>
                          </button>
                          <button disabled={locked || r.item.currentQuantity <= 0} onClick={() => quick(r, -1)}
                            className="w-10 h-10 rounded-xl bg-red-50 text-red-600 text-xl font-bold disabled:opacity-30">−</button>
                          <button onClick={() => setSel(r)} className={`w-12 text-center text-xl font-extrabold tabular-nums ${r.item.currentQuantity <= 0 ? 'text-red-600' : ''}`}>
                            {r.item.currentQuantity}
                          </button>
                          <button disabled={locked} onClick={() => quick(r, 1)}
                            className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 text-xl font-bold disabled:opacity-30">+</button>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
          <p className="text-xs text-slate-400 text-center mt-4">“+” = entrada · “−” = saída (não é venda; para vender use a aba Vender). Toque no número para ajustar, perda ou ver os movimentos.</p>
        </>
      )}
      <VariantSheet row={sel} onClose={() => setSel(null)} locked={locked} />
      <MovesSheet open={showMoves} onClose={() => setShowMoves(false)} />
    </div>
  );
}

function VariantSheet({ row, onClose, locked }: { row: StockRow | null; onClose: () => void; locked: boolean }) {
  const { run } = useUi();
  const [busy, wrap] = useBusy();
  const [type, setType] = useState<'entrada' | 'saida' | 'perda' | 'ajuste'>('entrada');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
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
  const valid = qty !== '' && Number.isInteger(n) && (type === 'ajuste' ? n >= 0 : n > 0);
  const save = () => wrap(async () => {
    const r = await run(async () => {
      if (type === 'ajuste') return setStock(row.item.dailyRecordId, row.variant.id, n, note || 'Ajuste manual');
      return moveStock(row.item.dailyRecordId, row.variant.id, type === 'entrada' ? n : -n, type, note || undefined);
    }, 'Salvo');
    if (r !== undefined) { setQty(''); setNote(''); }
  });
  return (
    <Sheet open onClose={onClose} title={<span className="flex items-center gap-2"><Swatch color={row.variant.color} />{row.group.name} · {row.variant.name}</span>}>
      <div className="grid grid-cols-3 gap-2 text-center mb-4">
        <Card className="p-2"><div className="text-xs text-slate-500">Início do dia</div><div className="text-xl font-bold">{row.item.initialQuantity}</div></Card>
        <Card className="p-2"><div className="text-xs text-slate-500">Agora</div><div className="text-xl font-extrabold text-blue-600">{current}</div></Card>
        <Card className="p-2"><div className="text-xs text-slate-500">Disponível</div><div className="text-xl font-bold">{current - row.reserved}</div></Card>
      </div>
      {!locked && (
        <>
          <div className="grid grid-cols-4 gap-1.5 mb-3">
            {(['entrada', 'saida', 'perda', 'ajuste'] as const).map((t) => (
              <button key={t} onClick={() => setType(t)}
                className={`h-11 rounded-xl text-sm font-semibold border ${type === t ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-slate-200 text-slate-600'}`}>
                {t === 'ajuste' ? 'Definir' : MOVE_LABEL[t]}
              </button>
            ))}
          </div>
          <Field label={type === 'ajuste' ? 'Quantidade correta agora' : 'Quantidade'}
            hint={type === 'ajuste' ? 'Gera um ajuste com a diferença. Ajuste não conta como venda.' : undefined}>
            <Input inputMode="numeric" pattern="[0-9]*" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))} placeholder="0" autoFocus />
          </Field>
          <Field label="Observação (opcional)"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <Button className="w-full" size="lg" disabled={!valid || busy} onClick={save}>Salvar</Button>
        </>
      )}
      <h3 className="font-bold text-slate-700 mt-5 mb-2">Movimentos do dia</h3>
      <MoveList moves={live?.moves ?? []} locked={locked} />
    </Sheet>
  );
}

function MoveList({ moves, locked, names }: { moves: StockMovement[]; locked: boolean; names?: Map<string, string> }) {
  const { run, confirm } = useUi();
  const reversed = new Set(moves.map((m) => m.reversedMovementId).filter(Boolean));
  if (!moves.length) return <p className="text-sm text-slate-400">Nenhum movimento.</p>;
  return (
    <div className="space-y-1.5">
      {moves.map((m) => (
        <div key={m.id} className="flex items-center gap-2 bg-white rounded-xl border border-slate-200 px-3 py-2 text-sm">
          <span className="text-slate-400 tabular-nums text-xs w-10">{new Date(m.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
          <span className="flex-1 min-w-0">
            <span className="font-semibold">{MOVE_LABEL[m.type]}</span>
            {names && <span className="text-slate-600"> · {names.get(m.variantId)}</span>}
            {m.description && <span className="block text-xs text-slate-500 truncate">{m.description}</span>}
          </span>
          <span className={`font-bold tabular-nums ${m.quantity > 0 ? 'text-emerald-600' : m.quantity < 0 ? 'text-red-600' : 'text-purple-600'}`}>
            {m.quantity > 0 ? '+' : ''}{m.quantity || '—'}
          </span>
          <span className="text-xs text-slate-400 tabular-nums w-12 text-right">{m.previousBalance}→{m.newBalance}</span>
          {!locked && m.quantity !== 0 && !m.orderId && !m.reversedMovementId && !reversed.has(m.id) && (
            <button className="text-xs text-blue-600 font-semibold" onClick={async () => {
              if (await confirm({ title: 'Desfazer movimento?', message: 'Será lançada uma correção inversa. Nada é apagado.', confirm: 'Desfazer' }))
                run(() => undoMovement(m.id), 'Desfeito');
            }}>Desfazer</button>
          )}
        </div>
      ))}
    </div>
  );
}

function MovesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { day } = useApp();
  const data = useLiveQuery(async () => {
    if (!day || !open) return null;
    const [moves, variants, groups] = await Promise.all([
      db.stockMovements.where('dailyRecordId').equals(day.id).reverse().sortBy('createdAt'),
      db.variants.toArray(), db.groups.toArray(),
    ]);
    const g = new Map(groups.map((x) => [x.id, x.name]));
    return { moves, names: new Map(variants.map((v) => [v.id, `${g.get(v.groupId)} ${v.name}`])) };
  }, [day?.id, open]);
  return (
    <Sheet open={open} onClose={onClose} title="Movimentos do dia" tall>
      <MoveList moves={data?.moves ?? []} locked={day?.status !== 'open'} names={data?.names} />
    </Sheet>
  );
}
