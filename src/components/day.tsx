import { useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { addDays, fmtDate, money, parseDate, todayStr, weekday } from '../lib/util';
import { previousDay, reopenDay, resyncFromPrevious, startDay } from '../services/days';
import { computeCash, syncGap } from '../services/summary';
import { useApp } from '../state';
import { Button, Card, useBusy, useUi } from './ui';

const WEEK_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/**
 * Seleção de dia: faixa com 7 dias (um toque troca), bolinha de situação em cada dia
 * e 📅 para qualquer outra data. Nada é criado só por navegar.
 */
export function DayBar() {
  const { date, setDate, day } = useApp();
  const ref = useRef<HTMLInputElement>(null);
  const today = todayStr();
  // a faixa termina em hoje; se a data escolhida for mais antiga, a faixa acompanha
  const end = date > today ? date : date < addDays(today, -6) ? addDays(date, 3) : today;
  const days = Array.from({ length: 7 }, (_, i) => addDays(end, i - 6));
  const status = useLiveQuery(async () => {
    const recs = await db.dailyRecords.where('date').between(days[0], days[6], true, true).toArray();
    return new Map(recs.map((r) => [r.date, r.status]));
  }, [days[0], days[6]]) ?? new Map();
  const d = parseDate(date);
  const label = date === today ? 'Hoje' : date === addDays(today, -1) ? 'Ontem' : weekday(date);
  return (
    <div className="mb-3">
      <div className="flex items-stretch gap-1 bg-white rounded-2xl border border-slate-200 p-1">
        {days.map((x) => {
          const sel = x === date;
          const st = status.get(x);
          return (
            <button key={x} onClick={() => setDate(x)} aria-label={fmtDate(x)}
              className={`flex-1 min-w-0 rounded-xl py-1.5 flex flex-col items-center transition
                ${sel ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 active:bg-slate-100'}`}>
              <span className={`text-[10px] font-semibold uppercase ${sel ? 'text-blue-100' : x === today ? 'text-blue-600' : 'text-slate-400'}`}>
                {x === today ? 'Hoje' : WEEK_SHORT[parseDate(x).getDay()]}
              </span>
              <span className="text-lg font-extrabold leading-tight tabular-nums">{Number(x.slice(8))}</span>
              <span className={`w-1.5 h-1.5 rounded-full mt-0.5 ${!st ? 'bg-transparent' : st === 'closed' ? (sel ? 'bg-purple-200' : 'bg-purple-500') : (sel ? 'bg-emerald-200' : 'bg-emerald-500')}`} />
            </button>
          );
        })}
        <button onClick={() => ref.current?.showPicker?.() ?? ref.current?.click()} aria-label="Outra data"
          className="relative w-11 shrink-0 rounded-xl text-xl text-slate-600 active:bg-slate-100 flex items-center justify-center">
          📅
          <input ref={ref} type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)}
            className="absolute inset-0 opacity-0 pointer-events-none" tabIndex={-1} />
        </button>
      </div>
      <div className="flex items-center justify-between px-1.5 mt-1.5 text-[13px]">
        <span className="font-semibold text-slate-700">
          {label}, {d.getDate()} de {MONTHS[d.getMonth()]}
        </span>
        <span className="flex items-center gap-2">
          {day === null && <span className="text-slate-500">○ não iniciado</span>}
          {day?.status === 'open' && <span className="text-emerald-700 font-semibold">● aberto</span>}
          {day?.status === 'closed' && <span className="text-purple-700 font-semibold">🔒 encerrado</span>}
          {date !== today && <button className="text-blue-600 font-semibold underline" onClick={() => setDate(today)}>ir para hoje</button>}
        </span>
      </div>
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
    if (mode === 'blank' && !(await confirm({ title: 'Começar com estoque zerado?', tone: 'danger', confirm: 'Começar zerado',
      message: 'Todas as quantidades começam em 0 e o caixa em 0. Normalmente o certo é “Iniciar o dia”, que copia o estoque de ontem.' }))) return;
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
