import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { CashType, PaymentMethod } from '../db/types';
import { money, PAYMENT_EMOJI, PAYMENT_LABEL, PAYMENTS, toCents, todayStr } from '../lib/util';
import { addCashMovement, CASH_IN, CASH_LABEL, removeCashMovement, setCountedBalance, setOpeningBalance } from '../services/cash';
import { cancelOrder, correctOrderPrices, reservationsOfOrder } from '../services/sales';
import { daySummary } from '../services/summary';
import { useApp } from '../state';
import { DayNotices, DayBar, StartDayCard } from '../components/day';
import { Button, Card, Empty, Field, Input, InfoTip, Sheet, Swatch, useBusy, useUi } from '../components/ui';

type ManualType = Exclude<CashType, 'venda' | 'estorno'>;
const MANUAL: { type: ManualType; label: string; icon: string; tone: string; hint: string }[] = [
  { type: 'dar', label: 'Dei dinheiro', icon: '🤝', tone: 'bg-orange-50 text-orange-700 border-orange-200', hint: 'Ex.: Chico 50 — eu dei. Sai do total de hoje.' },
  { type: 'entrada', label: 'Entrada', icon: '➕', tone: 'bg-emerald-50 text-emerald-700 border-emerald-200', hint: 'Dinheiro que entrou sem ser venda.' },
  { type: 'despesa', label: 'Despesa', icon: '🧾', tone: 'bg-red-50 text-red-700 border-red-200', hint: 'Gasto do dia (sai do total de hoje).' },
  { type: 'retirada', label: 'Retirada', icon: '🏦', tone: 'bg-slate-100 text-slate-700 border-slate-200', hint: 'Tirado do acumulado, depois do “Ontem + hoje” (ex.: − 300).' },
];

export default function Cash() {
  const { day, settings } = useApp();
  const { run, confirm } = useUi();
  const [add, setAdd] = useState<ManualType | null>(null);
  const [editOpening, setEditOpening] = useState(false);
  const [fix, setFix] = useState<string | null>(null);
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
    if (!(await confirm({ title: 'Cancelar esta venda?', message: 'As peças voltam ao estoque e o valor sai do caixa. Fica registrado.', confirm: 'Cancelar venda', tone: 'danger' }))) return;
    const res = await reservationsOfOrder(orderId);
    const restore = res.length > 0 && await confirm({ title: 'Esta venda veio de uma reserva',
      message: `Voltar a reservar para ${res.map((r) => r.customer || 'a cliente').join(', ')}?`, confirm: 'Sim, voltar a reservar' });
    run(() => cancelOrder(orderId, { restoreReservations: restore }), 'Venda cancelada');
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
                <span className={`flex-1 min-w-0 rounded-xl px-2.5 py-1.5 ${c.todayNet >= 0 ? 'bg-white text-emerald-800' : 'bg-red-100 text-red-700'}`}>
                  <span className="block text-[11px] font-semibold break-words">☀️ {isTodayLabel(day.date) === 'de hoje' ? 'Hoje' : 'No dia'}</span>
                  <b className="block text-[16px] tabular-nums leading-tight break-words">{c.todayNet >= 0 ? '+' : '−'}{money(Math.abs(c.todayNet))}</b>
                </span>
                {c.retiradas > 0 && (
                  <span className="flex-1 min-w-0 rounded-xl bg-white/20 px-2.5 py-1.5">
                    <span className="block text-[11px] font-semibold text-emerald-50 break-words">🏦 Retirado</span>
                    <b className="block text-white text-[16px] tabular-nums leading-tight break-words">− {money(c.retiradas)}</b>
                  </span>
                )}
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
              ]}>Use para dinheiro que entrou ou saiu sem ser venda. Vendas entram sozinhas.</InfoTip>} />
              <div className="grid grid-cols-4 gap-1.5">
                {MANUAL.map((m) => (
                  <button key={m.type} onClick={() => setAdd(m.type)} className={`h-16 rounded-xl border font-semibold flex flex-col items-center justify-center text-[12px] leading-tight ${m.tone}`}>
                    <span className="text-xl">{m.icon}</span>{m.label}
                  </button>
                ))}
              </div>
            </>)}

            {/* conta do dia: normal (lista clara) ou caderno (manuscrito) */}
            <BlockHeader icon="🧮" tint="bg-blue-100" title="Conta do dia" subtitle="Como se chega no saldo" right={<InfoTip title="Conta do dia" example={[
              ['💰', 'Vendas 935'],
              ['🤝', 'Chico − 50 → Hoje 885'],
              ['📅', 'Ontem 645 + 885 = 1.530'],
              ['🏦', 'Retirada − 300'],
              ['✅', <b>Saldo 1.230</b>],
            ]}>
              É a mesma conta do caderno, em duas formas de ver. “Ontem” vem sozinho do último dia; toque nele para corrigir.</InfoTip>} />
            <div className="grid grid-cols-2 bg-slate-200/70 rounded-xl p-1 mb-2">
              {(['normal', 'caderno'] as const).map((v) => (
                <button key={v} onClick={() => setView(v)} className={`h-11 rounded-lg text-sm font-semibold ${view === v ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}>
                  {v === 'normal' ? '📋 Normal' : '📒 Caderno'}
                </button>
              ))}
            </div>
            {view === 'normal' ? (
              <div className="space-y-2">
                {/* bloco 1: o que aconteceu hoje */}
                <Card className="overflow-hidden">
                  <div className="flex items-center gap-2 px-4 pt-3 pb-1 text-[13px] font-bold text-slate-500 uppercase tracking-wide">☀️ {isTodayLabel(day.date) === 'de hoje' ? 'Hoje' : 'No dia'}</div>
                  <ContaLine icon="💰" tint="bg-emerald-100" label="Vendas" value={c.salesTotal} sign="+"
                    sub={methods.filter((m) => c.salesByMethod[m]).map((m) => `${PAYMENT_EMOJI[m]} ${money(c.salesByMethod[m])}`).join('  ·  ') || undefined} />
                  {c.entradas > 0 && <ContaLine icon="➕" tint="bg-emerald-100" label="Outras entradas" value={c.entradas} sign="+" />}
                  {c.dar.map((d) => <ContaLine key={d.id} icon="🤝" tint="bg-orange-100" label={`Dei a ${d.person || d.description || 'alguém'}`} value={d.amountInCents} sign="−" />)}
                  {c.despesas > 0 && <ContaLine icon="🧾" tint="bg-red-100" label="Despesas" value={c.despesas} sign="−" />}
                  <div className="flex items-center justify-between mx-3 mb-3 mt-1 rounded-xl bg-slate-100 px-3 py-2.5">
                    <span className="font-bold text-slate-700">= Resultado {isTodayLabel(day.date) === 'de hoje' ? 'de hoje' : 'do dia'}</span>
                    <span className={`text-[18px] font-extrabold tabular-nums ${c.todayNet < 0 ? 'text-red-600' : 'text-slate-800'}`}>{c.todayNet < 0 ? '−' : ''}{money(Math.abs(c.todayNet))}</span>
                  </div>
                </Card>
                {/* bloco 2: como chega no saldo */}
                <Card className="overflow-hidden">
                  <div className="flex items-center gap-2 px-4 pt-3 pb-1 text-[13px] font-bold text-slate-500 uppercase tracking-wide">🧮 Saldo</div>
                  <div className="flex items-center gap-3 px-4 py-2">
                    <span className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center">📅</span>
                    <span className="flex-1">
                      <span className="block text-[15px] text-slate-700">Veio de ontem{c.openingManual ? ' (digitado)' : ''}</span>
                      {!locked && <button onClick={() => setEditOpening(true)} className="text-[12px] font-semibold text-blue-600 py-1 -my-1">✏️ corrigir</button>}
                    </span>
                    <span className="font-bold tabular-nums text-slate-800">{money(c.opening)}</span>
                  </div>
                  <ContaLine icon="☀️" tint="bg-amber-100" label={isTodayLabel(day.date) === 'de hoje' ? 'Resultado de hoje' : 'Resultado do dia'} value={Math.abs(c.todayNet)} sign={c.todayNet < 0 ? '−' : '+'} />
                  {c.retiradas > 0 && <ContaLine icon="🏦" tint="bg-slate-200" label="Retiradas" value={c.retiradas} sign="−" />}
                  <div className="flex items-center justify-between mx-3 mb-3 mt-1 rounded-xl bg-emerald-600 text-white px-3 py-3">
                    <span className="font-bold">= Saldo final</span>
                    <span className="text-[24px] font-extrabold tabular-nums">{money(c.accumulated, sym)}</span>
                  </div>
                </Card>
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
                  {c.retiradas > 0 && <> − {money(c.retiradas)} = <b>{money(c.accumulated)}</b></>}
                </div>
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

            {/* divisão: daqui para baixo, tudo o que foi movimentado no dia */}
            <div className="flex items-center gap-3 mt-7 -mb-2 px-1" aria-hidden>
              <span className="flex-1 h-px bg-gradient-to-r from-transparent via-slate-300 to-slate-300" />
              <span className="text-[11px] tracking-[0.3em] text-slate-300">• • •</span>
              <span className="flex-1 h-px bg-gradient-to-l from-transparent via-slate-300 to-slate-300" />
            </div>
            <BlockHeader icon="🧾" tint="bg-slate-200" title={`Movimentado ${isTodayLabel(day.date) === 'de hoje' ? 'hoje' : 'no dia'}`}
              subtitle={`${timeline.length} ${timeline.length === 1 ? 'registro' : 'registros'} · do mais novo para o mais antigo`}
              right={<InfoTip title="Movimentado hoje" example={[
                ['🛍️', 'Cada venda mostra de onde saiu cada peça (grupo › cor) e como foi paga'],
                ['✏️', <>Errou o preço? <b>Corrigir valor</b></>],
                ['✖️', <>Venda que não aconteceu? <b>Cancelar venda</b> (as peças voltam)</>],
                ['🤝', 'Lançamentos de dinheiro (dei, despesa, retirada) também aparecem aqui'],
              ]}>Tudo o que mexeu no caixa no dia, em ordem de horário.</InfoTip>}>
              <div className="flex flex-wrap gap-1.5 mt-2">
                <span className="rounded-full bg-emerald-100 text-emerald-800 px-2.5 py-1 text-[12px] font-bold">🛍️ {data.s.salesCount} {data.s.salesCount === 1 ? 'venda' : 'vendas'} · +{money(c.salesTotal)}</span>
                {c.entradas > 0 && <span className="rounded-full bg-emerald-50 text-emerald-700 px-2.5 py-1 text-[12px] font-bold">➕ entradas +{money(c.entradas)}</span>}
                {c.darTotal + c.despesas + c.retiradas > 0 && <span className="rounded-full bg-red-100 text-red-700 px-2.5 py-1 text-[12px] font-bold">↘️ saídas −{money(c.darTotal + c.despesas + c.retiradas)}</span>}
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
                    </div>
                    {/* de onde veio: uma linha por peça (grupo › cor × quantidade) */}
                    <div className="mx-3 mt-2 rounded-xl bg-slate-50 border border-slate-100 divide-y divide-slate-100">
                      {lines.map((l) => {
                        const pc = data.pieces.get(l.variantId);
                        return (
                          <div key={l.id} className="flex items-center gap-2 px-2.5 py-2">
                            <span className="text-base">{pc?.icon}</span>
                            <span className="text-[13px] font-bold" style={{ color: pc?.groupColor }}>{pc?.group}</span>
                            <span className="text-slate-300">›</span>
                            <Swatch color={pc?.color} size={14} />
                            <span className="flex-1 min-w-0 break-words text-[14px] font-semibold text-slate-800">{pc?.name}</span>
                            <span className="text-[13px] font-extrabold text-slate-700 tabular-nums">×{l.quantity}</span>
                            <span className="w-14 text-right text-[12px] text-slate-500 tabular-nums">{l.unitPriceInCents === null ? 'sem preço' : money(l.totalInCents)}</span>
                          </div>
                        );
                      })}
                    </div>
                    {!cancelled && !locked ? (
                      <div className="grid grid-cols-2 gap-2 p-3">
                        <button className="h-10 rounded-lg bg-slate-100 text-[13px] font-semibold text-slate-700 active:bg-slate-200" onClick={() => setFix(o.id)}>✏️ Corrigir valor</button>
                        <button className="h-10 rounded-lg bg-red-50 text-[13px] font-semibold text-red-600 active:bg-red-100" onClick={() => cancel(o.id)}>✖️ Cancelar venda</button>
                      </div>
                    ) : <div className="h-3" />}
                  </Card>
                );
              })() : (
                <Card key={t.m.id} className="p-3 flex items-center gap-3">
                  <span className="w-10 h-10 shrink-0 rounded-xl bg-slate-50 flex items-center justify-center text-lg">{t.m.type === 'venda' ? '📒' : MANUAL.find((x) => x.type === t.m.type)?.icon ?? '•'}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-semibold text-slate-800">{t.m.type === 'venda' ? `Venda · ${t.m.quantity ?? 1} ${(t.m.quantity ?? 1) === 1 ? 'peça' : 'peças'}` : CASH_LABEL[t.m.type]}{t.m.person ? ` · ${t.m.person}` : ''}</span>
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
          </>
        );
      })()}
    </div>
  );
}

/** Cabeçalho padrão das seções do Caixa: ícone colorido, título, explicação curta e ⓘ/resumo. */
function BlockHeader({ icon, tint, title, subtitle, right, children }: {
  icon: string; tint: string; title: string; subtitle?: string; right?: React.ReactNode; children?: React.ReactNode;
}) {
  return (
    <div className="mt-6 mb-2.5">
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

function ContaLine({ icon, tint, label, value, sign, sub }: { icon: string; tint: string; label: string; value: number; sign: '+' | '−'; sub?: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2">
      <span className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${tint}`}>{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-[15px] text-slate-700 break-words">{label}</span>
        {sub && <span className="block text-[12px] text-slate-500 break-words">{sub}</span>}
      </span>
      <span className={`font-bold tabular-nums ${sign === '+' ? 'text-emerald-600' : 'text-red-600'}`}>{sign} {money(value)}</span>
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

function AddCashSheet({ type, onClose, cashOnHand }: { type: ManualType | null; onClose: () => void; cashOnHand: number }) {
  const { day } = useApp();
  const { run, confirm } = useUi();
  const [busy, wrap] = useBusy();
  const [amount, setAmount] = useState('');
  const [person, setPerson] = useState('');
  const [desc, setDesc] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('dinheiro');
  const meta = MANUAL.find((m) => m.type === type);
  if (!type || !meta || !day) return null;
  const cents = toCents(amount);
  return (
    <Sheet open onClose={onClose} title={`${meta.icon} ${meta.label}`}
      footer={<Button size="lg" className="w-full" disabled={!cents || busy} onClick={() => wrap(async () => {
        if (type !== 'entrada' && method === 'dinheiro' && cents! > cashOnHand && !(await confirm({ title: 'Mais do que tem em dinheiro?', tone: 'warning',
          confirm: 'Lançar mesmo assim', message: `Pelas contas, há ${money(cashOnHand)} em dinheiro vivo. Lançando ${money(cents)}, o dinheiro fica negativo.` }))) return;
        const r = await run(() => addCashMovement({ dailyRecordId: day.id, type, amountInCents: cents!, person, description: desc, paymentMethod: method }), 'Lançado');
        if (r) { setAmount(''); setPerson(''); setDesc(''); onClose(); }
      })}>Lançar {cents ? money(cents) : ''}</Button>}>
      <p className="text-sm text-slate-500 mb-3">{meta.hint}</p>
      <Field label="Valor"><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" autoFocus /></Field>
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
