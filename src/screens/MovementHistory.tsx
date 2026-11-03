import { variantLabel } from '../services/catalog';
import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { addDays, fmtDate, todayStr } from '../lib/util';
import { useApp } from '../state';
import { Button, Card, InfoTip, Sheet, Swatch, useUi } from '../components/ui';
import { undoMovement } from '../services/days';
import {
  historyEvents, KIND_ICON, KIND_LABEL, productTimeline, type HistEvent, type HistKind, type HistOrigin,
} from '../services/history';

const PERIODS = [
  { k: 'hoje', label: 'Hoje' }, { k: '7', label: '7 dias' }, { k: '30', label: '30 dias' }, { k: 'tudo', label: 'Tudo' }, { k: 'datas', label: 'Escolher' },
] as const;
type Period = (typeof PERIODS)[number]['k'];
const KINDS: HistKind[] = ['inicial', 'nova', 'reposicao', 'entrada', 'importacao', 'venda', 'reserva', 'cancelamento', 'ajuste', 'saida', 'perda', 'desfazer', 'cadastro'];
const ORIGIN_LABEL: Record<HistOrigin, string> = { usuaria: '🙋 Usuária', sistema: '🤖 Sistema', antigo: '🕰️ Registro antigo' };
const tone = (e: HistEvent) =>
  e.kind === 'divergencia' ? 'border-amber-300 bg-amber-50' : (e.delta ?? 0) > 0 ? 'border-emerald-200 bg-white' : (e.delta ?? 0) < 0 ? 'border-red-200 bg-white' : 'border-slate-200 bg-white';
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');

/**
 * Configurações › Histórico de movimentações: a vida de cada peça, com filtros.
 * Abre já filtrado por uma peça quando vem do Estoque, do Vender ou do cadastro.
 */
export default function MovementHistorySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { historyFor, openHistory } = useApp();
  if (!open) return null;
  return (
    <Sheet open onClose={onClose} title="📜 Histórico de movimentações" tall>
      {historyFor
        ? <ProductTimeline variantId={historyFor} onBack={() => openHistory(null)} />
        : <AllEvents onPick={(id) => openHistory(id)} />}
    </Sheet>
  );
}

function AllEvents({ onPick }: { onPick: (variantId: string) => void }) {
  const today = todayStr();
  const [period, setPeriod] = useState<Period>('hoje');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [groupId, setGroupId] = useState('');
  const [variantId, setVariantId] = useState('');
  const [kind, setKind] = useState<HistKind | ''>('');
  const [by, setBy] = useState('');
  const [origin, setOrigin] = useState<HistOrigin | ''>('');
  const range = period === 'hoje' ? [today, today] : period === '7' ? [addDays(today, -6), today] : period === '30' ? [addDays(today, -29), today] : period === 'tudo' ? [undefined, undefined] : [from, to];
  const data = useLiveQuery(() => historyEvents({
    from: range[0], to: range[1], groupId: groupId || undefined, variantId: variantId || undefined,
    kinds: kind ? [kind] : undefined, by: by || undefined, origin: origin || undefined,
  }), [range[0], range[1], groupId, variantId, kind, by, origin]);
  const vOf = useMemo(() => new Map((data?.variants ?? []).map((v) => [v.id, v])), [data?.variants]);
  const gOf = useMemo(() => new Map((data?.groups ?? []).map((g) => [g.id, g])), [data?.groups]);
  const products = (data?.variants ?? []).filter((v) => !groupId || v.groupId === groupId)
    .sort((a, b) => (gOf.get(a.groupId)?.displayOrder ?? 0) - (gOf.get(b.groupId)?.displayOrder ?? 0) || a.displayOrder - b.displayOrder);
  const byDay = new Map<string, HistEvent[]>();
  for (const e of data?.events ?? []) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
  const sel = 'h-10 rounded-xl border border-slate-200 bg-white px-2 text-[14px] min-w-0';
  return (
    <>
      <div className="flex items-start gap-2 mb-3">
        <p className="flex-1 text-[13px] text-slate-600 leading-snug">Tudo o que mexeu no estoque e no cadastro. Toque numa peça para ver a vida dela inteira.</p>
        <InfoTip title="Como ler o histórico" example={[
          ['🙋', 'Usuária: feito à mão (entrada, ajuste, saída, importação)'],
          ['🤖', 'Sistema: o app fez sozinho por causa de uma venda ou reserva'],
          ['🕰️', 'Registro antigo: feito antes de o app guardar quem fez'],
          ['⚠️', 'Divergência: a conta não fecha e não há registro que explique (o app não inventa ajuste)'],
        ]}>Nada é apagado: desfazer cria um registro novo ligado ao original.</InfoTip>
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1 mb-2" role="group" aria-label="Período">
        {PERIODS.map((p) => (
          <button key={p.k} onClick={() => setPeriod(p.k)} aria-pressed={period === p.k}
            className={`h-9 px-3 rounded-full text-[13px] font-semibold shrink-0 border ${period === p.k ? 'bg-slate-800 text-white border-slate-800' : 'bg-white border-slate-200 text-slate-600'}`}>{p.label}</button>
        ))}
      </div>
      {period === 'datas' && (
        <div className="grid grid-cols-2 gap-2 mb-2">
          <input type="date" aria-label="De" className={sel} value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
          <input type="date" aria-label="Até" className={sel} value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 mb-2">
        <select aria-label="Grupo" className={sel} value={groupId} onChange={(e) => { setGroupId(e.target.value); setVariantId(''); }}>
          <option value="">Todos os grupos</option>
          {(data?.groups ?? []).sort((a, b) => a.displayOrder - b.displayOrder).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <select aria-label="Produto" className={sel} value={variantId} onChange={(e) => setVariantId(e.target.value)}>
          <option value="">Todos os produtos</option>
          {products.map((v) => <option key={v.id} value={v.id}>{gOf.get(v.groupId)?.name} › {variantLabel(v)}{v.deletedAt ? ' (excluída)' : v.archivedAt ? ' (arquivada)' : ''}</option>)}
        </select>
        <select aria-label="Tipo" className={sel} value={kind} onChange={(e) => setKind(e.target.value as HistKind | '')}>
          <option value="">Todos os tipos</option>
          {KINDS.map((k) => <option key={k} value={k}>{KIND_ICON[k]} {KIND_LABEL[k]}</option>)}
        </select>
        <select aria-label="Quem" className={sel} value={by} onChange={(e) => setBy(e.target.value)}>
          <option value="">Qualquer pessoa</option>
          {(data?.users ?? []).map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1 mb-3" role="group" aria-label="Origem">
        {(['', 'usuaria', 'sistema', 'antigo'] as const).map((o) => (
          <button key={o || 'todas'} onClick={() => setOrigin(o)} aria-pressed={origin === o}
            className={`h-9 px-3 rounded-full text-[13px] font-semibold shrink-0 border ${origin === o ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-slate-200 text-slate-600'}`}>
            {o ? ORIGIN_LABEL[o] : 'Toda origem'}
          </button>
        ))}
      </div>
      {!data ? <p className="text-center text-slate-400 py-8">Carregando…</p>
        : !data.events.length ? <p className="text-center text-slate-500 py-8">Nada neste período com estes filtros.</p>
          : [...byDay.entries()].map(([date, evs]) => (
            <div key={date} className="mb-3">
              <div className="text-[12px] font-bold uppercase tracking-wide text-slate-400 mb-1.5 px-1">{fmtDate(date, false)} · {evs.length} registro{evs.length > 1 ? 's' : ''}</div>
              <div className="space-y-1.5">
                {evs.map((e) => {
                  const v = vOf.get(e.variantId);
                  return <EventRow key={e.id} e={e} product={v ? `${gOf.get(v.groupId)?.name ?? ''} › ${variantLabel(v)}` : 'peça'} color={v?.color} onProduct={() => onPick(e.variantId)} />;
                })}
              </div>
            </div>
          ))}
    </>
  );
}

/** Um registro: o resumo numa linha; tocar abre os detalhes (antes → depois, quem, referência, desfazer). */
function EventRow({ e, product, color, onProduct }: { e: HistEvent; product?: string; color?: string; onProduct?: () => void }) {
  const [open, setOpen] = useState(false);
  const { run, confirm } = useUi();
  const undo = async () => {
    const today = await db.dailyRecords.where('date').equals(todayStr()).first();
    const now = today ? (await db.dailyStockItems.where('[dailyRecordId+variantId]').equals([today.id, e.variantId]).first())?.currentQuantity ?? 0 : null;
    const after = now === null ? null : now - (e.delta ?? 0);
    if (!(await confirm({
      title: `Desfazer ${KIND_LABEL[e.kind].toLowerCase()} ${signed(e.delta ?? 0)}?`, confirm: 'Desfazer', tone: 'warning',
      message: now === null ? 'O desfazimento entra no dia de hoje (inicie o dia primeiro).'
        : `Antes: ${now} · Desfazer ${signed(e.delta ?? 0)} · Depois: ${after}. O registro original continua no histórico e o desfazimento fica registrado.`,
    }))) return;
    await run(() => undoMovement(e.movementId!), 'Desfeito (o original ficou no histórico)');
  };
  return (
    <div className={`rounded-xl border ${tone(e)} px-3 py-2`}>
      <button className="w-full text-left flex items-start gap-2" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`${KIND_LABEL[e.kind]} ${product ?? ''}`}>
        <span className="text-lg leading-none mt-0.5" aria-hidden>{KIND_ICON[e.kind]}</span>
        <span className="flex-1 min-w-0">
          <span className={`block text-[14px] font-semibold ${e.kind === 'divergencia' ? 'text-amber-800' : 'text-slate-800'}`}>{e.text}{e.undone ? ' · desfeito' : ''}</span>
          {product && <span className="flex items-center gap-1 text-[12px] text-slate-500 min-w-0">{color !== undefined && <Swatch color={color} size={12} />}<span className="truncate">{product}</span></span>}
        </span>
        <span className="text-right shrink-0">
          <span className="block text-[12px] text-slate-400 tabular-nums">{e.kind === 'inicial' ? '' : hhmm(e.at)}</span>
          {e.before !== undefined && e.after !== undefined && e.kind !== 'inicial' && <span className="block text-[13px] font-bold tabular-nums text-slate-700">{e.before} → {e.after}</span>}
        </span>
      </button>
      {open && (
        <div className="mt-2 pt-2 border-t border-slate-100 text-[13px] text-slate-700 space-y-0.5">
          <div>Tipo: <b>{KIND_LABEL[e.kind]}</b></div>
          {e.kind !== 'inicial' && <div>Data e hora: <b>{fmtDate(e.date, false)} {e.kind === 'divergencia' ? '' : hhmm(e.at)}</b></div>}
          {e.before !== undefined && <div>Antes: <b>{e.before}</b> · Movimentou: <b>{signed(e.delta ?? 0)}</b> · Depois: <b>{e.after}</b></div>}
          <div>Origem: <b>{ORIGIN_LABEL[e.origin]}</b>{e.by ? <> · por <b>{e.by}</b></> : null}</div>
          {e.ref && <div>Referência: <b>{e.ref.type === 'venda' ? 'venda' : e.ref.type === 'importacao' ? 'importação' : e.ref.type === 'movimento' ? 'desfaz o registro' : 'reserva'} {e.ref.id.slice(0, 8)}</b></div>}
          {e.reason && <div>Motivo: <b>{e.reason}</b></div>}
          <div className="flex gap-2 pt-1.5">
            {onProduct && <Button size="sm" variant="outline" onClick={onProduct}>📜 Vida desta peça</Button>}
            {e.undoable && e.movementId && <Button size="sm" variant="soft" onClick={undo}>↩️ Desfazer</Button>}
          </div>
        </div>
      )}
    </div>
  );
}

/** Linha do tempo de uma peça: dia a dia, “começou → registros → terminou”, com divergências apontadas. */
function ProductTimeline({ variantId, onBack }: { variantId: string; onBack: () => void }) {
  const data = useLiveQuery(() => productTimeline(variantId), [variantId]);
  const [showAll, setShowAll] = useState(false);
  if (!data) return <p className="text-center text-slate-400 py-8">Carregando…</p>;
  const days = showAll ? data.days : data.days.slice(-7);
  const divs = data.days.reduce((n, d) => n + (d.gap ? 1 : 0) + (d.carryGap ? 1 : 0), 0);
  return (
    <>
      <button className="text-sm font-semibold text-blue-600 mb-2" onClick={onBack}>← Todas as peças</button>
      <Card className="p-3 mb-3 flex items-center gap-3">
        <Swatch color={data.variant?.color} size={30} />
        <div className="flex-1 min-w-0">
          <div className="font-bold text-slate-800 text-[17px] break-words">{data.group?.name} › {data.variant ? variantLabel(data.variant) : ''}</div>
          <div className="text-[12px] text-slate-500">
            {data.days.length} dia{data.days.length === 1 ? '' : 's'} com registro
            {data.variant?.deletedAt ? ' · excluída (histórico guardado)' : data.variant?.archivedAt ? ' · arquivada' : ''}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px] text-slate-500">agora</div>
          <div className="text-2xl font-extrabold text-blue-600 tabular-nums">{data.days[data.days.length - 1]?.end ?? 0}</div>
        </div>
      </Card>
      {divs > 0 && (
        <div role="alert" className="rounded-xl bg-amber-50 border border-amber-300 px-3 py-2 mb-3 text-[13px] text-amber-900">
          ⚠️ {divs} divergência{divs > 1 ? 's' : ''} sem registro que explique. O app mostra a diferença e não inventa ajuste.
        </div>
      )}
      {data.days.length > 7 && !showAll && (
        <button className="w-full text-[13px] font-semibold text-blue-600 mb-2" onClick={() => setShowAll(true)}>Ver desde o começo ({data.days.length} dias)</button>
      )}
      {!data.days.length && <p className="text-center text-slate-500 py-8">Esta peça ainda não tem registro em nenhum dia.</p>}
      {days.map((d) => (
        <div key={d.date} className="mb-4">
          <div className="flex items-center gap-2 mb-1.5 px-1">
            <span className="text-[13px] font-bold text-slate-700">{fmtDate(d.date, false)}</span>
            <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 ${d.status === 'closed' ? 'bg-purple-100 text-purple-700' : 'bg-emerald-100 text-emerald-700'}`}>{d.status === 'closed' ? 'encerrado' : 'aberto'}</span>
          </div>
          <ol className="relative border-l-2 border-slate-200 ml-3 pl-4 space-y-1.5">
            {d.events.map((e) => (
              <li key={e.id} className="relative">
                <span className="absolute -left-[23px] top-2.5 w-3 h-3 rounded-full bg-white border-2 border-slate-300" aria-hidden />
                <EventRow e={e} />
              </li>
            ))}
            <li className="relative">
              <span className="absolute -left-[23px] top-1.5 w-3 h-3 rounded-full bg-blue-600" aria-hidden />
              <div className="text-[14px] font-bold text-slate-800 py-1">{d.status === 'closed' ? 'Terminou o dia com' : 'Agora'} {d.end} {d.end === 1 ? 'peça' : 'peças'}</div>
            </li>
          </ol>
        </div>
      ))}
    </>
  );
}
