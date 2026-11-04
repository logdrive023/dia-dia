import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { CashMovement, CashType, PaymentMethod, Sale } from '../db/types';
import { addDays, money, PAYMENT_EMOJI, PAYMENT_LABEL, PAYMENTS, toCents, todayStr } from '../lib/util';
import { addCashMovement, CASH_IN, CASH_LABEL, removeCashMovement, setCountedBalance, setOpeningBalance, updateNotebookSale } from '../services/cash';
import { activeReservedByVariant, cancelOrder, confirmPix, correctOrderPrices, pixStatus, reservationsOfOrder, returnSaleItem, swapSaleItem } from '../services/sales';
import { cashStatement, daySummary, loadStockRows } from '../services/summary';
import { useApp } from '../state';
import { DayNotices, DayBar, StartDayCard } from '../components/day';
import { Button, Card, Empty, Field, Input, InfoTip, Sheet, Swatch, useBusy, useUi } from '../components/ui';

type ManualType = Exclude<CashType, 'venda' | 'estorno'>;
const MANUAL: { type: ManualType; label: string; icon: string; tone: string; hint: string }[] = [
  { type: 'dar', label: 'Dei dinheiro', icon: '🤝', tone: 'bg-orange-50 text-orange-700 border-orange-200', hint: 'Ex.: Chico 50 — eu dei. Sai do total de hoje.' },
  { type: 'entrada', label: 'Entrada', icon: '➕', tone: 'bg-emerald-50 text-emerald-700 border-emerald-200', hint: 'Dinheiro que entrou sem ser venda.' },
  { type: 'despesa', label: 'Despesa', icon: '🧾', tone: 'bg-red-50 text-red-700 border-red-200', hint: 'Gasto do dia (sai do total de hoje).' },
  { type: 'retirada', label: 'Retirada', icon: '🏦', tone: 'bg-slate-100 text-slate-700 border-slate-200', hint: 'Tirado do acumulado, depois do “Ontem + hoje” (ex.: − 300).' },
  { type: 'pagamento', label: 'Pagamento', icon: '💼', tone: 'bg-violet-50 text-violet-700 border-violet-200', hint: 'Sua diária: 150 por dia. Cada dia vira uma linha na conta (ex.: 2 dias = diária de ontem + diária de hoje).' },
];

export default function Cash() {
  const { day, settings } = useApp();
  const { run, confirm, choose } = useUi();
  const [add, setAdd] = useState<ManualType | null>(null);
  const [editOpening, setEditOpening] = useState(false);
  const [fix, setFix] = useState<string | null>(null);
  const [fixNote, setFixNote] = useState<CashMovement | null>(null);
  const [swap, setSwap] = useState<Sale | null>(null);
  const [showCount, setShowCount] = useState(false);
  const [view, setViewRaw] = useState<'normal' | 'caderno'>(() => { try { return localStorage.getItem('contaView') === 'caderno' ? 'caderno' : 'normal'; } catch { return 'normal'; } });
  const setView = (v: 'normal' | 'caderno') => { setViewRaw(v); try { localStorage.setItem('contaView', v); } catch { /* ok */ } };
  const data = useLiveQuery(async () => {
    if (!day) return null;
    const [s, variants, groups] = await Promise.all([daySummary(day.id, day.date), db.variants.toArray(), db.groups.toArray()]);
    const allOrders = await db.orders.where('dailyRecordId').equals(day.id).sortBy('createdAt');
    const sales = await db.sales.where('dailyRecordId').equals(day.id).toArray();
    const g = new Map(groups.map((x) => [x.id, x]));
    const names = new Map(variants.map((v) => [v.id, `${g.get(v.groupId)?.name ?? ''} ${v.name}`]));
    // de onde veio cada peça: grupo (ícone/cor) › cor da peça
    const pieces = new Map(variants.map((v) => {
      const gr = g.get(v.groupId);
      return [v.id, { group: gr?.name ?? '—', icon: gr?.icon ?? '📦', groupColor: gr?.color ?? '#94a3b8', name: v.name, color: v.color }];
    }));
    return { s, allOrders, sales, names, pieces };
  }, [day?.id]);
  const locked = day?.status !== 'open';
  const sym = settings.currencySymbol;

  const cancel = async (orderId: string) => {
    if (!(await confirm({ title: 'Cancelar esta venda?', tone: 'danger', confirm: 'Cancelar venda',
      message: locked
        ? 'Esta venda é de um dia encerrado: as peças voltam ao estoque de HOJE e o valor sai do caixa de HOJE. O dia encerrado não muda. Fica registrado.'
        : 'As peças voltam ao estoque e o valor sai do caixa. Fica registrado.' }))) return;
    const res = await reservationsOfOrder(orderId);
    const restore = res.length > 0 && await confirm({ title: 'Esta venda veio de uma reserva',
      message: `Voltar a reservar para ${res.map((r) => r.customer || 'a cliente').join(', ')}?`, confirm: 'Sim, voltar a reservar' });
    run(() => cancelOrder(orderId, { restoreReservations: restore }), 'Venda cancelada');
  };

  /** Devolver parte da venda: a peça volta ao estoque e o valor dela sai do caixa (dia encerrado: entra hoje). */
  const devolver = async (saleId: string, name: string, max: number, cents: number | null) => {
    const opts = Array.from({ length: Math.min(max, 10) }, (_, i) => i + 1);
    const pick = opts.length === 1 ? '1' : await choose({ title: `Quantas ${name} voltaram?`, options: opts.map((n) => ({ value: String(n), label: `${n} ${n === 1 ? 'peça' : 'peças'}` })) });
    if (!pick) return;
    const n = Number(pick);
    if (!(await confirm({ title: `Devolver ${n} ${name}?`, confirm: 'Devolver', tone: 'warning',
      message: <>A peça volta ao estoque{cents ? <> e <b>{money(cents * n)}</b> sai do caixa</> : ''}{locked ? <> — <b>hoje</b> (o dia encerrado não muda)</> : ''}. O resto da venda continua. Fica registrado.</> }))) return;
    run(() => returnSaleItem(saleId, n), `↩️ ${n} ${name} devolvida${n > 1 ? 's' : ''}`);
  };

  return (
    <div>
      <DayBar compact />
      <DayNotices />
      {day === null && <StartDayCard />}
      {day && data && (() => {
        const c = data.s.cash;
        // linha do tempo única: vendas + lançamentos, do mais novo para o mais antigo
        // vendas do caderno (sem peça) aparecem junto com os lançamentos
        const manual = c.movements.filter((m) => (m.type !== 'venda' || !m.relatedOrderId) && m.type !== 'estorno');
        const timeline = [
          ...data.allOrders.map((o) => ({ kind: 'order' as const, at: o.createdAt, o })),
          ...manual.map((m) => ({ kind: 'cash' as const, at: m.createdAt, m })),
        ].sort((a, b) => b.at.localeCompare(a.at));
        const methods = PAYMENTS.filter((p) => settings.paymentMethods.includes(p) || c.salesByMethod[p]);
        return (
          <>
            {/* saldo: total grande, onde o dinheiro está, e as vendas do dia por forma */}
            <Card className="p-4 bg-gradient-to-br from-emerald-600 to-emerald-700 text-white border-0">
              <div className="flex items-center gap-1.5 text-emerald-50 text-sm font-semibold">
                Saldo do caixa
                <InfoTip title="Saldo do caixa" example={[
                  ['📅', 'Ontem: 645'],
                  ['💰', 'Vendas de hoje: + 935'],
                  ['🤝', 'Dei ao Chico: − 50'],
                  ['🏦', 'Retirei: − 300'],
                  ['✅', <b>Saldo: 1.230</b>],
                  ['💵', '700 em dinheiro → “Na mão 700” e “No banco 530”'],
                ]}>
                  É todo o dinheiro do negócio: o que veio de ontem + o que entrou hoje − o que saiu. “Na mão” é o dinheiro vivo (o que dá para contar); “No banco” é o que entrou por Pix e cartão.
                </InfoTip>
              </div>
              <div className="text-[42px] leading-none font-extrabold tabular-nums mt-1">{money(c.accumulated, sym)}</div>
              {/* de onde veio o saldo: ontem + hoje (bem visível) */}
              <div className="flex items-stretch gap-1.5 mt-2">
                <span className="flex-1 min-w-0 rounded-xl bg-white/20 px-2.5 py-1.5">
                  <span className="block text-[11px] font-semibold text-emerald-50 break-words">📅 Veio de ontem</span>
                  <b className="block text-white text-[16px] tabular-nums leading-tight break-words">{money(c.opening)}</b>
                </span>
                <span className="self-center text-emerald-100 font-bold">+</span>
                <span className={`flex-1 min-w-0 rounded-xl px-2.5 py-1.5 ${c.dayResult >= 0 ? 'bg-white text-emerald-800' : 'bg-red-100 text-red-700'}`}>
                  <span className="block text-[11px] font-semibold break-words">☀️ {isTodayLabel(day.date) === 'de hoje' ? 'Hoje' : 'No dia'}</span>
                  <b className="block text-[16px] tabular-nums leading-tight break-words">{c.dayResult >= 0 ? '+' : '−'}{money(Math.abs(c.dayResult))}</b>
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-3">
                <div className="bg-white rounded-xl px-3 py-2 text-slate-800">
                  <div className="text-[11px] font-semibold text-slate-500">💵 Na mão</div>
                  <div className="text-xl font-extrabold tabular-nums">{money(c.cashOnHand)}</div>
                  <div className="text-[10px] text-slate-400">dinheiro vivo</div>
                </div>
                <div className="bg-white rounded-xl px-3 py-2 text-slate-800">
                  <div className="text-[11px] font-semibold text-slate-500">🏦 No banco</div>
                  <div className="text-xl font-extrabold tabular-nums">{money(c.otherBalance)}</div>
                  <div className="text-[10px] text-slate-400">Pix e cartão</div>
                </div>
              </div>
              {/* vendas do dia por forma: barra de proporção + legenda */}
              <div className="mt-3 text-[12px] font-semibold text-emerald-50">Vendas {isTodayLabel(day.date)}: {money(c.salesTotal)}</div>
              <div className="flex h-2 rounded-full overflow-hidden bg-white/20 mt-1.5">
                {c.salesTotal > 0 && methods.map((p) => c.salesByMethod[p] > 0 && (
                  <div key={p} className={METHOD_COLOR[p]} style={{ width: `${(c.salesByMethod[p] / c.salesTotal) * 100}%` }} />
                ))}
              </div>
              {/* celular: até 3 formas lado a lado; com 4 ou mais, 2 por linha */}
              <div className="grid gap-1.5 mt-2" style={{ gridTemplateColumns: `repeat(${methods.length > 3 ? 2 : methods.length}, minmax(0,1fr))` }}>
                {methods.map((p) => (
                  <div key={p} className="min-w-0 rounded-xl bg-white text-slate-800 px-2.5 py-2 shadow-sm">
                    <div className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-500 whitespace-nowrap">
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${METHOD_COLOR[p]}`} /><span className="break-words">{PAYMENT_EMOJI[p]} {PAYMENT_LABEL[p]}</span>
                    </div>
                    <div className="flex items-baseline justify-between gap-1">
                      <span className="text-[18px] font-extrabold tabular-nums leading-tight break-words">{money(c.salesByMethod[p])}</span>
                      <span className="text-[11px] font-semibold text-slate-400 tabular-nums shrink-0">{c.salesTotal > 0 ? Math.round((c.salesByMethod[p] / c.salesTotal) * 100) : 0}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {/* lançar */}
            {!locked && (<>
              <BlockHeader icon="🪙" tint="bg-amber-100" title="Lançar dinheiro" subtitle="Dinheiro que entrou ou saiu sem ser venda" right={<InfoTip title="Lançar dinheiro" example={[
                ['🤝', <><b>Dei dinheiro:</b> dei 50 ao Chico → sai do total de hoje</>],
                ['➕', <><b>Entrada:</b> recebi 30 de uma dívida antiga (não é venda)</>],
                ['🧾', <><b>Despesa:</b> paguei 15 de sacolas</>],
                ['🏦', <><b>Retirada:</b> tirei 300 do caixa para guardar</>],
                ['💼', <><b>Pagamento:</b> minha diária de 150 (2 dias = 2 diárias de 150)</>],
              ]}>Use para dinheiro que entrou ou saiu sem ser venda. Vendas entram sozinhas.</InfoTip>} />
              <div className="grid grid-cols-3 gap-1.5">
                {MANUAL.map((m) => (
                  <button key={m.type} onClick={() => setAdd(m.type)} className={`h-16 rounded-xl border font-semibold flex flex-col items-center justify-center text-[12px] leading-tight ${m.tone}`}>
                    <span className="text-xl">{m.icon}</span>{m.label}
                  </button>
                ))}
              </div>
            </>)}

            {/* conta do dia: normal (lista clara) ou caderno (manuscrito) */}
            <BlockHeader icon="🧮" tint="bg-blue-100" title="Conta do dia" subtitle="Como se chega no saldo" right={<InfoTip title="Conta do dia" example={[
              ['📅', 'Ontem: 1.474,80 (645 em dinheiro + 829,80 no banco)'],
              ['➕', 'Vendas no Dinheiro 935'],
              ['➖', 'Dei a Chico 50 · Diária de 30/10 150 · Diária de 31/10 150'],
              ['☀️', <>= Hoje <b>+585</b></>],
              ['✅', <>Total = ontem 1.474,80 + hoje 585 = <b>2.059,80</b> (na mão 1.230)</>],
            ]}>
              Ontem fica separado. Hoje mostra cada entrada e cada saída. No fim, o total. “Ontem” vem sozinho do último dia; toque em corrigir se precisar.</InfoTip>} />
            <div className="grid grid-cols-2 bg-slate-200/70 rounded-xl p-1 mb-2">
              {(['normal', 'caderno'] as const).map((v) => (
                <button key={v} onClick={() => setView(v)} className={`h-11 rounded-lg text-sm font-semibold ${view === v ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}>
                  {v === 'normal' ? '📋 Normal' : '📒 Caderno'}
                </button>
              ))}
            </div>
            {view === 'normal' ? (
              <div className="space-y-2">
                {/* 1) ontem, separado */}
                <Card className="overflow-hidden">
                  <div className="flex items-center gap-3 px-4 py-3">
                    <span className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">📅</span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[15px] font-bold text-slate-800">Ontem{c.openingManual ? ' (digitado)' : ''}</span>
                      <span className="block text-[12px] text-slate-500 break-words">💵 {money(c.openingCash)} em dinheiro · 🏦 {money(c.opening - c.openingCash)} no banco</span>
                      {!locked && <button onClick={() => setEditOpening(true)} className="text-[12px] font-semibold text-blue-600 py-1">✏️ corrigir</button>}
                    </span>
                    <span className="shrink-0 text-[18px] font-extrabold tabular-nums text-slate-800">{money(c.opening)}</span>
                  </div>
                </Card>
                {/* 2) caixa de hoje: de onde veio e para onde foi, linha por linha */}
                <Card className="overflow-hidden">
                  <div className="flex items-center gap-2 px-4 pt-3 pb-1 text-[13px] font-bold text-slate-500 uppercase tracking-wide">☀️ Caixa {isTodayLabel(day.date) === 'de hoje' ? 'de hoje' : 'do dia'}</div>
                  {cashStatement(c).map((x, i) => (
                    <div key={i} className={`flex items-center gap-3 px-4 py-1.5 ${x.cents === 0 ? 'opacity-45' : ''}`}>
                      <span className={`w-6 text-center font-extrabold ${x.sign === '+' ? 'text-emerald-600' : 'text-red-600'}`}>{x.sign === '+' ? '+' : '−'}</span>
                      <span className="text-lg shrink-0">{x.icon}</span>
                      <span className="flex-1 min-w-0 text-[14px] text-slate-700 break-words">{x.label}</span>
                      <span className={`shrink-0 font-bold tabular-nums ${x.sign === '+' ? 'text-emerald-700' : 'text-red-600'}`}>{money(x.cents)}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between mx-3 mb-3 mt-2 rounded-xl bg-slate-100 px-3 py-2.5">
                    <span className="font-bold text-slate-700">= {isTodayLabel(day.date) === 'de hoje' ? 'Hoje' : 'No dia'}</span>
                    <span className={`text-[18px] font-extrabold tabular-nums ${c.dayResult < 0 ? 'text-red-600' : 'text-slate-800'}`}>{c.dayResult < 0 ? '−' : '+'}{money(Math.abs(c.dayResult))}</span>
                  </div>
                </Card>
                {/* 3) total */}
                <div className="rounded-2xl bg-emerald-600 text-white px-4 py-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[16px]">✅ Total</span>
                    <span className="text-[26px] font-extrabold tabular-nums">{money(c.accumulated, sym)}</span>
                  </div>
                  <div className="text-[13px] text-emerald-50 tabular-nums">ontem {money(c.opening)} {c.dayResult < 0 ? '−' : '+'} hoje {money(Math.abs(c.dayResult))}</div>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <div className="rounded-xl bg-white/15 px-3 py-1.5"><div className="text-[11px] text-emerald-50">💵 Na mão</div><div className="font-extrabold tabular-nums">{money(c.cashOnHand)}</div></div>
                    <div className="rounded-xl bg-white/15 px-3 py-1.5"><div className="text-[11px] text-emerald-50">🏦 No banco</div><div className="font-extrabold tabular-nums">{money(c.otherBalance)}</div></div>
                  </div>
                </div>
              </div>
            ) : (
              <Card className="px-4 notebook !bg-sky-50 text-[17px]">
                <div>Vendas: {money(c.salesTotal)}</div>
                {c.entradas > 0 && <div>Entradas: + {money(c.entradas)}</div>}
                {c.dar.map((d) => <div key={d.id}>{d.person || d.description || 'Dei'}: − {money(d.amountInCents)} <small>(eu dei)</small></div>)}
                {c.despesas > 0 && <div>Despesas: − {money(c.despesas)}</div>}
                <div className="font-bold">= Hoje {money(c.todayNet)}</div>
                <div>
                  <button disabled={locked} onClick={() => setEditOpening(true)} className="underline decoration-dotted py-2 -my-2">Ontem {money(c.opening)}{c.openingManual ? ' ✎' : ''}</button>
                  {' '}+ {money(c.todayNet)} = {money(c.subtotal)}
                  {c.retiradas + c.pagamentos > 0 && <> − {money(c.retiradas + c.pagamentos)} = <b>{money(c.accumulated)}</b></>}
                </div>
                {c.pagamentos > 0 && <div>💼 Pagamento {money(c.pagamentos)} <small>{payDaysText(c.pagamentos, c.pagamentoDias)}</small></div>}
                <div className="text-[15px]">💵 Dinheiro: {money(c.openingCash)} + {money(c.cashToday)} = {money(c.openingCash + c.cashToday)}{c.retiradas + c.pagamentos > 0 ? <> − {money(c.retiradas + c.pagamentos)} = <b>{money(c.cashOnHand)}</b></> : null}</div>
              </Card>
            )}

            {/* conferir dinheiro da gaveta */}
            <button onClick={() => setShowCount(!showCount)}
              className="w-full mt-3 flex items-center gap-3 bg-white rounded-xl border border-slate-200 px-3 py-2.5 text-left active:bg-slate-50">
              <span className="text-xl">💵</span>
              <span className="flex-1">
                <span className="block font-semibold text-slate-800">Conferir dinheiro</span>
                <span className="block text-xs text-slate-500">
                  {c.counted === null ? `Deveria ter ${money(c.cashOnHand)} em dinheiro vivo` :
                    c.difference === 0 ? '✅ Contado e bateu' : `Contado ${money(c.counted)} · diferença ${c.difference! > 0 ? '+' : ''}${money(c.difference)}`}
                </span>
              </span>
              <span className={`text-slate-400 transition ${showCount ? 'rotate-90' : ''}`}>›</span>
            </button>
            {showCount && <div className="mt-2"><CountedCard dayId={day.id} expected={c.cashOnHand} counted={c.counted} diff={c.difference} locked={locked} /></div>}

            <BlockHeader icon="🧾" tint="bg-slate-200" title={`Movimentado ${isTodayLabel(day.date) === 'de hoje' ? 'hoje' : 'no dia'}`}
              subtitle={`${timeline.length} ${timeline.length === 1 ? 'registro' : 'registros'} · do mais novo para o mais antigo`}
              right={<InfoTip title="Movimentado hoje" example={[
                ['🛍️', 'Cada venda mostra de onde saiu cada peça (grupo › cor) e como foi paga'],
                ['✏️', <>Errou o preço? <b>Corrigir valor</b></>],
                ['✖️', <>Venda que não aconteceu? <b>Cancelar venda</b> (as peças voltam)</>],
                ['🤝', 'Lançamentos de dinheiro (dei, despesa, retirada, pagamento) também aparecem aqui'],
              ]}>Tudo o que mexeu no caixa no dia, em ordem de horário.</InfoTip>}>
              <div className="flex flex-wrap gap-1.5 mt-2">
                <span className="rounded-full bg-emerald-100 text-emerald-800 px-2.5 py-1 text-[12px] font-bold">🛍️ {data.s.salesCount} {data.s.salesCount === 1 ? 'venda' : 'vendas'} · +{money(c.salesTotal)}</span>
                {c.entradas > 0 && <span className="rounded-full bg-emerald-50 text-emerald-700 px-2.5 py-1 text-[12px] font-bold">➕ entradas +{money(c.entradas)}</span>}
                {c.darTotal + c.despesas + c.retiradas > 0 && <span className="rounded-full bg-red-100 text-red-700 px-2.5 py-1 text-[12px] font-bold">↘️ saídas −{money(c.darTotal + c.despesas + c.retiradas)}</span>}
                {c.pagamentos > 0 && <span className="rounded-full bg-violet-100 text-violet-700 px-2.5 py-1 text-[12px] font-bold">💼 pagamento −{money(c.pagamentos)}</span>}
              </div>
            </BlockHeader>
            <div className="space-y-1.5">
              {!timeline.length && <Empty icon="💰" title="Nada lançado ainda">Vendas e lançamentos do dia aparecem aqui.</Empty>}
              {timeline.map((t) => t.kind === 'order' ? (() => {
                const o = t.o;
                const lines = data.sales.filter((x) => x.orderId === o.id);
                const cancelled = o.status === 'cancelled';
                return (
                  <Card key={o.id} className={`overflow-hidden ${cancelled ? 'opacity-55' : ''}`}>
                    {/* cabeçalho: venda, hora, cliente, forma de pagamento e total */}
                    <div className="flex items-center gap-2 px-3 pt-3">
                      <span className="text-lg">🛍️</span>
                      <span className="text-[13px] font-bold text-slate-700">Venda</span>
                      <span className="text-[12px] text-slate-400 tabular-nums">🕒 {hhmm(o.createdAt)}</span>
                      {o.customer && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 break-words max-w-[90px]">👩 {o.customer}</span>}
                      <span className="flex-1" />
                      <span className={`text-[20px] font-extrabold tabular-nums ${cancelled ? 'text-slate-400 line-through' : 'text-emerald-600'}`}>+{money(o.totalInCents)}</span>
                    </div>
                    <div className="flex flex-wrap gap-1 px-3 mt-1">
                      {(o.payments && o.payments.length > 1 ? o.payments.map((pp) => [pp.method, pp.amountInCents] as const) : [[o.paymentMethod, o.totalInCents] as const]).map(([m, v]) => (
                        <span key={m} className="rounded-full bg-blue-50 text-blue-800 px-2 py-0.5 text-[12px] font-bold">{PAYMENT_EMOJI[m]} {PAYMENT_LABEL[m]}{o.payments && o.payments.length > 1 ? ` ${money(v)}` : ''}</span>
                      ))}
                      {cancelled && <span className="rounded-full bg-red-100 text-red-700 px-2 py-0.5 text-[12px] font-bold">✖️ cancelada</span>}
                      {(() => {
                        const px = pixStatus(o);
                        const confirm = () => run(() => confirmPix(o.id), `✅ Pix de ${money(px.kind === 'none' ? 0 : px.cents)} conferido`);
                        if (px.kind === 'none') return null;
                        if (px.kind === 'ok') return <span className="rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5 text-[12px] font-bold">✅ Pix caiu · {money(px.cents)}</span>;
                        if (px.kind === 'changed') return (
                          <button onClick={confirm} className="rounded-full bg-orange-100 text-orange-800 px-2 py-0.5 text-[12px] font-bold text-left active:bg-orange-200">
                            ⚠️ Pix mudou: conferido {money(px.was)}, agora {money(px.cents)} · tocar para conferir de novo
                          </button>
                        );
                        return <button onClick={confirm} className="rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 text-[12px] font-bold active:bg-amber-200">⏳ Conferir Pix de {money(px.cents)} · tocar quando cair</button>;
                      })()}
                    </div>
                    {/* de onde veio: uma linha por peça (grupo › cor × quantidade) */}
                    <div className="mx-3 mt-2 rounded-xl bg-slate-50 border border-slate-100 divide-y divide-slate-100">
                      {lines.map((l) => {
                        const pc = data.pieces.get(l.variantId);
                        return (
                          <div key={l.id} className="px-2.5 py-2">
                            {/* linha 1: de onde veio a peça, quantidade e valor */}
                            <div className="flex items-center gap-2">
                              <span className="text-base shrink-0">{pc?.icon}</span>
                              <span className="flex-1 min-w-0 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                                <span className="text-[13px] font-bold" style={{ color: pc?.groupColor }}>{pc?.group}</span>
                                <span className="text-slate-300">›</span>
                                <span className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-slate-800"><Swatch color={pc?.color} size={14} />{pc?.name}</span>
                              </span>
                              <span className="shrink-0 text-[13px] font-extrabold text-slate-700 tabular-nums">×{l.quantity}{l.returnedQuantity ? <span className="block text-[11px] font-semibold text-orange-700">↩️ {l.returnedQuantity} devolvida{l.returnedQuantity > 1 ? 's' : ''}</span> : null}</span>
                              <span className="shrink-0 min-w-12 text-right text-[13px] font-semibold text-slate-600 tabular-nums">{l.unitPriceInCents === null ? 'sem preço' : money(l.totalInCents)}</span>
                            </div>
                            {/* linha 2: forma de pagamento desta peça e trocar */}
                            {(o.payByLine || !cancelled) && (
                              <div className="flex flex-wrap items-center justify-end gap-2 mt-1.5 pl-7">
                                {o.payByLine && <span className="rounded-full bg-blue-50 text-blue-800 px-2 py-0.5 text-[12px] font-bold">{PAYMENT_EMOJI[l.paymentMethod]} {PAYMENT_LABEL[l.paymentMethod]}</span>}
                                <span className="flex-1" />
                                {/* devolver uma parte: só quando sobra peça na venda (devolver tudo = Cancelar venda) */}
                                {!cancelled && l.quantity > 0 && o.itemCount > 1 && (
                                  <button aria-label={`Devolver ${pc?.name ?? ''}`} onClick={() => devolver(l.id, pc?.name ?? 'peça', Math.min(l.quantity, o.itemCount - 1), l.unitPriceInCents)}
                                    className="shrink-0 h-9 px-2.5 rounded-lg bg-white border border-orange-200 text-[12px] font-bold text-orange-700 active:bg-orange-50">↩️ Devolver</button>
                                )}
                                {!cancelled && !locked && l.quantity > 0 && (
                                  <button aria-label={`Trocar peça ${pc?.name ?? ''}`} onClick={() => setSwap(l)}
                                    className="shrink-0 h-9 px-2.5 rounded-lg bg-white border border-slate-200 text-[12px] font-bold text-slate-700 active:bg-slate-100">🔄 Trocar peça</button>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {!cancelled && !locked ? (
                      <div className="grid grid-cols-2 gap-2 p-3">
                        <button className="h-10 rounded-lg bg-slate-100 text-[13px] font-semibold text-slate-700 active:bg-slate-200" onClick={() => setFix(o.id)}>✏️ Corrigir valor</button>
                        <button className="h-10 rounded-lg bg-red-50 text-[13px] font-semibold text-red-600 active:bg-red-100" onClick={() => cancel(o.id)}>✖️ Cancelar venda</button>
                      </div>
                    ) : !cancelled ? (
                      /* dia encerrado: cancelar continua possível; a peça e o dinheiro voltam HOJE */
                      <div className="p-3">
                        <button className="w-full min-h-10 rounded-lg bg-red-50 text-[13px] font-semibold text-red-600 active:bg-red-100" onClick={() => cancel(o.id)}>✖️ Cancelar venda (volta hoje)</button>
                      </div>
                    ) : <div className="h-3" />}
                  </Card>
                );
              })() : t.m.type === 'venda' ? (
                <Card key={t.m.id} className="overflow-hidden">
                  <div className="flex items-center gap-2 px-3 pt-3">
                    <span className="text-lg">🛍️</span>
                    <span className="text-[13px] font-bold text-slate-700">Venda</span>
                    <span className="text-[12px] text-slate-400 tabular-nums">🕒 {hhmm(t.m.createdAt)}</span>
                    <span className="flex-1" />
                    <span className="text-[20px] font-extrabold tabular-nums text-emerald-600">+{money(t.m.amountInCents)}</span>
                  </div>
                  <div className="flex flex-wrap gap-1 px-3 mt-1">
                    <span className="rounded-full bg-blue-50 text-blue-800 px-2 py-0.5 text-[12px] font-bold">{PAYMENT_EMOJI[t.m.paymentMethod]} {PAYMENT_LABEL[t.m.paymentMethod]}</span>
                  </div>
                  <div className="mx-3 mt-2 rounded-xl bg-amber-50 border border-amber-100 flex items-center gap-2 px-2.5 py-2">
                    <span className="text-base">📒</span>
                    <span className="flex-1 min-w-0 text-[14px] font-semibold text-slate-800">Do caderno <span className="text-[12px] font-normal text-slate-500">· peça não anotada</span></span>
                    <span className="text-[13px] font-extrabold text-slate-700 tabular-nums">×{t.m.quantity ?? 1}</span>
                    <span className="w-14 text-right text-[12px] text-slate-500 tabular-nums">{money(t.m.amountInCents)}</span>
                  </div>
                  {!locked ? (
                    <div className="grid grid-cols-2 gap-2 p-3">
                      <button className="h-10 rounded-lg bg-slate-100 text-[13px] font-semibold text-slate-700 active:bg-slate-200" onClick={() => setFixNote(t.m)}>✏️ Corrigir valor</button>
                      <button className="h-10 rounded-lg bg-red-50 text-[13px] font-semibold text-red-600 active:bg-red-100" onClick={async () => {
                        if (await confirm({ title: 'Cancelar esta venda?', message: `${money(t.m.amountInCents)} no ${PAYMENT_LABEL[t.m.paymentMethod]} sai do caixa. Fica registrado no histórico.`, confirm: 'Cancelar venda', tone: 'danger' }))
                          run(() => removeCashMovement(t.m.id), 'Venda cancelada');
                      }}>✖️ Cancelar venda</button>
                    </div>
                  ) : <div className="h-3" />}
                </Card>
              ) : (
                <Card key={t.m.id} className="p-3 flex items-center gap-3">
                  <span className="w-10 h-10 shrink-0 rounded-xl bg-slate-50 flex items-center justify-center text-lg">{MANUAL.find((x) => x.type === t.m.type)?.icon ?? '•'}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-semibold text-slate-800">{CASH_LABEL[t.m.type]}{t.m.person ? ` · ${t.m.person}` : ''}{t.m.type === 'pagamento' && t.m.quantity ? ` · ${payDaysText(t.m.amountInCents, t.m.quantity)}` : ''}</span>
                    <span className="block text-xs text-slate-500">{hhmm(t.m.createdAt)} · {PAYMENT_EMOJI[t.m.paymentMethod]} {PAYMENT_LABEL[t.m.paymentMethod]}{t.m.description ? ` · ${t.m.description}` : ''}</span>
                  </span>
                  <span className={`font-bold tabular-nums ${CASH_IN.includes(t.m.type) ? 'text-emerald-600' : 'text-red-600'}`}>
                    {CASH_IN.includes(t.m.type) ? '+' : '−'}{money(t.m.amountInCents)}
                  </span>
                  {!locked && (
                    <button className="w-11 h-11 -mr-1 rounded-lg text-slate-400 active:bg-slate-100" aria-label="Remover" onClick={async () => {
                      if (await confirm({ title: 'Remover lançamento?', message: 'Fica registrado no histórico de auditoria.', confirm: 'Remover', tone: 'danger' }))
                        run(() => removeCashMovement(t.m.id), 'Removido');
                    }}>✕</button>
                  )}
                </Card>
              ))}
            </div>
            <AddCashSheet type={add} onClose={() => setAdd(null)} cashOnHand={c.cashOnHand} />
            <OpeningSheet open={editOpening} onClose={() => setEditOpening(false)} current={c.opening} currentCash={c.openingCash} manual={c.openingManual} />
            <FixPriceSheet orderId={fix} onClose={() => setFix(null)} names={data.names} />
            <FixNotebookSheet sale={fixNote} onClose={() => setFixNote(null)} />
            <SwapSheet sale={swap} onClose={() => setSwap(null)} />
          </>
        );
      })()}
    </div>
  );
}

/** Cabeçalho padrão das seções do Caixa: ícone colorido, título, explicação curta e ⓘ/resumo. */
const ACCENT: Record<string, string> = { 'bg-amber-100': '#f59e0b', 'bg-blue-100': '#2563eb', 'bg-slate-200': '#64748b' };

function BlockHeader({ icon, tint, title, subtitle, right, children }: {
  icon: string; tint: string; title: string; subtitle?: string; right?: React.ReactNode; children?: React.ReactNode;
}) {
  // mesmo visual do cabeçalho de grupo no Vender: cartão com faixa colorida no topo
  const accent = ACCENT[tint] ?? '#64748b';
  return (
    <div className="mt-6 mb-2.5 rounded-2xl bg-white border border-slate-200 border-t-4 shadow-sm px-3.5 py-3" style={{ borderTopColor: accent }}>
      <div className="flex items-center gap-3">
        <span className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 ${tint}`}>{icon}</span>
        <span className="flex-1 min-w-0">
          <span className="block text-[17px] font-extrabold text-slate-800 leading-tight">{title}</span>
          {subtitle && <span className="block text-[12px] text-slate-500 leading-tight break-words">{subtitle}</span>}
        </span>
        {right}
      </div>
      {children}
    </div>
  );
}

const METHOD_COLOR: Record<PaymentMethod, string> = { dinheiro: 'bg-emerald-400', pix: 'bg-amber-400', cartao: 'bg-sky-400', debito: 'bg-violet-400', outro: 'bg-slate-400' };

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const isTodayLabel = (date: string) => (date === todayStr() ? 'de hoje' : 'do dia');

/** Corrigir preço de venda já feita: a diferença entra (ou sai) do caixa como correção. */
function FixPriceSheet({ orderId, onClose, names }: { orderId: string | null; onClose: () => void; names: Map<string, string> }) {
  const { run } = useUi();
  const [busy, wrap] = useBusy();
  const [vals, setVals] = useState<Record<string, string>>({});
  const sales = useLiveQuery(async () => (orderId ? db.sales.where('orderId').equals(orderId).toArray() : []), [orderId]);
  if (!orderId || !sales) return null;
  const val = (id: string, p: number | null) => vals[id] ?? (p === null ? '' : money(p));
  const parsed = Object.fromEntries(sales.map((x) => [x.id, val(x.id, x.unitPriceInCents).trim() === '' ? null : toCents(val(x.id, x.unitPriceInCents))]));
  const invalid = sales.some((x) => val(x.id, x.unitPriceInCents).trim() !== '' && parsed[x.id] === null);
  const total = sales.reduce((s, x) => s + (parsed[x.id] ?? 0) * x.quantity, 0);
  return (
    <Sheet open onClose={() => { setVals({}); onClose(); }} title="✏️ Corrigir valor da venda"
      footer={<Button size="lg" className="w-full" disabled={invalid || busy} onClick={() => wrap(async () => {
        const r = await run(() => correctOrderPrices(orderId, parsed as Record<string, number | null>), 'Valor corrigido');
        if (r) { setVals({}); onClose(); }
      })}>Salvar · total {money(total)}</Button>}>
      <p className="text-sm text-slate-500 mb-3">A diferença entra ou sai do caixa como “correção de valor”. O lançamento original fica guardado.</p>
      {sales.map((x) => (
        <Field key={x.id} label={`${x.quantity}× ${names.get(x.variantId) ?? ''} — preço por peça`}>
          <Input inputMode="decimal" value={val(x.id, x.unitPriceInCents)} placeholder="sem preço"
            onChange={(e) => setVals({ ...vals, [x.id]: e.target.value })} />
        </Field>
      ))}
    </Sheet>
  );
}

/**
 * Trocar a peça vendida: escolhe a cor certa com um toque. A errada volta ao estoque e a certa sai.
 * Mostra antes como fica (Branco 1 → 2 · Vermelho 2 → 1).
 */
function SwapSheet({ sale, onClose }: { sale: Sale | null; onClose: () => void }) {
  const { day } = useApp();
  const { run } = useUi();
  const [busy, wrap] = useBusy();
  const [groupId, setGroupId] = useState<string | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [qty, setQty] = useState<number | null>(null);
  const data = useLiveQuery(async () => {
    if (!sale || !day) return null;
    const [rows, reserved] = await Promise.all([loadStockRows(day.id, day.date), activeReservedByVariant(day.date)]);
    const live = rows.filter((r) => !r.variant.archivedAt && !r.group.archivedAt && r.group.active && r.variant.active);
    return { live, reserved, cur: rows.find((r) => r.variant.id === sale.variantId) };
  }, [sale?.id, day?.id]);
  if (!sale || !data) return null;
  const close = () => { setGroupId(null); setPick(null); setQty(null); onClose(); };
  const gid = groupId ?? data.cur?.group.id ?? data.live[0]?.group.id;
  const groups = [...new Map(data.live.map((r) => [r.group.id, r.group])).values()].sort((a, b) => a.displayOrder - b.displayOrder);
  const colors = data.live.filter((r) => r.group.id === gid).sort((a, b) => a.variant.displayOrder - b.variant.displayOrder);
  const n = qty ?? sale.quantity;
  const free = (r: (typeof data.live)[number]) => r.item.currentQuantity - (data.reserved.get(r.variant.id) ?? 0);
  const target = data.live.find((r) => r.variant.id === pick);
  const curName = data.cur ? `${data.cur.group.name} ${data.cur.variant.name}` : 'peça vendida';
  return (
    <Sheet open onClose={close} title="🔄 Trocar a peça vendida" tall
      footer={<Button size="lg" className="w-full" disabled={!target || busy} onClick={() => wrap(async () => {
        const r = await run(() => swapSaleItem(sale.id, pick!, n), `Trocado: ${target!.group.name} ${target!.variant.name}`);
        if (r !== undefined) close();
      })}>{target ? `Trocar para ${target.group.name} ${target.variant.name}` : 'Escolha a peça certa'}</Button>}>
      {/* o que foi vendido */}
      <div className="flex items-center gap-3 rounded-2xl bg-red-50 border border-red-200 px-3 py-2.5 mb-3">
        <Swatch color={data.cur?.variant.color} size={28} />
        <span className="flex-1 min-w-0 leading-snug">
          <span className="block text-[12px] font-semibold text-red-700">Foi lançada (errada)</span>
          <span className="block text-[15px] font-extrabold text-slate-800">{data.cur?.group.icon} {curName} ×{sale.quantity}</span>
        </span>
      </div>
      {sale.quantity > 1 && (
        <div className="flex items-center justify-between rounded-xl bg-white border border-slate-200 px-3 py-2 mb-3">
          <span className="text-sm font-semibold text-slate-700">Quantas trocar</span>
          <span className="flex items-center gap-2">
            <button aria-label="Trocar uma a menos" className="w-11 h-11 rounded-lg bg-slate-100 text-xl font-bold" onClick={() => setQty(Math.max(1, n - 1))}>−</button>
            <span className="w-8 text-center text-lg font-extrabold tabular-nums">{n}</span>
            <button aria-label="Trocar uma a mais" className="w-11 h-11 rounded-lg bg-slate-100 text-xl font-bold" onClick={() => setQty(Math.min(sale.quantity, n + 1))}>+</button>
          </span>
        </div>
      )}
      <div className="text-sm font-bold text-slate-700 mb-1.5">Qual era a peça certa?</div>
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-4 px-4 pb-2">
        {groups.map((g) => (
          <button key={g.id} onClick={() => { setGroupId(g.id); setPick(null); }}
            className={`shrink-0 h-10 px-3 rounded-full text-[13px] font-bold ${g.id === gid ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-700'}`}>{g.icon} {g.name}</button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 mt-1">
        {colors.map((r) => {
          const same = r.variant.id === sale.variantId;
          const off = same || free(r) < n;
          const on = pick === r.variant.id;
          return (
            <button key={r.variant.id} disabled={off} onClick={() => setPick(r.variant.id)} aria-pressed={on}
              className={`min-h-14 rounded-xl border-2 px-2.5 py-2 flex items-center gap-2 text-left ${on ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-white'} ${off ? 'opacity-40' : 'active:bg-slate-50'}`}>
              <Swatch color={r.variant.color} size={24} />
              <span className="flex-1 min-w-0 leading-tight">
                <span className="block text-[14px] font-bold text-slate-800 break-words">{r.variant.name}</span>
                <span className="block text-[11px] text-slate-500">{same ? 'é a lançada' : `${free(r)} disponível`}</span>
              </span>
              {on && <span className="text-emerald-600 text-lg">✓</span>}
            </button>
          );
        })}
      </div>
      {/* como fica o estoque */}
      {target && data.cur && (
        <div className="mt-4 rounded-2xl bg-slate-50 border border-slate-200 p-3 text-[14px] space-y-1.5">
          <div className="text-[12px] font-bold text-slate-500">Como fica o estoque</div>
          <div className="flex items-center gap-2"><Swatch color={data.cur.variant.color} size={16} /><span className="flex-1">{data.cur.variant.name} <span className="text-slate-400">volta</span></span>
            <b className="tabular-nums">{data.cur.item.currentQuantity} → <span className="text-emerald-700">{data.cur.item.currentQuantity + n}</span></b></div>
          <div className="flex items-center gap-2"><Swatch color={target.variant.color} size={16} /><span className="flex-1">{target.variant.name} <span className="text-slate-400">sai</span></span>
            <b className="tabular-nums">{target.item.currentQuantity} → <span className="text-red-600">{target.item.currentQuantity - n}</span></b></div>
          <div className="text-[12px] text-slate-500">O valor da venda e o caixa não mudam.</div>
        </div>
      )}
    </Sheet>
  );
}

/** Corrigir venda do caderno: valor, forma de pagamento e quantas peças. */
function FixNotebookSheet({ sale, onClose }: { sale: CashMovement | null; onClose: () => void }) {
  const { settings } = useApp();
  const { run } = useUi();
  const [busy, wrap] = useBusy();
  const [text, setText] = useState<string | null>(null);
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [qty, setQty] = useState<number | null>(null);
  if (!sale) return null;
  const close = () => { setText(null); setMethod(null); setQty(null); onClose(); };
  const value = text ?? money(sale.amountInCents);
  const cents = toCents(value);
  const m = method ?? sale.paymentMethod;
  const q = qty ?? sale.quantity ?? 1;
  const methods = PAYMENTS.filter((p) => settings.paymentMethods.includes(p) || p === sale.paymentMethod);
  return (
    <Sheet open onClose={close} title="✏️ Corrigir venda"
      footer={<Button size="lg" className="w-full" disabled={!cents || busy} onClick={() => wrap(async () => {
        const r = await run(() => updateNotebookSale(sale.id, { amountInCents: cents!, paymentMethod: m, quantity: q }), 'Venda corrigida');
        if (r !== undefined) close();
      })}>Salvar · {money(cents ?? 0)} no {PAYMENT_LABEL[m]}</Button>}>
      <p className="text-sm text-slate-500 mb-3">Venda copiada do caderno. Corrija o valor, a forma de pagamento ou quantas peças foram.</p>
      <Field label="Valor total da venda">
        <Input inputMode="decimal" value={value} onChange={(e) => setText(e.target.value)} />
      </Field>
      <div className="text-sm font-semibold text-slate-700 mb-1.5">Como pagou</div>
      <div className="grid grid-cols-2 gap-2 mb-4">
        {methods.map((p) => (
          <button key={p} onClick={() => setMethod(p)}
            className={`h-12 rounded-xl border-2 text-[14px] font-bold ${m === p ? 'border-blue-600 bg-blue-50 text-blue-800' : 'border-slate-200 bg-white text-slate-700'}`}>
            {PAYMENT_EMOJI[p]} {PAYMENT_LABEL[p]}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between bg-white rounded-xl border border-slate-200 px-3 py-2">
        <span className="text-sm font-semibold text-slate-700">Quantas peças</span>
        <span className="flex items-center gap-2">
          <button aria-label="Menos uma peça" className="w-11 h-11 rounded-lg bg-slate-100 text-xl font-bold" onClick={() => setQty(Math.max(1, q - 1))}>−</button>
          <span className="w-8 text-center text-lg font-extrabold tabular-nums">{q}</span>
          <button aria-label="Mais uma peça" className="w-11 h-11 rounded-lg bg-slate-100 text-xl font-bold" onClick={() => setQty(q + 1)}>+</button>
        </span>
      </div>
    </Sheet>
  );
}

function CountedCard({ dayId, expected, counted, diff, locked }: { dayId: string; expected: number; counted: number | null; diff: number | null; locked: boolean }) {
  const { run } = useUi();
  const [text, setText] = useState('');
  return (
    <Card className="p-3">
      <p className="text-xs text-slate-500 mb-2">Conte só o <b>dinheiro vivo</b>. Pix e cartão não entram na contagem.</p>
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <div className="text-xs text-slate-500">Esperado 💵</div>
          <div className="font-bold text-lg tabular-nums">{money(expected)}</div>
        </div>
        <div className="flex-1">
          <div className="text-xs text-slate-500">Contado</div>
          <div className="font-bold text-lg tabular-nums">{counted === null ? '—' : money(counted)}</div>
        </div>
        <div className="flex-1">
          <div className="text-xs text-slate-500">Diferença</div>
          <div className={`font-bold text-lg tabular-nums ${diff === null ? '' : diff === 0 ? 'text-emerald-600' : diff > 0 ? 'text-blue-600' : 'text-red-600'}`}>
            {diff === null ? '—' : (diff > 0 ? '+' : '') + money(diff)}
          </div>
        </div>
      </div>
      {!locked && (
        <div className="flex gap-2 mt-2">
          <Input inputMode="decimal" placeholder="Quanto tem em dinheiro?" value={text} onChange={(e) => setText(e.target.value)} />
          <Button className="h-12" disabled={toCents(text) === null} onClick={() => { run(() => setCountedBalance(dayId, toCents(text)), 'Contagem salva'); setText(''); }}>Salvar</Button>
        </div>
      )}
    </Card>
  );
}

/** "2 diárias de 150" (ou só "2 diárias" se não dividir certinho). */
function payDaysText(total: number, days: number) {
  if (!days) return '';
  if (days === 1) return '1 diária';
  return total % days === 0 ? `${days} diárias de ${money(total / days)}` : `${days} diárias`;
}

function AddCashSheet({ type, onClose, cashOnHand }: { type: ManualType | null; onClose: () => void; cashOnHand: number }) {
  const { day, settings } = useApp();
  const [days, setDays] = useState(1);
  const { run, confirm } = useUi();
  const [busy, wrap] = useBusy();
  const [amount, setAmount] = useState('');
  const [person, setPerson] = useState('');
  const [desc, setDesc] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('dinheiro');
  const meta = MANUAL.find((m) => m.type === type);
  if (!type || !meta || !day) return null;
  const cents = toCents(type === 'pagamento' && !amount ? money(settings.dailyPayInCents * days) : amount);
  return (
    <Sheet open onClose={onClose} title={`${meta.icon} ${meta.label}`}
      footer={<Button size="lg" className="w-full" disabled={!cents || busy} onClick={() => wrap(async () => {
        if (type !== 'entrada' && method === 'dinheiro' && cents! > cashOnHand && !(await confirm({ title: 'Mais do que tem em dinheiro?', tone: 'warning',
          confirm: 'Lançar mesmo assim', message: `Pelas contas, há ${money(cashOnHand)} em dinheiro vivo. Lançando ${money(cents)}, o dinheiro fica negativo.` }))) return;
        const r = await run(async () => {
          if (type !== 'pagamento') return addCashMovement({ dailyRecordId: day.id, type, amountInCents: cents!, person, description: desc, paymentMethod: method });
          // pagamento: uma diária por dia (2 dias = 2 lançamentos), do mais antigo para hoje
          const each = Math.floor(cents! / days), rest = cents! - each * days;
          let last;
          for (let i = days - 1; i >= 0; i--) {
            const [, mm, dd] = addDays(day.date, -i).split('-');
            last = await addCashMovement({ dailyRecordId: day.id, type, amountInCents: each + (i === days - 1 ? rest : 0), paymentMethod: method, quantity: 1,
              description: desc.trim() || `diária de ${dd}/${mm}` });
          }
          return last;
        }, days > 1 ? `${days} diárias lançadas` : 'Lançado');
        if (r) { setAmount(''); setPerson(''); setDesc(''); setDays(1); onClose(); }
      })}>Lançar {cents ? money(cents) : ''}</Button>}>
      <p className="text-sm text-slate-500 mb-3">{meta.hint}</p>
      {type === 'pagamento' && (
        <div className="mb-3">
          <div className="text-sm font-semibold text-slate-700 mb-1.5">Quantos dias? <span className="font-normal text-slate-500">(diária {money(settings.dailyPayInCents)})</span></div>
          <div className="grid grid-cols-4 gap-1.5">
            {[1, 2, 3, 4].map((n) => (
              <button key={n} onClick={() => { setDays(n); setAmount(money(settings.dailyPayInCents * n)); }}
                className={`min-h-12 rounded-xl border text-[13px] font-bold leading-tight ${days === n ? 'bg-violet-600 text-white border-violet-600' : 'bg-white border-slate-200 text-slate-700'}`}>
                {n} {n === 1 ? 'dia' : 'dias'}<span className="block text-[11px] font-semibold opacity-80">{money(settings.dailyPayInCents * n)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <Field label="Valor"><Input inputMode="decimal" value={type === 'pagamento' && !amount ? money(settings.dailyPayInCents * days) : amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" autoFocus /></Field>
      {type === 'dar' && <Field label="Para quem?"><Input value={person} onChange={(e) => setPerson(e.target.value)} placeholder="Ex.: Chico" /></Field>}
      <Field label="Descrição (opcional)"><Input value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
      <div className="grid grid-cols-4 gap-1.5">
        {PAYMENTS.map((p) => (
          <button key={p} onClick={() => setMethod(p)} className={`h-11 rounded-xl text-xs font-semibold border ${method === p ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-slate-200'}`}>
            {PAYMENT_EMOJI[p]} {PAYMENT_LABEL[p]}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

function OpeningSheet({ open, onClose, current, currentCash, manual }: { open: boolean; onClose: () => void; current: number; currentCash: number; manual: boolean }) {
  const { day } = useApp();
  const { run } = useUi();
  const [v, setV] = useState('');
  const [cash, setCash] = useState('');
  if (!open || !day) return null;
  return (
    <Sheet open onClose={onClose} title="Saldo de ontem"
      footer={<Button size="lg" className="w-full" disabled={toCents(v) === null} onClick={async () => {
        const r = await run(() => setOpeningBalance(day.id, toCents(v)!, cash.trim() ? toCents(cash) : null), 'Saldo atualizado');
        if (r !== undefined) { setV(''); setCash(''); onClose(); }
      }}>Salvar</Button>}>
      <p className="text-sm text-slate-500 mb-3">
        {manual ? <>Digitado à mão: <b>{money(current)}</b>.</> : <>Calculado do saldo final do último dia: <b>{money(current)}</b>. Se o dia anterior mudar, este valor acompanha.</>}
        {' '}Corrija só se precisar (ex.: primeiro dia de uso).
      </p>
      <Field label="Ontem (total)"><Input inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} placeholder={money(current)} autoFocus /></Field>
      <Field label="Quanto disso é dinheiro vivo? (opcional)" hint={`Hoje: ${money(currentCash)}. Vazio = tudo em dinheiro.`}>
        <Input inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} placeholder={v || money(currentCash)} />
      </Field>
      {manual && (
        <Button variant="soft" className="w-full" onClick={async () => {
          const r = await run(() => setOpeningBalance(day.id, null), 'Voltou ao automático');
          if (r !== undefined) onClose();
        }}>Voltar a calcular do dia anterior</Button>
      )}
    </Sheet>
  );
}
