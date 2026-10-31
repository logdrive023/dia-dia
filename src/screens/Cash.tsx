import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { CashType, PaymentMethod } from '../db/types';
import { money, PAYMENT_EMOJI, PAYMENT_LABEL, PAYMENTS, toCents } from '../lib/util';
import { addCashMovement, CASH_IN, CASH_LABEL, removeCashMovement, setCountedBalance, setOpeningBalance } from '../services/cash';
import { orderLine } from '../services/report';
import { cancelOrder } from '../services/sales';
import { daySummary } from '../services/summary';
import { useApp } from '../state';
import { DayNotices, DayBar, StartDayCard } from '../components/day';
import { Badge, Button, Card, Field, Input, SectionTitle, Sheet, useBusy, useUi } from '../components/ui';

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
  const data = useLiveQuery(async () => {
    if (!day) return null;
    const [s, variants, groups] = await Promise.all([daySummary(day.id, day.date), db.variants.toArray(), db.groups.toArray()]);
    const allOrders = await db.orders.where('dailyRecordId').equals(day.id).sortBy('createdAt');
    const sales = await db.sales.where('dailyRecordId').equals(day.id).toArray();
    const g = new Map(groups.map((x) => [x.id, x.name]));
    const names = new Map(variants.map((v) => [v.id, `${g.get(v.groupId)} ${v.name}`]));
    return { s, allOrders, sales, names };
  }, [day?.id]);
  const locked = day?.status !== 'open';
  const sym = settings.currencySymbol;

  return (
    <div>
      <DayBar />
      <DayNotices />
      {day === null && <StartDayCard />}
      {day && data && (() => {
        const c = data.s.cash;
        return (
          <>
            <Card className="p-4 bg-gradient-to-br from-emerald-600 to-emerald-700 text-white border-0">
              <div className="text-emerald-100 text-sm">Saldo do caixa (esperado)</div>
              <div className="text-4xl font-extrabold tabular-nums">{sym && <span className="text-2xl mr-1">{sym}</span>}{money(c.accumulated)}</div>
              <div className="text-emerald-100 text-sm mt-0.5">Hoje {c.todayNet >= 0 ? '+' : ''}{money(c.todayNet)} · Ontem {money(c.opening)}</div>
            </Card>

            <SectionTitle>Conta do dia</SectionTitle>
            <Card className="p-4 notebook !bg-sky-50 text-[17px]">
              <div>Vendas: {money(c.salesTotal)}</div>
              {c.entradas > 0 && <div>Entradas: + {money(c.entradas)}</div>}
              {c.dar.map((d) => <div key={d.id}>{d.person || d.description || 'Dei'}: − {money(d.amountInCents)} <small>(eu dei)</small></div>)}
              {c.despesas > 0 && <div>Despesas: − {money(c.despesas)}</div>}
              <div className="font-bold">= Hoje {money(c.todayNet)}</div>
              <div>
                <button disabled={locked} onClick={() => setEditOpening(true)} className="underline decoration-dotted">Ontem {money(c.opening)}{c.openingManual ? ' ✎' : ''}</button>
                {' '}+ {money(c.todayNet)} = {money(c.subtotal)}
                {c.retiradas > 0 && <> − {money(c.retiradas)} = <b>{money(c.accumulated)}</b></>}
              </div>
            </Card>

            <div className="grid gap-1.5 mt-3" style={{ gridTemplateColumns: `repeat(${PAYMENTS.filter((p) => settings.paymentMethods.includes(p) || c.salesByMethod[p]).length}, minmax(0,1fr))` }}>
              {PAYMENTS.filter((p) => settings.paymentMethods.includes(p) || c.salesByMethod[p]).map((p) => (
                <Card key={p} className="p-2 text-center">
                  <div className="text-lg">{PAYMENT_EMOJI[p]}</div>
                  <div className="text-[11px] text-slate-500">{PAYMENT_LABEL[p]}</div>
                  <div className="font-bold tabular-nums">{money(c.salesByMethod[p])}</div>
                </Card>
              ))}
            </div>

            {!locked && (
              <div className="grid grid-cols-2 gap-2 mt-3">
                {MANUAL.map((m) => (
                  <button key={m.type} onClick={() => setAdd(m.type)} className={`h-14 rounded-xl border font-semibold flex items-center justify-center gap-2 ${m.tone}`}>
                    <span className="text-xl">{m.icon}</span>{m.label}
                  </button>
                ))}
              </div>
            )}

            <SectionTitle>Conferência</SectionTitle>
            <CountedCard dayId={day.id} expected={c.accumulated} counted={c.counted} diff={c.difference} locked={locked} />

            <SectionTitle>Vendas do dia ({data.s.orders.length})</SectionTitle>
            <div className="space-y-1.5">
              {!data.allOrders.length && <p className="text-sm text-slate-400 px-1">Nenhuma venda ainda.</p>}
              {data.allOrders.map((o) => {
                const lines = data.sales.filter((s) => s.orderId === o.id);
                const cancelled = o.status === 'cancelled';
                return (
                  <Card key={o.id} className={`p-3 ${cancelled ? 'opacity-50' : ''}`}>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400 tabular-nums">{new Date(o.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                      <span className={`flex-1 font-bold text-slate-800 ${cancelled ? 'line-through' : ''}`}>{orderLine(lines, o.totalInCents, o.paymentMethod)}</span>
                      {cancelled ? <Badge tone="red">cancelada</Badge> : !locked && (
                        <button className="text-xs text-red-600 font-semibold" onClick={async () => {
                          if (await confirm({ title: 'Cancelar esta venda?', message: 'As peças voltam ao estoque e o valor sai do caixa. Fica registrado.', confirm: 'Cancelar venda', tone: 'danger' }))
                            run(() => cancelOrder(o.id), 'Venda cancelada');
                        }}>Cancelar</button>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {o.customer && <b>{o.customer} · </b>}
                      {lines.map((l) => `${l.quantity}× ${data.names.get(l.variantId)}`).join(', ')}
                    </div>
                  </Card>
                );
              })}
            </div>

            <SectionTitle>Lançamentos</SectionTitle>
            <div className="space-y-1.5">
              {c.movements.filter((m) => m.type !== 'venda').length === 0 && <p className="text-sm text-slate-400 px-1">Nenhum lançamento manual.</p>}
              {c.movements.filter((m) => m.type !== 'venda').map((m) => (
                <Card key={m.id} className="p-3 flex items-center gap-2">
                  <span className="flex-1 min-w-0">
                    <span className="font-semibold">{CASH_LABEL[m.type]}</span>
                    <span className="text-slate-500 text-sm"> · {m.person || m.description || PAYMENT_LABEL[m.paymentMethod]}</span>
                  </span>
                  <span className={`font-bold tabular-nums ${CASH_IN.includes(m.type) ? 'text-emerald-600' : 'text-red-600'}`}>
                    {CASH_IN.includes(m.type) ? '+' : '−'}{money(m.amountInCents)}
                  </span>
                  {!locked && m.type !== 'estorno' && (
                    <button className="text-slate-400 px-1" aria-label="Remover" onClick={async () => {
                      if (await confirm({ title: 'Remover lançamento?', message: 'Fica registrado no histórico de auditoria.', confirm: 'Remover', tone: 'danger' }))
                        run(() => removeCashMovement(m.id), 'Removido');
                    }}>✕</button>
                  )}
                </Card>
              ))}
            </div>
            <AddCashSheet type={add} onClose={() => setAdd(null)} />
            <OpeningSheet open={editOpening} onClose={() => setEditOpening(false)} current={c.opening} manual={c.openingManual} />
          </>
        );
      })()}
    </div>
  );
}

function CountedCard({ dayId, expected, counted, diff, locked }: { dayId: string; expected: number; counted: number | null; diff: number | null; locked: boolean }) {
  const { run } = useUi();
  const [text, setText] = useState('');
  return (
    <Card className="p-3">
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <div className="text-xs text-slate-500">Esperado</div>
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
          <Input inputMode="decimal" placeholder="Quanto tem contado?" value={text} onChange={(e) => setText(e.target.value)} />
          <Button className="h-12" disabled={toCents(text) === null} onClick={() => { run(() => setCountedBalance(dayId, toCents(text)), 'Contagem salva'); setText(''); }}>Salvar</Button>
        </div>
      )}
    </Card>
  );
}

function AddCashSheet({ type, onClose }: { type: ManualType | null; onClose: () => void }) {
  const { day } = useApp();
  const { run } = useUi();
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

function OpeningSheet({ open, onClose, current, manual }: { open: boolean; onClose: () => void; current: number; manual: boolean }) {
  const { day } = useApp();
  const { run } = useUi();
  const [v, setV] = useState('');
  if (!open || !day) return null;
  return (
    <Sheet open onClose={onClose} title="Saldo de ontem"
      footer={<Button size="lg" className="w-full" disabled={toCents(v) === null} onClick={async () => {
        const r = await run(() => setOpeningBalance(day.id, toCents(v)!), 'Saldo atualizado');
        if (r !== undefined) { setV(''); onClose(); }
      }}>Salvar</Button>}>
      <p className="text-sm text-slate-500 mb-3">
        {manual ? <>Digitado à mão: <b>{money(current)}</b>.</> : <>Calculado do saldo final do último dia: <b>{money(current)}</b>. Se o dia anterior mudar, este valor acompanha.</>}
        {' '}Corrija só se precisar (ex.: primeiro dia de uso).
      </p>
      <Field label="Ontem"><Input inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} placeholder={money(current)} autoFocus /></Field>
      {manual && (
        <Button variant="soft" className="w-full" onClick={async () => {
          const r = await run(() => setOpeningBalance(day.id, null), 'Voltou ao automático');
          if (r !== undefined) onClose();
        }}>Voltar a calcular do dia anterior</Button>
      )}
    </Sheet>
  );
}
