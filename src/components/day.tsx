import { useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { addDays, fmtDate, money, parseDate, todayStr, weekday } from '../lib/util';
import { closeDay, dayIsEmpty, previousDay, reopenDay, resyncFromPrevious, startDay, undoStartDay } from '../services/days';
import { computeCash, syncGap } from '../services/summary';
import { ensureDailyPay } from '../services/cash';
import { requestPersist } from '../services/storage';
import { useApp } from '../state';
import { Button, Card, InfoTip, useBusy, useUi } from './ui';

const WEEK_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/**
 * Seleção de dia: faixa com 7 dias (um toque troca), bolinha de situação em cada dia
 * e 📅 para qualquer outra data. Nada é criado só por navegar.
 */
export function DayBar({ compact }: { compact?: boolean } = {}) {
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
        {days.map((x, idx) => {
          const sel = x === date;
          const st = status.get(x);
          return (
            <button key={x} onClick={() => setDate(x)} aria-label={fmtDate(x)}
              // tela estreita (iPhone SE): mostra 5 dias para cada um ter área de toque boa
              className={`flex-1 min-w-0 rounded-xl py-1.5 flex flex-col items-center transition ${idx < 2 ? 'max-[359px]:hidden' : ''}
                ${sel ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 active:bg-slate-100'}`}>
              <span className={`text-[10px] font-semibold uppercase ${sel ? 'text-blue-100' : x === today ? 'text-blue-600' : 'text-slate-400'}`}>
                {x === today ? 'Hoje' : WEEK_SHORT[parseDate(x).getDay()]}
              </span>
              <span className="text-lg font-extrabold leading-tight tabular-nums">{Number(x.slice(8))}</span>
              <span className={`w-1.5 h-1.5 rounded-full mt-0.5 ${!st ? 'bg-transparent' : st === 'closed' ? (sel ? 'bg-purple-200' : 'bg-purple-500') : (sel ? 'bg-emerald-200' : 'bg-emerald-500')}`} />
            </button>
          );
        })}
        {/* o próprio campo de data fica por cima do 📅 (invisível): tocar nele abre o calendário do celular.
            No iPhone o calendário só abre tocando no campo (abrir “por código” um campo escondido não funciona). */}
        <span className="relative w-11 shrink-0 rounded-xl text-xl text-slate-600 active:bg-slate-100 flex items-center justify-center">
          <span aria-hidden>📅</span>
          <input ref={ref} type="date" aria-label="Outra data" value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            onClick={() => { try { ref.current?.showPicker?.(); } catch { /* o toque já abre o calendário */ } }}
            className="absolute inset-0 w-full h-full min-w-0 opacity-0 cursor-pointer text-base appearance-none" />
        </span>
      </div>
      {date === today && compact && day?.status === 'open' ? null : date === today ? (
        <div className="mt-2 flex items-center gap-3 bg-white rounded-xl border border-slate-200 pl-3 pr-2 py-2">
          <span className="w-10 h-10 shrink-0 rounded-lg bg-blue-600 text-white flex flex-col items-center justify-center leading-none">
            <span className="text-[9px] font-bold uppercase opacity-90">{MONTHS[d.getMonth()].slice(0, 3)}</span>
            <span className="text-[17px] font-extrabold">{d.getDate()}</span>
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-[15px] font-bold text-slate-800 leading-tight">Hoje</span>
            <span className="block text-[13px] text-slate-500 leading-tight break-words">{weekday(date)}, {d.getDate()} de {MONTHS[d.getMonth()]}</span>
          </span>
          <StatusChip status={day === undefined ? undefined : day?.status ?? null} />
          <DayLegend />
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-2 bg-amber-50 border-2 border-amber-300 rounded-xl pl-3 pr-1.5 py-1.5">
          <span className="flex-1 min-w-0 text-[13px] text-amber-900 leading-tight">
            Você está vendo <b>{label}, {d.getDate()}/{String(d.getMonth() + 1).padStart(2, '0')}</b>
            <span className="flex items-center gap-2 mt-0.5"><StatusChip status={day === undefined ? undefined : day?.status ?? null} /><DayLegend /></span>
          </span>
          <button className="h-10 px-3 rounded-lg bg-blue-600 text-white text-sm font-bold whitespace-nowrap" onClick={() => setDate(today)}>↩ Voltar para hoje</button>
        </div>
      )}
    </div>
  );
}


/** Mini dia igual ao da faixa, para a legenda. */
function MiniDay({ dot, selected, today }: { dot?: string; selected?: boolean; today?: boolean }) {
  return (
    <span className={`inline-flex flex-col items-center justify-center w-9 h-11 rounded-lg border ${selected ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-200 text-slate-700'}`}>
      <span className={`text-[8px] font-bold ${selected ? 'text-blue-100' : today ? 'text-blue-600' : 'text-slate-400'}`}>{today ? 'HOJE' : 'SEX'}</span>
      <span className="text-[13px] font-extrabold leading-none">30</span>
      <span className={`w-1.5 h-1.5 rounded-full mt-0.5 ${dot ?? 'bg-transparent'}`} />
    </span>
  );
}

/** ⓘ com a legenda das bolinhas da faixa de dias. */
export function DayLegend() {
  return (
    <InfoTip title="O que significam as bolinhas" example={[
      [<MiniDay dot="bg-emerald-500" />, <><b className="text-emerald-700">Verde = dia aberto</b><br />Dá para vender e lançar.</>],
      [<MiniDay dot="bg-purple-500" />, <><b className="text-purple-700">Roxa = dia encerrado</b><br />Só consulta. Dá para reabrir se precisar.</>],
      [<MiniDay />, <><b className="text-slate-700">Sem bolinha = não iniciado</b><br />Esse dia ainda não tem registro.</>],
      [<MiniDay selected dot="bg-emerald-200" />, <><b className="text-blue-700">Azul cheio = o dia que você está vendo</b></>],
      [<MiniDay today dot="bg-emerald-500" />, <><b className="text-blue-700">“HOJE” em azul = a data de hoje</b></>],
    ]}>
      Cada dia da faixa mostra a situação com uma bolinha embaixo do número. Toque em um dia para ver como ele ficou.
    </InfoTip>
  );
}

function StatusChip({ status }: { status: 'open' | 'closed' | null | undefined }) {
  if (status === undefined) return null;
  const st = status === 'open' ? ['bg-emerald-100 text-emerald-800', 'bg-emerald-500', 'Dia aberto']
    : status === 'closed' ? ['bg-purple-100 text-purple-800', 'bg-purple-500', 'Encerrado'] : ['bg-slate-100 text-slate-600', 'bg-slate-300', 'Não iniciado'];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-bold whitespace-nowrap ${st[0]}`}>
      <span className={`w-2 h-2 rounded-full ${st[1]}`} />{st[2]}
    </span>
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
    return { prev, units: items.reduce((s, i) => s + i.currentQuantity, 0), cash: (await computeCash(prev.id)).accumulated, autoClosed: !!prev.autoClosedAt };
  }, [date]);
  const { confirm } = useUi();
  const { setDate, setOverlay, settings } = useApp();
  const today = todayStr();
  const lastBackup = settings.lastBackupAt ? new Date(settings.lastBackupAt) : null;
  const kind = date === today ? 'today' : date < today ? 'past' : 'future';
  const start = (mode: 'copy' | 'blank') => wrap(async () => {
    if (mode === 'blank' && !(await confirm({ title: 'Começar com estoque zerado?', tone: 'danger', confirm: 'Começar zerado',
      message: 'Todas as quantidades começam em 0 e o caixa em 0. Normalmente o certo é “Iniciar o dia”, que copia o estoque do último dia.' }))) return;
    requestPersist().catch(() => undefined); // um toque da pessoa: alguns navegadores só protegem assim
    await run(async () => { const d = await startDay(date, mode); await ensureDailyPay(d.id); return d; }, mode === 'copy' ? 'Dia iniciado!' : 'Dia criado zerado');
  });
  const fromLabel = info?.prev ? fmtDate(info.prev.date, false) : null;
  const choices = (
    <>
      <div className="flex items-center justify-between mt-1 mb-2">
        <span className="text-sm font-semibold text-slate-700">Como começar {kind === 'today' ? 'o dia' : 'este dia'}?</span>
        <InfoTip title="Continuar ou começar do zero?"
          example={[
            ['▶️', <><b>Continuar:</b> ontem terminou com 14 Plomo Vermelho e 210 no caixa</>],
            ['📦', 'Hoje começa com 14 peças e “Ontem 210”'],
            ['0️⃣', <><b>Do zero:</b> tudo começa em 0, peças e caixa</>],
            ['🔢', 'Use só se for contar o estoque inteiro de novo'],
          ]}>
          Quase sempre o certo é <b>continuar</b>: o app copia o estoque e o caixa do último dia. O dia anterior não muda.
        </InfoTip>
      </div>
      <button disabled={busy} onClick={() => start('copy')}
        className="w-full text-left rounded-2xl border-2 border-emerald-500 bg-emerald-50 px-4 py-3 active:bg-emerald-100 disabled:opacity-50">
        <div className="flex items-center gap-2">
          <span className="text-xl">▶</span>
          <span className="flex-1 font-bold text-emerald-800 text-[16px]">{kind === 'today' ? 'Iniciar o dia' : 'Registrar este dia'} · continuar</span>
          <span className="text-[10px] font-bold uppercase bg-emerald-600 text-white rounded-full px-2 py-0.5">recomendado</span>
        </div>
        <div className="text-[13px] text-emerald-900/80 mt-1 pl-7">
          {info ? (fromLabel
            ? <>Começa com <b>{info.units} peças</b> e caixa <b>{money(info.cash)}</b>, como terminou {fromLabel}.</>
            : <>Começa com o estoque cadastrado: <b>{info.units} peças</b>.</>) : '…'}
        </div>
      </button>
      <button disabled={busy} onClick={() => start('blank')}
        className="w-full text-left rounded-2xl border border-slate-200 bg-white px-4 py-3 mt-2 active:bg-slate-50 disabled:opacity-50">
        <div className="flex items-center gap-2">
          <span className="text-xl">0️⃣</span>
          <span className="flex-1 font-semibold text-slate-700 text-[15px]">Começar do zero</span>
        </div>
        <div className="text-[13px] text-slate-500 mt-1 pl-7">Todas as peças em 0 e caixa 0. Só para recontar o estoque inteiro.</div>
      </button>
    </>
  );
  return (
    <Card className="p-5 bg-gradient-to-b from-white to-blue-50/60">
      {kind === 'today' ? (
        <>
          <div className="text-center">
            <div className="text-4xl mb-1">☀️</div>
            <div className="text-lg font-bold text-slate-800">Bom dia! Vamos começar?</div>
          </div>
          {info?.prev && info.autoClosed && (
            <div className="mt-3 rounded-xl bg-indigo-50 border border-indigo-200 px-3 py-2 text-[14px] text-indigo-900">
              🌙 O dia <b>{fmtDate(info.prev.date, false)}</b> foi encerrado sozinho quando virou a data.
            </div>
          )}
          <div className="mt-3 rounded-2xl border-2 border-sky-300 bg-gradient-to-br from-sky-50 to-white p-3.5" aria-label="Último backup">
            <div className="flex items-center gap-3">
              <span className="text-3xl leading-none">💾</span>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-bold uppercase tracking-wide text-sky-700">Último backup</div>
                <div className="text-[17px] font-bold text-slate-800 tabular-nums">
                  {lastBackup
                    ? <>{fmtDate(todayStr(lastBackup), false)} às {lastBackup.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</>
                    : 'Ainda não fez backup'}
                </div>
              </div>
            </div>
            <p className="text-[14px] text-slate-700 mt-2">Quer fazer {lastBackup ? 'outro' : 'um'} backup agora, antes de começar?</p>
            <Button className="w-full mt-2" variant="soft" onClick={() => setOverlay('backup')}>💾 Sim, fazer backup agora</Button>
          </div>
          <div className="mt-3">{choices}</div>
          {info && !info.prev && (
            <button className="mt-3 w-full h-11 rounded-xl border border-blue-200 bg-blue-50 text-blue-700 text-sm font-semibold" onClick={() => setOverlay('transferir')}>
              📲 Já usa o app em outro celular? Receber os dados
            </button>
          )}
        </>
      ) : (
        <>
          <div className="text-center">
            <div className="text-4xl mb-1">{kind === 'past' ? '📅' : '⏳'}</div>
            <div className="text-lg font-bold text-slate-800">
              {kind === 'past' ? `${weekday(date)}, ${fmtDate(date, false)} não foi registrado` : `${weekday(date)}, ${fmtDate(date, false)} ainda não chegou`}
            </div>
            <div className="text-sm text-slate-600 mt-1 mb-3">
              {kind === 'past' ? 'Só registre se você trabalhou neste dia e esqueceu de lançar.' : 'Normalmente não é preciso registrar dias futuros.'}
            </div>
          </div>
          <Button size="lg" className="w-full" onClick={() => setDate(today)}>↩ Voltar para hoje</Button>
          <details className="mt-3 group">
            <summary className="text-sm text-slate-500 text-center cursor-pointer list-none underline">Quero registrar {kind === 'past' ? 'este dia' : 'mesmo assim'}</summary>
            <div className="mt-3">{choices}</div>
          </details>
        </>
      )}
    </Card>
  );
}

/** Avisos do dia selecionado: encerrado (reabrir), dia anterior corrigido (atualizar), começou errado (desfazer). */
export function DayNotices() {
  return <><ReopenedOpenBanner /><ClosedBanner /><SyncBanner /><UndoStartBanner /></>;
}

/** Dia antigo reaberto de propósito não fecha sozinho: se ficar esquecido aberto, avisa. */
function ReopenedOpenBanner() {
  const { date, setDate } = useApp();
  const { run, confirm } = useUi();
  const days = useLiveQuery(async () => (await db.dailyRecords.where('status').equals('open').toArray())
    .filter((d) => d.reopenedAt && d.date < todayStr()).sort((a, b) => (a.date < b.date ? -1 : 1)), []);
  if (!days?.length) return null;
  return (
    <>
      {days.map((d) => (
        <div key={d.id} role="status" aria-label={`Dia ${fmtDate(d.date, false)} reaberto`}
          className="flex items-center gap-2 rounded-2xl bg-orange-50 border border-orange-200 px-3 py-2.5 mb-3">
          <span className="text-xl shrink-0" aria-hidden>📂</span>
          <span className="flex-1 min-w-0 text-[13px] leading-snug text-orange-900">
            O dia <b>{fmtDate(d.date, false)}</b> foi reaberto e continua aberto.
          </span>
          {d.date !== date && (
            <button className="shrink-0 h-9 px-2.5 rounded-xl bg-white border border-orange-300 text-[13px] font-bold text-orange-800" onClick={() => setDate(d.date)}>Ver</button>
          )}
          <button className="shrink-0 h-9 px-2.5 rounded-xl bg-orange-500 text-white text-[13px] font-bold" onClick={async () => {
            if (await confirm({ title: `Encerrar ${fmtDate(d.date, false)}?`, message: 'O dia volta a ficar só para consulta. Dá para reabrir de novo.', confirm: 'Encerrar' }))
              run(() => closeDay(d.id), 'Dia encerrado');
          }}>Encerrar</button>
        </div>
      ))}
    </>
  );
}

/** Enquanto nada foi lançado no dia, dá para voltar e escolher de novo (continuar x do zero). */
function UndoStartBanner() {
  const { day } = useApp();
  const { run, confirm } = useUi();
  const empty = useLiveQuery(async () => (day && day.status === 'open' ? dayIsEmpty(day.id) : false), [day?.id, day?.status]);
  if (!empty || !day) return null;
  const how = day.sourceDate ? `continuando de ${fmtDate(day.sourceDate, false)}` : 'do zero ou com o estoque cadastrado';
  return (
    <div className="flex items-center gap-2.5 rounded-2xl bg-amber-50 border border-amber-200 px-3 py-2.5 mb-3">
      <span className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center text-lg shrink-0" aria-hidden>🌅</span>
      <span className="flex-1 min-w-0 leading-snug">
        <span className="block text-[13px] font-bold text-amber-900">Começou do jeito errado?</span>
        <span className="block text-[12px] text-slate-600">Dia iniciado {how}</span>
      </span>
      <InfoTip title="Desfazer o início do dia" example={[
        ['🌅', <>Você tocou em <b>Iniciar o dia</b> mas escolheu errado (do zero em vez de continuar)</>],
        ['↩️', <>Toque em <b>Desfazer</b>: o dia volta a “não iniciado”</>],
        ['👆', 'Escolha de novo: continuar de ontem ou começar do zero'],
        ['🔒', 'Só aparece enquanto nada foi lançado: na primeira venda ou movimento, some'],
      ]}>Serve para corrigir a escolha do início do dia sem perder nada.</InfoTip>
      <button className="shrink-0 h-9 px-3 rounded-xl bg-white border border-amber-300 text-[13px] font-bold text-amber-800 whitespace-nowrap active:bg-amber-100" onClick={async () => {
        if (await confirm({ title: 'Desfazer o início do dia?', confirm: 'Desfazer e escolher de novo',
          message: 'Como ainda não há nada lançado hoje, o dia volta a “não iniciado” e você escolhe de novo entre continuar ou começar do zero.' }))
          run(() => undoStartDay(day.id), 'Pronto, escolha de novo');
      }}>Desfazer</button>
    </div>
  );
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
