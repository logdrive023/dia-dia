import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { PaymentMethod, Reservation } from '../db/types';
import { money, normalize, PAYMENT_EMOJI, PAYMENT_LABEL, PAYMENTS, toCents, uid } from '../lib/util';
import { registerPendingSellGroup } from '../services/catalog';
import { cancelReservation, convertReservation, createOrder, createReservation } from '../services/sales';
import { orderLine } from '../services/report';
import { setSetting, type SellEntry } from '../services/settings';
import { loadStockRows, type StockRow } from '../services/summary';
import { useApp } from '../state';
import { DayNotices, DayBar, StartDayCard } from '../components/day';
import { Badge, Button, Card, Chip, Empty, Field, Input, Sheet, Stepper, Swatch, Toggle, useBusy, useUi } from '../components/ui';

type Filter = 'todos' | 'disp' | 'baixo' | 'esg' | 'res';
const FILTERS: [Filter, string][] = [['todos', 'Todos'], ['disp', 'Disponíveis'], ['baixo', 'Estoque baixo'], ['esg', 'Esgotados'], ['res', 'Com reservas']];

export default function Sell() {
  const { day, settings, cart, addToCart, setOverlay } = useApp();
  const { run, confirm } = useUi();
  const [scope, setScope] = useState<'sel' | 'all'>('sel');
  const [filter, setFilter] = useState<Filter>('todos');
  const [q, setQ] = useState('');
  const [reserveRow, setReserveRow] = useState<StockRow | null>(null);
  const [convert, setConvert] = useState<Reservation | null>(null);
  const [config, setConfig] = useState(false);
  const rows = useLiveQuery(() => (day ? loadStockRows(day.id, day.date) : Promise.resolve([])), [day?.id]);
  const reservations = useLiveQuery(async () => {
    if (!day) return [];
    return (await db.reservations.where('status').equals('active').toArray()).filter((r) => r.date <= day.date);
  }, [day?.id]);
  const locked = day?.status !== 'open';
  const inCart = (vid: string) => cart.filter((l) => l.variantId === vid).reduce((s, l) => s + l.quantity, 0);
  const cartCount = cart.reduce((s, l) => s + l.quantity, 0);

  const sections = useMemo(() => {
    if (!rows) return [];
    const nq = normalize(q);
    const usable = rows.filter((r) => !r.variant.archivedAt && r.variant.active && !r.group.archivedAt && r.group.active);
    const entries: (SellEntry & { order: number })[] = scope === 'sel'
      ? settings.sellGroups.map((s, i) => ({ ...s, order: i }))
      : [...new Map(usable.map((r) => [r.group.id, r.group])).values()].map((g) => ({ groupId: g.id, highlight: false, order: g.displayOrder }));
    return entries.map((e) => {
      if (e.pendingName) return { entry: e, group: null, rows: [] as StockRow[] };
      const gr = usable.filter((r) => r.group.id === e.groupId).filter((r) => {
        if (nq && !normalize(`${r.group.name} ${r.variant.name}`).includes(nq)) return false;
        if (filter === 'disp') return r.available > 0;
        if (filter === 'baixo') return r.low;
        if (filter === 'esg') return r.out;
        if (filter === 'res') return r.reserved > 0;
        return true;
      });
      return { entry: e, group: gr[0]?.group ?? rows.find((r) => r.group.id === e.groupId)?.group ?? null, rows: gr };
    }).filter((s) => s.entry.pendingName ? !nq && filter === 'todos' : s.rows.length > 0);
  }, [rows, q, filter, scope, settings.sellGroups]);

  const names = useMemo(() => new Map((rows ?? []).map((r) => [r.variant.id, `${r.group.name} ${r.variant.name}`])), [rows]);

  return (
    <div className={cartCount ? 'pb-20' : ''}>
      <DayBar />
      <DayNotices />
      {day === null && <StartDayCard />}
      {day && (
        <>
          <div className="grid grid-cols-2 bg-slate-200/70 rounded-xl p-1 mb-3">
            {(['sel', 'all'] as const).map((s) => (
              <button key={s} onClick={() => setScope(s)}
                className={`h-9 rounded-lg text-sm font-semibold ${scope === s ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}>
                {s === 'sel' ? '⭐ Para vender' : 'Todos os grupos'}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Input placeholder="🔍 Buscar..." value={q} onChange={(e) => setQ(e.target.value)} />
            <Button variant="outline" className="h-12 shrink-0" onClick={() => setConfig(true)} aria-label="Escolher grupos">⚙️</Button>
          </div>
          <div className="flex gap-2 overflow-x-auto no-scrollbar my-3 -mx-4 px-4">
            {FILTERS.map(([k, l]) => <Chip key={k} active={filter === k} onClick={() => setFilter(k)}>{l}</Chip>)}
          </div>

          {!sections.length && <Empty icon="🏷️" title="Nada para mostrar">{scope === 'sel' ? 'Escolha os grupos em ⚙️.' : 'Tente outro filtro.'}</Empty>}

          <div className="space-y-3">
            {sections.map(({ entry, group, rows: gr }) => entry.pendingName ? (
              <Card key={entry.pendingName} className="p-4 border-dashed border-2 border-slate-300 bg-slate-50">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">👑</span>
                  <div className="flex-1">
                    <div className="font-bold text-slate-800">{entry.pendingName}</div>
                    <div className="text-xs text-slate-500">Pendente de cadastro — variações e quantidades ainda não informadas.</div>
                  </div>
                  <Button size="sm" onClick={async () => {
                    const g = await run(() => registerPendingSellGroup(entry.pendingName!), 'Grupo criado. Agora cadastre as variações.');
                    if (g) setOverlay('cadastro');
                  }}>Cadastrar</Button>
                </div>
              </Card>
            ) : group && (
              <Card key={group.id} className="overflow-hidden">
                <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-slate-100" style={{ background: group.color + '14' }}>
                  <span className="text-xl">{group.icon}</span>
                  <span className="font-bold text-slate-800 flex-1">{group.name}</span>
                  {entry.highlight && <Badge tone="orange">⭐ prioridade</Badge>}
                  <span className="text-sm font-semibold text-slate-600">{gr.reduce((s, r) => s + r.available, 0)} disp.</span>
                </div>
                <div className="divide-y divide-slate-100">
                  {gr.map((r) => {
                    const c = inCart(r.variant.id);
                    const left = r.available - c;
                    return (
                      <div key={r.variant.id} className="flex items-center gap-2 pl-3.5 pr-2 py-2">
                        <Swatch color={r.variant.color} size={22} />
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-slate-800 truncate">{r.variant.name}</div>
                          <div className="text-[11px] text-slate-500">
                            físico {r.item.currentQuantity}
                            {r.reserved > 0 && <span className="text-purple-600 font-semibold"> · reserv. {r.reserved}</span>}
                            {r.out && <span className="text-red-600 font-semibold"> · esgotado</span>}
                            {r.low && <span className="text-orange-600 font-semibold"> · baixo</span>}
                          </div>
                        </div>
                        <div className="text-center w-10">
                          <div className={`text-xl font-extrabold tabular-nums ${r.available <= 0 ? 'text-red-600' : 'text-slate-800'}`}>{r.available}</div>
                          <div className="text-[9px] uppercase text-slate-400 -mt-1">disp.</div>
                        </div>
                        {!locked && (
                          <>
                            <button disabled={r.available <= 0} onClick={() => setReserveRow(r)}
                              className="h-10 px-2 rounded-xl bg-purple-50 text-purple-700 text-xs font-semibold disabled:opacity-30">Reservar</button>
                            <button disabled={left <= 0} onClick={() => addToCart(r.variant.id, r.variant.optionalPriceInCents ?? null)}
                              className="relative w-12 h-10 rounded-xl bg-blue-600 text-white text-xl font-bold disabled:opacity-30 active:scale-95 transition">
                              +
                              {c > 0 && <span className="absolute -top-1.5 -right-1.5 bg-emerald-500 text-white text-[11px] rounded-full w-5 h-5 flex items-center justify-center">{c}</span>}
                            </button>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>
            ))}
          </div>

          {!!reservations?.length && (
            <>
              <h3 className="text-[13px] font-bold uppercase tracking-wide text-slate-500 mt-5 mb-2 px-1">Reservas ativas</h3>
              <div className="space-y-2">
                {reservations.map((r) => (
                  <Card key={r.id} className="p-3 flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-slate-800 truncate">{r.quantity}× {names.get(r.variantId)}</div>
                      <div className="text-xs text-slate-500 truncate">{r.customer || 'Sem nome'}{r.notes ? ` · ${r.notes}` : ''} · desde {r.date.slice(8)}/{r.date.slice(5, 7)}</div>
                    </div>
                    {!locked && (
                      <>
                        <Button size="sm" variant="soft" onClick={async () => {
                          if (await confirm({ title: 'Cancelar reserva?', message: 'As peças voltam a ficar disponíveis.', confirm: 'Cancelar reserva', tone: 'danger' }))
                            run(() => cancelReservation(r.id), 'Reserva cancelada');
                        }}>Cancelar</Button>
                        <Button size="sm" variant="success" onClick={() => setConvert(r)}>Vender</Button>
                      </>
                    )}
                  </Card>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {cartCount > 0 && day?.status === 'open' && (
        <div className="fixed left-0 right-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-30 px-4 pb-2 flex justify-center">
          <button onClick={() => setOverlay('checkout')}
            className="w-full max-w-lg h-14 rounded-2xl bg-emerald-600 text-white font-bold text-lg shadow-lg shadow-emerald-600/30 flex items-center justify-between px-5 animate-pop">
            <span>🛒 {cartCount} {cartCount === 1 ? 'peça' : 'peças'}</span>
            <span>Fechar venda ›</span>
          </button>
        </div>
      )}

      <ReserveSheet row={reserveRow} onClose={() => setReserveRow(null)} />
      <ConvertSheet reservation={convert} name={convert ? names.get(convert.variantId) : ''} onClose={() => setConvert(null)} />
      <SellConfigSheet open={config} onClose={() => setConfig(false)} />
    </div>
  );
}

function ReserveSheet({ row, onClose }: { row: StockRow | null; onClose: () => void }) {
  const { run } = useUi();
  const [busy, wrap] = useBusy();
  const [qty, setQty] = useState(1);
  const [customer, setCustomer] = useState('');
  const [notes, setNotes] = useState('');
  if (!row) return null;
  return (
    <Sheet open onClose={onClose} title={`Reservar · ${row.group.name} ${row.variant.name}`}
      footer={<Button className="w-full" size="lg" disabled={busy} onClick={() => wrap(async () => {
        const r = await run(() => createReservation({ dailyRecordId: row.item.dailyRecordId, variantId: row.variant.id, quantity: qty, customer, notes }), 'Reservado');
        if (r) { setQty(1); setCustomer(''); setNotes(''); onClose(); }
      })}>Reservar {qty}</Button>}>
      <p className="text-sm text-slate-500 mb-3">Reserva tira do disponível, mas não do estoque físico. Disponível agora: <b>{row.available}</b>.</p>
      <div className="flex items-center justify-between mb-3"><span className="font-semibold">Quantidade</span><Stepper value={qty} onChange={setQty} min={1} max={row.available} /></div>
      <Field label="Cliente (opcional)"><Input value={customer} onChange={(e) => setCustomer(e.target.value)} /></Field>
      <Field label="Observação (opcional)"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
    </Sheet>
  );
}

function PaymentPicker({ value, onChange }: { value: PaymentMethod; onChange: (p: PaymentMethod) => void }) {
  const { settings } = useApp();
  const list = PAYMENTS.filter((p) => settings.paymentMethods.includes(p));
  return (
    <div className={`grid gap-2`} style={{ gridTemplateColumns: `repeat(${list.length}, minmax(0,1fr))` }}>
      {list.map((p) => (
        <button key={p} onClick={() => onChange(p)}
          className={`h-16 rounded-xl border-2 font-semibold text-sm flex flex-col items-center justify-center
            ${value === p ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-600'}`}>
          <span className="text-xl">{PAYMENT_EMOJI[p]}</span>{PAYMENT_LABEL[p]}
        </button>
      ))}
    </div>
  );
}

function useRecentPrices() {
  return useLiveQuery(async () => {
    const sales = await db.sales.orderBy('createdAt').reverse().limit(300).toArray();
    const freq = new Map<number, number>();
    for (const s of sales) if (s.unitPriceInCents) freq.set(s.unitPriceInCents, (freq.get(s.unitPriceInCents) ?? 0) + 1);
    return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([p]) => p).sort((a, b) => a - b);
  }, []) ?? [];
}

function PriceInput({ cents, onChange, quick }: { cents: number | null; onChange: (c: number | null) => void; quick: number[] }) {
  const [text, setText] = useState(cents === null ? '' : money(cents));
  const [last, setLast] = useState(cents);
  if (cents !== last) { setLast(cents); setText(cents === null ? '' : money(cents)); }
  return (
    <div>
      <input inputMode="decimal" placeholder="Preço" value={text}
        onChange={(e) => { setText(e.target.value); const c = toCents(e.target.value); setLast(c); onChange(c); }}
        className="w-24 h-10 px-2 rounded-lg border border-slate-300 text-right font-bold text-lg tabular-nums outline-none focus:border-blue-500" />
      {quick.length > 0 && (
        <div className="flex gap-1 mt-1 justify-end flex-wrap">
          {quick.map((p) => (
            <button key={p} onClick={() => onChange(p)}
              className={`px-2 h-7 rounded-md text-xs font-semibold ${cents === p ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}>{money(p)}</button>
          ))}
        </div>
      )}
    </div>
  );
}

export function CheckoutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { day, cart, setCart, resetCart, cartId, settings } = useApp();
  const { run, toast } = useUi();
  const [busy, wrap] = useBusy();
  const [payment, setPayment] = useState<PaymentMethod>(settings.defaultPayment);
  const [customer, setCustomer] = useState('');
  const quick = useRecentPrices();
  useEffect(() => { if (open) setPayment(settings.defaultPayment); }, [open, settings.defaultPayment]);
  const info = useLiveQuery(async () => {
    if (!day) return null;
    const rows = await loadStockRows(day.id, day.date);
    return new Map(rows.map((r) => [r.variant.id, r]));
  }, [day?.id]);
  if (!open || !day) return null;
  const total = cart.reduce((s, l) => s + (l.unitPriceInCents ?? 0) * l.quantity, 0);
  const pieces = cart.reduce((s, l) => s + l.quantity, 0);
  const missingPrice = cart.some((l) => l.unitPriceInCents === null);
  const firstPrice = cart.find((l) => l.unitPriceInCents !== null)?.unitPriceInCents ?? null;
  const update = (i: number, patch: Partial<(typeof cart)[number]>) =>
    setCart(cart.map((l, j) => (j === i ? { ...l, ...patch } : l)).filter((l) => l.quantity > 0));

  const confirm = () => wrap(async () => {
    const o = await run(() => createOrder({ orderId: cartId, dailyRecordId: day.id, lines: cart, paymentMethod: payment, customer }));
    if (o) {
      toast(`Venda: ${orderLine(cart, o.totalInCents, payment)}`);
      resetCart(); setCustomer(''); onClose();
    }
  });

  return (
    <Sheet open onClose={onClose} title="Fechar venda" tall
      footer={
        <Button variant="success" size="lg" className="w-full text-lg" disabled={!cart.length || busy} onClick={confirm}>
          ✔ Confirmar · {pieces} {pieces === 1 ? 'peça' : 'peças'} · {settings.currencySymbol} {money(total)}
        </Button>
      }>
      {!cart.length && <Empty icon="🛒" title="Carrinho vazio">Toque em “+” nas peças para adicionar.</Empty>}
      <div className="space-y-2">
        {cart.map((l, i) => {
          const r = info?.get(l.variantId);
          return (
            <Card key={l.variantId + i} className="p-3">
              <div className="flex items-start gap-2">
                <Swatch color={r?.variant.color} size={22} />
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-slate-800 truncate">{r?.group.name} · {r?.variant.name}</div>
                  <div className="text-xs text-slate-500">disponível {r?.available ?? '–'}</div>
                  <div className="mt-2"><Stepper value={l.quantity} onChange={(v) => update(i, { quantity: v })} min={0} max={r?.available} /></div>
                </div>
                <PriceInput cents={l.unitPriceInCents} onChange={(c) => update(i, { unitPriceInCents: c })} quick={quick} />
              </div>
            </Card>
          );
        })}
      </div>
      {cart.length > 1 && firstPrice !== null && (
        <button className="text-sm text-blue-600 font-semibold mt-2" onClick={() => setCart(cart.map((l) => ({ ...l, unitPriceInCents: firstPrice })))}>
          Usar {money(firstPrice)} em todas
        </button>
      )}
      {missingPrice && <p className="text-xs text-orange-600 mt-2">Peças sem preço contam no estoque, mas não somam no caixa.</p>}

      <div className="mt-4 mb-2 font-semibold text-slate-700">Como pagou?</div>
      <PaymentPicker value={payment} onChange={setPayment} />
      <div className="mt-4"><Field label="Cliente (opcional)"><Input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Nome" /></Field></div>
      <Card className="p-4 text-center notebook !bg-sky-50">
        <div className="text-lg">{cart.length ? orderLine(cart, total, payment) : '—'}</div>
      </Card>
    </Sheet>
  );
}

function ConvertSheet({ reservation, name, onClose }: { reservation: Reservation | null; name?: string; onClose: () => void }) {
  const { day, settings } = useApp();
  const { run } = useUi();
  const [busy, wrap] = useBusy();
  const [price, setPrice] = useState<number | null>(null);
  const [payment, setPayment] = useState<PaymentMethod>(settings.defaultPayment);
  const [orderId] = useState(uid);
  const quick = useRecentPrices();
  if (!reservation || !day) return null;
  return (
    <Sheet open onClose={onClose} title="Converter reserva em venda"
      footer={<Button variant="success" size="lg" className="w-full" disabled={busy} onClick={() => wrap(async () => {
        const o = await run(() => convertReservation({ reservationId: reservation.id, dailyRecordId: day.id, unitPriceInCents: price, paymentMethod: payment, orderId: orderId + reservation.id }), 'Venda registrada');
        if (o) onClose();
      })}>Confirmar venda · {money((price ?? 0) * reservation.quantity)}</Button>}>
      <div className="font-bold text-slate-800 mb-1">{reservation.quantity}× {name}</div>
      <div className="text-sm text-slate-500 mb-3">{reservation.customer || 'Sem nome'}</div>
      <div className="flex items-center justify-between mb-4"><span className="font-semibold">Preço por peça</span><PriceInput cents={price} onChange={setPrice} quick={quick} /></div>
      <PaymentPicker value={payment} onChange={setPayment} />
    </Sheet>
  );
}

function SellConfigSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings } = useApp();
  const groups = useLiveQuery(async () => (await db.groups.orderBy('displayOrder').toArray()).filter((g) => !g.archivedAt), []);
  if (!open) return null;
  const list = settings.sellGroups;
  const save = (v: SellEntry[]) => setSetting('sellGroups', v);
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    const n = [...list]; [n[i], n[j]] = [n[j], n[i]]; save(n);
  };
  const name = (e: SellEntry) => e.pendingName ? `${e.pendingName} (pendente)` : groups?.find((g) => g.id === e.groupId)?.name ?? '—';
  return (
    <Sheet open onClose={onClose} title="Grupos em “Para vender”" tall>
      <p className="text-sm text-slate-500 mb-3">Só muda o que aparece aqui. O estoque é sempre o mesmo.</p>
      <div className="space-y-1.5 mb-5">
        {list.map((e, i) => (
          <Card key={(e.groupId ?? e.pendingName)!} className="flex items-center gap-1 p-2 pl-3">
            <span className="flex-1 font-semibold text-slate-800 truncate">{name(e)}</span>
            <button className={`w-9 h-9 rounded-lg ${e.highlight ? 'bg-orange-100' : 'bg-slate-100 grayscale opacity-60'}`}
              onClick={() => save(list.map((x, j) => (j === i ? { ...x, highlight: !x.highlight } : x)))} aria-label="Prioridade">⭐</button>
            <button className="w-9 h-9 rounded-lg bg-slate-100" onClick={() => move(i, -1)}>↑</button>
            <button className="w-9 h-9 rounded-lg bg-slate-100" onClick={() => move(i, 1)}>↓</button>
            <button className="w-9 h-9 rounded-lg bg-red-50 text-red-600" onClick={() => save(list.filter((_, j) => j !== i))}>✕</button>
          </Card>
        ))}
        {!list.length && <p className="text-sm text-slate-400">Nenhum grupo selecionado.</p>}
      </div>
      <h3 className="font-bold text-slate-700 mb-1">Adicionar grupos</h3>
      {groups?.map((g) => (
        <Toggle key={g.id} label={`${g.icon ?? ''} ${g.name}`} checked={list.some((e) => e.groupId === g.id)}
          onChange={(on) => save(on ? [...list, { groupId: g.id, highlight: false }] : list.filter((e) => e.groupId !== g.id))} />
      ))}
    </Sheet>
  );
}
