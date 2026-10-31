import { useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { addDays, fmtDate, money, todayStr } from '../lib/util';
import { previousDay, reopenDay, resyncFromPrevious, startDay } from '../services/days';
import { computeCash, syncGap } from '../services/summary';
import { useApp } from '../state';
import { Badge, Button, Card, useBusy, useUi } from './ui';

export function DayBar() {
  const { date, setDate, day } = useApp();
  const ref = useRef<HTMLInputElement>(null);
  const today = todayStr();
  return (
    <div className="flex items-center gap-1.5 mb-3">
      <button className="w-10 h-10 rounded-xl bg-white border border-slate-200 text-slate-600 text-lg active:bg-slate-100"
        onClick={() => setDate(addDays(date, -1))} aria-label="Dia anterior">‹</button>
      <button className="flex-1 h-10 rounded-xl bg-white border border-slate-200 px-3 flex items-center justify-center gap-2 relative active:bg-slate-50"
        onClick={() => ref.current?.showPicker?.() ?? ref.current?.click()}>
        <span className="text-sm font-bold text-slate-800 whitespace-nowrap">📅 {fmtDate(date)}</span>
        {day === null && <Badge>sem registro</Badge>}
        {day?.status === 'open' && <Badge tone="green">aberto</Badge>}
        {day?.status === 'closed' && <Badge tone="purple">encerrado</Badge>}
        <input ref={ref} type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)}
          className="absolute inset-0 opacity-0 pointer-events-none" tabIndex={-1} />
      </button>
      <button className="w-10 h-10 rounded-xl bg-white border border-slate-200 text-slate-600 text-lg active:bg-slate-100"
        onClick={() => setDate(addDays(date, 1))} aria-label="Próximo dia">›</button>
      {date !== today && (
        <button className="h-10 px-3 rounded-xl bg-blue-600 text-white text-sm font-semibold" onClick={() => setDate(today)}>Hoje</button>
      )}
    </div>
  );
}

/** Aparece quando a data selecionada ainda não tem registro: oferece "Iniciar o dia". */
export function StartDayCard() {
  const { date } = useApp();
  const { run } = useUi();
  const [busy, wrap] = useBusy();
  const info = useLiveQuery(async () => {
    const prev = await previousDay(date);
    if (!prev) {
      const vs = await db.variants.toArray();
      return { prev: null, units: vs.filter((v) => !v.archivedAt).reduce((s, v) => s + v.startQuantity, 0), cash: 0 };
    }
    const items = await db.dailyStockItems.where('dailyRecordId').equals(prev.id).toArray();
    return { prev, units: items.reduce((s, i) => s + i.currentQuantity, 0), cash: (await computeCash(prev.id)).accumulated };
  }, [date]);
  const isToday = date === todayStr();
  const { confirm } = useUi();
  const start = (mode: 'copy' | 'blank') => wrap(async () => {
    if (date > todayStr() && !(await confirm({ title: 'Iniciar um dia no futuro?', message: `${fmtDate(date)} ainda não chegou.`, confirm: 'Iniciar mesmo assim', tone: 'warning' }))) return;
    await run(() => startDay(date, mode), mode === 'copy' ? 'Dia iniciado!' : 'Dia criado em branco');
  });
  return (
    <Card className="p-5 text-center bg-gradient-to-b from-white to-blue-50/60">
      <div className="text-4xl mb-1">{isToday ? '☀️' : '🗓️'}</div>
      <div className="text-lg font-bold text-slate-800">{isToday ? 'Bom dia! Vamos começar?' : `Sem registro em ${fmtDate(date, false)}`}</div>
      {info && (
        <div className="text-sm text-slate-600 mt-1 mb-4">
          {info.prev
            ? <>Estoque vem de <b>{fmtDate(info.prev.date)}</b>: <b>{info.units}</b> peças · saldo <b>{money(info.cash)}</b></>
            : <>Primeiro dia: começa com a carga inicial (<b>{info.units}</b> peças)</>}
        </div>
      )}
      <Button size="lg" variant="success" className="w-full text-lg" disabled={busy} onClick={() => start('copy')}>
        ▶ Iniciar o dia
      </Button>
      <button className="mt-3 text-sm text-slate-500 underline" disabled={busy} onClick={() => start('blank')}>Começar em branco</button>
    </Card>
  );
}

/** Avisos do dia selecionado: encerrado (reabrir) e dia anterior corrigido depois (atualizar). */
export function DayNotices() {
  return <><ClosedBanner /><SyncBanner /></>;
}

function SyncBanner() {
  const { day } = useApp();
  const { run, confirm } = useUi();
  const gap = useLiveQuery(() => (day && day.status === 'open' ? syncGap(day.id) : Promise.resolve(null)), [day?.id, day?.status]);
  if (!gap || !day) return null;
  return (
    <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-900 rounded-xl px-3 py-2 mb-3 text-sm">
      <span className="flex-1">⚠ {fmtDate(gap.prevDate, false)} foi alterado depois que este dia começou ({gap.units} {gap.units === 1 ? 'peça' : 'peças'} de diferença).</span>
      <button className="font-semibold underline whitespace-nowrap" onClick={async () => {
        if (await confirm({ title: 'Atualizar estoque inicial?', confirm: 'Atualizar',
          message: `O início deste dia passa a ser o saldo final de ${fmtDate(gap.prevDate, false)}. As vendas e movimentos de hoje continuam e o saldo atual muda na mesma diferença.` }))
          run(() => resyncFromPrevious(day.id), 'Estoque atualizado');
      }}>Atualizar</button>
    </div>
  );
}

function ClosedBanner() {
  const { day } = useApp();
  const { run, confirm } = useUi();
  if (day?.status !== 'closed') return null;
  return (
    <div className="flex items-center gap-2 bg-purple-50 border border-purple-200 text-purple-800 rounded-xl px-3 py-2 mb-3 text-sm">
      <span className="flex-1">🔒 Dia encerrado — só consulta.</span>
      <button className="font-semibold underline" onClick={async () => {
        if (await confirm({ title: 'Reabrir o dia?', message: 'Você poderá alterar estoque, vendas e caixa deste dia. A reabertura fica registrada.', confirm: 'Reabrir', tone: 'warning' }))
          run(() => reopenDay(day.id), 'Dia reaberto');
      }}>Reabrir</button>
    </div>
  );
}
