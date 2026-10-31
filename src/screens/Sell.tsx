import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { PaymentMethod, Reservation } from '../db/types';
import { money, normalize, PAYMENT_EMOJI, PAYMENT_LABEL, PAYMENTS, toCents, uid } from '../lib/util';
import { setForSale } from '../services/catalog';
import { cancelReservation, convertReservation, createOrder, createReservation } from '../services/sales';
import { orderLine } from '../services/report';
import { setSetting, type SellEntry } from '../services/settings';
import { loadStockRows, type StockRow } from '../services/summary';
import { useApp } from '../state';
import { DayNotices, DayBar, StartDayCard } from '../components/day';
import { StockFlow } from '../components/StockFlow';
import { Button, Card, Chip, Empty, Field, HelpButton, InfoTip, Input, Sheet, Stepper, Swatch, Toggle, useBusy, useUi } from '../components/ui';

type Filter = 'todos' | 'disp' | 'baixo' | 'esg' | 'res';
const FILTERS: [Filter, string][] = [['todos', 'Todos'], ['disp', 'Disponíveis'], ['baixo', 'Para repor'], ['esg', 'Esgotados'], ['res', 'Com reservas']];

export default function Sell() {
  const { day, settings, cart, addToCart, setCart, setOverlay } = useApp();
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
  const lastPrice = useLastPriceByGroup();
  const allGroups = useLiveQuery(() => db.groups.toArray(), []);
  const [putSale, setPutSale] = useState(false);
  const [closed, setClosedRaw] = useState<Record<string, boolean>>(() => { try { return JSON.parse(localStorage.getItem('sellClosed') || '{}'); } catch { return {}; } });
  const setClosed = (v: Record<string, boolean>) => { setClosedRaw(v); try { localStorage.setItem('sellClosed', JSON.stringify(v)); } catch { /* ok */ } };
  const searching = !!q.trim() || filter !== 'todos';
  const isOpenG = (id: string) => searching || !closed[id];
  const toggleGroup = (id: string) => { if (!searching) setClosed({ ...closed, [id]: !closed[id] }); };
  const locked = day?.status !== 'open';
  const inCart = (vid: string) => cart.filter((l) => l.variantId === vid).reduce((s, l) => s + l.quantity, 0);
  const cartCount = cart.reduce((s, l) => s + l.quantity, 0);
  const cartTotal = cart.reduce((s, l) => s + (l.unitPriceInCents ?? 0) * l.quantity, 0);
  const removeOne = (vid: string) =>
    setCart(cart.map((l) => (l.variantId === vid && !l.reservationId ? { ...l, quantity: l.quantity - 1 } : l)).filter((l) => l.quantity > 0));

  const sections = useMemo(() => {
    if (!rows) return [];
    const nq = normalize(q);
    const usable = rows.filter((r) => !r.variant.archivedAt && r.variant.active && !r.group.archivedAt && r.group.active && r.variant.forSale !== false);
    const entries: (SellEntry & { order: number })[] = scope === 'sel'
      ? settings.sellGroups.map((s, i) => ({ ...s, order: i }))
      : [...new Map(usable.map((r) => [r.group.id, r.group])).values()].map((g) => ({ groupId: g.id, highlight: false, order: g.displayOrder }));
    return entries.map((e) => {
      if (e.pendingName) return { entry: e, group: null, rows: [] as StockRow[] };
      const gr = usable.filter((r) => r.group.id === e.groupId).filter((r) => {
        if (nq && !normalize(`${r.group.name} ${r.variant.name}`).includes(nq)) return false;
        if (filter === 'disp') return r.available > 0;
        if (filter === 'baixo') return r.restock > 0;
        if (filter === 'esg') return r.out;
        if (filter === 'res') return r.reserved > 0;
        return true;
      });
      const g = gr[0]?.group ?? rows.find((r) => r.group.id === e.groupId)?.group ?? allGroups?.find((x) => x.id === e.groupId) ?? null;
      return { entry: e, group: g, rows: gr };
    }).filter((s) => s.rows.length > 0);
  }, [rows, q, filter, scope, settings.sellGroups, allGroups]);

  const onSaleCount = (rows ?? []).filter((r) => r.variant.forSale !== false && !r.variant.archivedAt && !r.group.archivedAt).length;
  const hiddenCount = (rows ?? []).filter((r) => r.variant.forSale === false && !r.variant.archivedAt && !r.group.archivedAt).length;
  const names = useMemo(() => new Map((rows ?? []).map((r) => [r.variant.id, `${r.group.name} ${r.variant.name}`])), [rows]);

  return (
    <div className={cartCount ? 'pb-20' : ''}>
      <DayBar compact />
      <DayNotices />
      {day === null && <StartDayCard />}
      {day && (
        <>
          {!locked && (
            <div className="flex gap-2 mb-3">
              <HelpButton icon="🛍️" label="Como vender" title="Como vender" example={[
                ['👩', 'A cliente levou 2 Azul Branco e 1 Plomo Rosa'],
                ['➕', <>Toque 2× em <b>+ Vender</b> no Branco e 1× no Rosa</>],
                ['🛒', <>Toque em <b>Fechar venda</b> e confira o preço</>],
                ['⚡', <>Escolha <b>Pix</b> e toque em <b>Confirmar</b></>],
                ['✅', 'Estoque e caixa atualizam sozinhos'],
              ]}>
                <StepsBar color="bg-blue-600" steps={[['➕', '+ Vender'], ['🛒', 'Fechar venda'], ['💵', 'Como pagou']]} />
                <span className="block mt-2">Uma venda = uma cliente, pode ter várias peças. O preço já vem preenchido com o último preço do grupo.</span>
              </HelpButton>
              <HelpButton icon="📌" label="Como reservar" title="Como reservar" example={[
                ['👩', 'Ana pediu 1 Plomo Rosa e vai buscar sábado'],
                ['📌', <>Toque no <b>📌</b> da peça</>],
                ['✍️', <>Escreva <b>Ana</b> e a quantidade · obs.: “busca sábado”</>],
                ['🏷️', 'A peça sai do “à venda”, mas continua no estoque'],
                ['💰', <>No sábado: <b>Reservas ativas</b> › <b>Vender</b></>],
                ['✖️', <>Desistiu? <b>Cancelar</b> e a peça volta</>],
              ]}>
                <StepsBar color="bg-purple-600" steps={[['📌', 'Reservar'], ['👩', 'Nome da cliente'], ['💰', 'Vender quando pagar']]} />
                <span className="block mt-2">Reservar guarda a peça para uma cliente: ninguém mais consegue vender.</span>
              </HelpButton>
            </div>
          )}
          <div className="sticky top-[calc(64px+env(safe-area-inset-top))] z-10 bg-slate-100 -mx-4 px-4 pt-1 pb-2 mb-1">
          <div className="flex gap-2">
            <Input placeholder="🔍 Buscar peça ou cor..." value={q} onChange={(e) => setQ(e.target.value)} />
            <Button variant="outline" className="h-12 shrink-0 text-sm" onClick={() => setConfig(true)} aria-label="Escolher grupos">⚙️ Grupos</Button>
          </div>
          <div className="flex gap-2 overflow-x-auto no-scrollbar mt-2 -mx-4 px-4 pb-1 items-center">
            <Chip active={scope === 'sel'} onClick={() => setScope('sel')}>⭐ Para vender</Chip>
            <Chip active={scope === 'all'} onClick={() => setScope('all')}>Todos os grupos</Chip>
            <span className="w-px h-6 bg-slate-300 shrink-0 mx-0.5" />
            {FILTERS.map(([k, l]) => (
              <button key={k} onClick={() => setFilter(k)}
                className={`shrink-0 h-10 px-3.5 rounded-full text-sm font-medium transition ${filter === k ? 'bg-slate-800 text-white' : 'text-slate-600 bg-slate-200/70 active:bg-slate-300'}`}>{l}</button>
            ))}
          </div>
          </div>

          {!locked && (
            <div className="flex items-center gap-2 mt-1 mb-5">
              <button onClick={() => setPutSale(true)}
                className="flex-1 min-w-0 flex items-center gap-2.5 rounded-xl bg-white border-2 border-dashed border-blue-300 px-3 py-2.5 text-left active:bg-blue-50">
                <span className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center text-lg shrink-0">🏷️</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[14px] font-bold text-blue-800">Estoque ⇄ Venda</span>
                  <span className="block text-[12px] text-slate-500 break-words">🔒 {hiddenCount} guardadas · 🏷️ {onSaleCount} à venda</span>
                </span>
                <span className="text-blue-400 text-xl">›</span>
              </button>
              <InfoTip title="Estoque ⇄ Venda" example={[
                ['🔒', <>Aba <b>Trazer para vender</b>: só o que está no estoque e não está vendendo</>],
                ['🏷️', <>Toque em <b>Vender</b> na cor (ou <b>Vender todas</b> no grupo) e ela aparece aqui</>],
                ['↩️', <>Aba <b>Voltar pro estoque</b>: o que está à venda</>],
                ['📦', <>Toque em <b>Guardar</b> e ela sai do Vender, mas continua no estoque</>],
              ]}>As peças são sempre as mesmas do estoque. Aqui você só escolhe o que aparece para vender.</InfoTip>
            </div>
          )}
          {!sections.length && <Empty icon="🏷️" title="Nada para mostrar">{scope === 'sel' ? 'Escolha os grupos em ⚙️.' : 'Tente outro filtro.'}</Empty>}

          {sections.some((x) => x.group) && !searching && (() => {
            const ids = sections.map((x) => x.group?.id).filter(Boolean) as string[];
            const allClosed = ids.every((id) => closed[id]);
            return (
              <div className="flex items-center justify-between gap-3 mb-3 px-1">
                <span className="flex items-center gap-2 min-w-0 text-[13px] text-slate-600 leading-tight">
                  <span className="w-7 h-7 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-base shrink-0">👆</span>
                  <span className="min-w-0">Toque no <b className="text-slate-800">grupo</b> para abrir ou fechar</span>
                </span>
                <button onClick={() => setClosed(Object.fromEntries(ids.map((id) => [id, !allClosed])))}
                  className="shrink-0 whitespace-nowrap h-9 px-3 rounded-lg bg-white border border-slate-200 text-[13px] font-semibold text-slate-700 active:bg-slate-50">
                  {allClosed ? '▾ Abrir todos' : '▴ Fechar todos'}
                </button>
              </div>
            );
          })()}
          <div className="space-y-6">
            {sections.map(({ entry, group, rows: gr }) => group && (
              <Card key={group.id} className="overflow-hidden shadow-md border-slate-300/70 border-t-4" style={{ borderTopColor: group.color }}>
                <button type="button" onClick={() => toggleGroup(group.id)} aria-expanded={isOpenG(group.id)} aria-label={`${isOpenG(group.id) ? 'Fechar' : 'Abrir'} ${group.name}`}
                  className={`relative w-full text-left flex items-center gap-2.5 pl-4 pr-3 py-3 ${isOpenG(group.id) ? 'border-b border-slate-100' : ''}`} style={{ background: group.color + '12' }}>
                  <span className="absolute left-0 top-0 bottom-0 w-1.5" style={{ background: group.color }} />
                  <span className="text-2xl">{group.icon}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-extrabold text-slate-800 text-[17px] leading-tight break-words">{group.name}</span>
                    {entry.highlight && <span className="text-[11px] font-bold text-orange-600">⭐ prioridade</span>}
                  </span>
                  <span className="shrink-0 rounded-full bg-white border border-slate-200 px-2 py-1 text-[12px] font-bold text-slate-700 tabular-nums whitespace-nowrap">
                    {gr.reduce((s, r) => s + Math.max(0, r.available), 0)} à venda
                  </span>
                  {!isOpenG(group.id) && gr.some((r) => inCart(r.variant.id) > 0) && (
                    <span className="rounded-full bg-emerald-500 text-white px-2 py-1 text-[11px] font-bold">🛒 {gr.reduce((n, r) => n + inCart(r.variant.id), 0)}</span>
                  )}
                  <span className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${isOpenG(group.id) ? 'bg-slate-800 text-white' : 'bg-white border border-slate-300 text-slate-700'}`} aria-hidden>
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"
                      className={`transition-transform duration-200 ${isOpenG(group.id) ? 'rotate-180' : ''}`}><path d="M6 9l6 6 6-6" /></svg>
                  </span>
                </button>
                {isOpenG(group.id) && (
                <div className="divide-y divide-slate-100">
                  {gr.map((r) => {
                    const c = inCart(r.variant.id);
                    const left = r.available - c;
                    return (
                      <div key={r.variant.id} className={`flex items-center gap-3 pl-4 pr-2.5 py-2.5 ${c > 0 ? 'bg-emerald-50' : ''} ${r.out && !c ? 'opacity-60' : ''}`}>
                        <span className="rounded-full ring-2 ring-offset-1 ring-slate-100"><Swatch color={r.variant.color} size={26} /></span>
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-slate-800 text-[16px] leading-tight break-words">{r.variant.name}</div>
                          {!r.out && <div className="text-[13px] font-bold text-slate-700 mt-0.5 tabular-nums">🏷️ {r.available} à venda</div>}
                          <StockFlow size="sm" start={r.item.initialQuantity} now={r.item.currentQuantity} restock={r.restock} out={r.out} reserved={r.reserved} />
                        </div>
                        {!locked && (c > 0 ? (
                          <div className="flex items-center gap-1 bg-white rounded-xl border-2 border-emerald-500 p-0.5 shadow-sm">
                            <button onClick={() => removeOne(r.variant.id)} aria-label={`Tirar 1 ${r.variant.name}`}
                              className="w-11 h-11 rounded-lg bg-slate-100 text-xl font-bold text-slate-700 active:scale-95">−</button>
                            <span className="w-6 text-center font-extrabold text-emerald-700 tabular-nums">{c}</span>
                            <button disabled={left <= 0} onClick={() => addToCart(r.variant.id, r.variant.optionalPriceInCents ?? lastPrice?.get(r.group.id) ?? null)}
                              aria-label={`Mais 1 ${r.variant.name}`} className="w-11 h-11 rounded-lg bg-blue-600 text-white text-xl font-bold disabled:opacity-30 active:scale-95">+</button>
                          </div>
                        ) : r.available > 0 ? (
                          <div className="flex items-center gap-1.5">
                            <button onClick={() => setReserveRow(r)} aria-label={`Reservar ${r.variant.name}`}
                              className="w-11 h-11 rounded-xl border border-purple-200 bg-purple-50 text-purple-700 text-lg active:bg-purple-100">📌</button>
                            <button onClick={() => addToCart(r.variant.id, r.variant.optionalPriceInCents ?? lastPrice?.get(r.group.id) ?? null)}
                              aria-label={`Vender ${r.variant.name}`}
                              className="h-11 px-3.5 rounded-xl bg-blue-600 text-white text-[15px] font-bold shadow-sm shadow-blue-600/30 active:scale-95 transition">+ Vender</button>
                          </div>
                        ) : (
                          <span className="text-[12px] text-slate-400 pr-1">sem peça</span>
                        ))}
                      </div>
                    );
                  })}
                </div>
                )}
              </Card>
            ))}
          </div>

          {!!reservations?.length && (
            <>
              <h3 className="flex items-center gap-1.5 text-[13px] font-bold uppercase tracking-wide text-slate-500 mt-5 mb-2 px-1">Reservas ativas
                <InfoTip title="Reservas" example={[
                  ['📌', 'Ana pediu 1 Plomo Rosa para amanhã → Reservar 1 para Ana'],
                  ['🏷️', 'A peça sai do “à venda”'],
                  ['💰', <>Quando ela pagar → <b>Vender</b> aqui</>],
                  ['✖️', <>Desistiu → <b>Cancelar</b> (a peça volta)</>],
                ]}>
                  Reservar guarda a peça para uma cliente: ela continua no estoque, mas ninguém mais consegue vender. Se a cliente desistir, toque em Cancelar.
                </InfoTip>
              </h3>
              <div className="space-y-2">
                {reservations.map((r) => (
                  <Card key={r.id} className="p-3 flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-slate-800 break-words">{r.quantity}× {names.get(r.variantId)}</div>
                      <div className="text-xs text-slate-500 break-words">{r.customer || 'Sem nome'}{r.notes ? ` · ${r.notes}` : ''} · desde {r.date.slice(8)}/{r.date.slice(5, 7)}</div>
                    </div>
                    {!locked && (
                      <>
                        <Button size="sm" variant="soft" onClick={async () => {
                          if (await confirm({ title: 'Cancelar reserva?', message: 'As peças voltam a ficar disponíveis.', confirm: 'Cancelar reserva', tone: 'danger' }))
                            run(() => cancelReservation(r.id, day?.id), 'Reserva cancelada');
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
        <div className="fixed left-0 right-0 bottom-[calc(72px+env(safe-area-inset-bottom))] z-30 px-4 pb-2 flex justify-center">
          <button onClick={() => setOverlay('checkout')}
            className="w-full max-w-lg h-14 rounded-2xl bg-emerald-600 text-white font-bold text-lg shadow-lg shadow-emerald-600/30 flex items-center justify-between px-5 animate-pop">
            <span>🛒 {cartCount} {cartCount === 1 ? 'peça' : 'peças'}{cartTotal > 0 && <span className="font-semibold text-emerald-100"> · {money(cartTotal, settings.currencySymbol)}</span>}</span>
            <span>Fechar venda ›</span>
          </button>
        </div>
      )}

      <ReserveSheet row={reserveRow} onClose={() => setReserveRow(null)} />
      <ConvertSheet reservation={convert} name={convert ? names.get(convert.variantId) : ''} onClose={() => setConvert(null)} />
      <SellConfigSheet open={config} onClose={() => setConfig(false)} />
      <PutForSaleSheet open={putSale} onClose={() => setPutSale(false)} />
    </div>
  );
}

/** Passo a passo visual (3 etapas com número e ícone) + ⓘ. */
function StepsBar({ steps, color, tip }: { steps: [string, string][]; color: string; tip?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-2xl pl-2 pr-2.5 py-2">
      <div className="flex-1 flex items-center justify-between gap-1">
        {steps.map(([icon, label], i) => (
          <Fragment key={label}>
            {i > 0 && <span className="text-slate-300 text-sm">›</span>}
            <div className="flex-1 flex flex-col items-center text-center min-w-0">
              <span className="relative text-xl leading-none">
                {icon}
                <span className={`absolute -top-1.5 -right-2.5 w-4 h-4 rounded-full ${color} text-white text-[10px] font-bold flex items-center justify-center`}>{i + 1}</span>
              </span>
              <span className="text-[12px] font-semibold text-slate-700 mt-1 leading-tight">{label}</span>
            </div>
          </Fragment>
        ))}
      </div>
      {tip}
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
  const who = customer.trim();
  return (
    <Sheet open onClose={onClose} title="📌 Guardar para uma cliente"
      footer={<Button className="w-full !bg-purple-600" size="lg" disabled={busy} onClick={() => wrap(async () => {
        const r = await run(() => createReservation({ dailyRecordId: row.item.dailyRecordId, variantId: row.variant.id, quantity: qty, customer, notes }),
          `Reservado${who ? ' para ' + who : ''}`);
        if (r) { setQty(1); setCustomer(''); setNotes(''); onClose(); }
      })}>📌 Reservar {qty} {qty === 1 ? 'peça' : 'peças'}{who ? ` para ${who}` : ''}</Button>}>
      <div className="flex items-center gap-3 mb-3">
        <Swatch color={row.variant.color} size={30} />
        <div className="flex-1">
          <div className="font-bold text-slate-800 text-[17px]">{row.group.name} · {row.variant.name}</div>
          <div className="text-sm text-slate-500">{row.available} à venda agora</div>
        </div>
      </div>
      <div className="flex items-start gap-2 rounded-xl bg-purple-50 border border-purple-200 px-3 py-2.5 mb-4 text-[14px] text-purple-900">
        <span className="flex-1">A peça fica <b>guardada</b>: continua no estoque, mas ninguém mais consegue vender. Quando a cliente pagar, toque em <b>Vender</b> na lista de reservas.</span>
        <InfoTip title="Reservar" example={[
          ['👩', 'Ana vai buscar 1 Azul Verde Piscina no sábado'],
          ['📌', 'Reserve 1 para Ana · obs.: “busca sábado”'],
          ['🏷️', 'À venda cai de 6 para 5'],
          ['💰', <>No sábado: Reservas ativas › <b>Vender</b></>],
          ['✖️', <>Desistiu? <b>Cancelar</b> e a peça volta</>],
        ]}>
          Use quando alguém pediu para separar uma peça. O estoque não diminui até a venda acontecer.
        </InfoTip>
      </div>
      <Field label="Nome da cliente"><Input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Ex.: Ana" autoFocus /></Field>
      <div className="flex items-center justify-between mb-1">
        <span className="font-semibold text-slate-700">Quantas peças?</span>
        <Stepper value={qty} onChange={setQty} min={1} max={row.available} />
      </div>
      <p className="text-xs text-slate-500 mb-3 text-right">Fica à venda: <b>{row.available - qty}</b></p>
      <Field label="Observação (opcional)"><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex.: busca sábado, já pagou metade" /></Field>
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

/** Último preço vendido em cada grupo (para já vir preenchido na próxima venda). */
function useLastPriceByGroup() {
  return useLiveQuery(async () => {
    const [sales, variants] = await Promise.all([db.sales.orderBy('createdAt').reverse().limit(300).toArray(), db.variants.toArray()]);
    const group = new Map(variants.map((v) => [v.id, v.groupId]));
    const out = new Map<string, number>();
    for (const s of sales) {
      const g = group.get(s.variantId);
      if (g && s.status === 'ok' && s.unitPriceInCents && !out.has(g)) out.set(g, s.unitPriceInCents);
    }
    return out;
  }, []);
}

function useRecentPrices() {
  return useLiveQuery(async () => {
    const sales = await db.sales.orderBy('createdAt').reverse().limit(300).toArray();
    const freq = new Map<number, number>();
    for (const s of sales) if (s.unitPriceInCents) freq.set(s.unitPriceInCents, (freq.get(s.unitPriceInCents) ?? 0) + 1);
    return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([p]) => p).sort((a, b) => a - b);
  }, []) ?? [];
}

function PriceInput({ cents, onChange, quick, autoFocus }: { cents: number | null; onChange: (c: number | null) => void; quick: number[]; autoFocus?: boolean }) {
  const [text, setText] = useState(cents === null ? '' : money(cents));
  const [last, setLast] = useState(cents);
  if (cents !== last) { setLast(cents); setText(cents === null ? '' : money(cents)); }
  return (
    <div>
      <input inputMode="decimal" placeholder="Preço" value={text} autoFocus={autoFocus}
        onChange={(e) => { setText(e.target.value); const c = toCents(e.target.value); setLast(c); onChange(c); }}
        className="w-24 h-11 px-2 rounded-lg border border-slate-300 text-right font-bold text-lg tabular-nums outline-none focus:border-blue-500" />
      {quick.length > 0 && (
        <div className="flex gap-1 mt-1 justify-end flex-wrap">
          {quick.map((p) => (
            <button key={p} onClick={() => onChange(p)}
              className={`px-2.5 h-9 rounded-lg text-sm font-semibold ${cents === p ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}>{money(p)}</button>
          ))}
        </div>
      )}
    </div>
  );
}

export function CheckoutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { day, cart, setCart, resetCart, cartId, settings } = useApp();
  const { run, toast, confirm: ask } = useUi();
  const [busy, wrap] = useBusy();
  const [payment, setPayment] = useState<PaymentMethod>(settings.defaultPayment);
  // pagamento dividido: a primeira forma recebe o valor digitado, a segunda o que falta
  const [split, setSplit] = useState<{ method: PaymentMethod; text: string; other: PaymentMethod } | null>(null);
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
  const splitFirst = split ? toCents(split.text) : null;
  const splitRest = split && splitFirst !== null ? total - splitFirst : null;
  const splitError = !split ? '' : split.method === split.other ? 'Escolha duas formas diferentes.'
    : splitFirst === null ? 'Digite quanto foi na primeira forma.' : splitRest! <= 0 ? `O valor precisa ser menor que o total (${money(total)}).` : '';
  const payments = split && !splitError ? [{ method: split.method, amountInCents: splitFirst! }, { method: split.other, amountInCents: splitRest! }] : null;
  const missingPrice = cart.some((l) => l.unitPriceInCents === null);
  const firstPrice = cart.find((l) => l.unitPriceInCents !== null)?.unitPriceInCents ?? null;
  const update = (i: number, patch: Partial<(typeof cart)[number]>) =>
    setCart(cart.map((l, j) => (j === i ? { ...l, ...patch } : l)).filter((l) => l.quantity > 0));

  const confirm = () => wrap(async () => {
    if (missingPrice && !(await ask({ title: 'Vender sem preço?', tone: 'warning', confirm: 'Vender sem preço',
      message: 'As peças sem preço saem do estoque, mas não entram no caixa nem no relatório de vendas.' }))) return;
    const o = await run(() => createOrder({ orderId: cartId, dailyRecordId: day.id, lines: cart, paymentMethod: payment, payments: payments ?? undefined, customer }));
    if (o) {
      toast(`Venda: ${orderLine(cart, o.totalInCents, o.paymentMethod, o.payments)}`);
      setSplit(null);
      resetCart(); setCustomer(''); onClose();
    }
  });

  return (
    <Sheet open onClose={onClose} title="Fechar venda" tall
      footer={
        <Button variant="success" size="lg" className="w-full text-lg" disabled={!cart.length || busy || !!splitError} onClick={confirm}>
          ✔ Confirmar · {pieces} {pieces === 1 ? 'peça' : 'peças'} · {money(total, settings.currencySymbol)}
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
                  <div className="font-bold text-slate-800 break-words">{r?.group.name} · {r?.variant.name}</div>
                  <div className="text-xs text-slate-500">disponível {r?.available ?? '–'}</div>
                  <div className="mt-2"><Stepper value={l.quantity} onChange={(v) => update(i, { quantity: v })} min={0} max={r?.available} /></div>
                </div>
                <PriceInput cents={l.unitPriceInCents} onChange={(c) => update(i, { unitPriceInCents: c })} quick={quick}
                  autoFocus={l.unitPriceInCents === null && cart.findIndex((x) => x.unitPriceInCents === null) === i} />
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
      {!split ? (
        <>
          <PaymentPicker value={payment} onChange={setPayment} />
          {total > 0 && settings.paymentMethods.length > 1 && (
            <button className="text-sm text-blue-600 font-semibold mt-2"
              onClick={() => setSplit({ method: payment, text: '', other: settings.paymentMethods.find((m) => m !== payment)! })}>
              ➗ Dividir pagamento (ex.: parte Pix, parte dinheiro)
            </button>
          )}
        </>
      ) : (
        <Card className="p-3">
          <div className="flex items-center gap-2">
            <select value={split.method} onChange={(e) => setSplit({ ...split, method: e.target.value as PaymentMethod })}
              className="h-11 rounded-xl border border-slate-300 bg-white px-2 font-semibold">
              {settings.paymentMethods.map((m) => <option key={m} value={m}>{PAYMENT_EMOJI[m]} {PAYMENT_LABEL[m]}</option>)}
            </select>
            <Input inputMode="decimal" value={split.text} onChange={(e) => setSplit({ ...split, text: e.target.value })} placeholder="quanto?" autoFocus />
          </div>
          <div className="flex items-center gap-2 mt-2">
            <select value={split.other} onChange={(e) => setSplit({ ...split, other: e.target.value as PaymentMethod })}
              className="h-11 rounded-xl border border-slate-300 bg-white px-2 font-semibold">
              {settings.paymentMethods.map((m) => <option key={m} value={m}>{PAYMENT_EMOJI[m]} {PAYMENT_LABEL[m]}</option>)}
            </select>
            <span className="flex-1 text-right text-lg font-bold tabular-nums">{splitRest === null ? '—' : money(splitRest)}</span>
          </div>
          {splitError && <p className="text-xs text-red-600 mt-1">{splitError}</p>}
          <button className="text-sm text-slate-500 font-semibold mt-2" onClick={() => setSplit(null)}>✕ Não dividir</button>
        </Card>
      )}
      <div className="mt-4"><Field label="Cliente (opcional)"><Input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Nome" /></Field></div>
      <Card className="p-4 text-center notebook !bg-sky-50">
        <div className="text-lg">{cart.length ? orderLine(cart, total, payment, payments ?? undefined) : '—'}</div>
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

/**
 * Estoque ⇄ Venda: lista só o que está guardado (para trazer para vender)
 * ou só o que está à venda (para voltar pro estoque). Grupo inteiro ou cor a cor.
 */
function PutForSaleSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { day, settings } = useApp();
  const { run } = useUi();
  const [tab, setTab] = useState<'trazer' | 'guardar'>('trazer');
  const rows = useLiveQuery(async () => {
    if (!open || !day) return null;
    return (await loadStockRows(day.id, day.date)).filter((r) => !r.variant.archivedAt && !r.group.archivedAt && r.group.active && r.variant.active);
  }, [open, day?.id]);
  if (!open) return null;
  const off = (rows ?? []).filter((r) => r.variant.forSale === false);
  const on = (rows ?? []).filter((r) => r.variant.forSale !== false);
  const byGroup = new Map<string, { group: StockRow['group']; rows: StockRow[] }>();
  for (const r of tab === 'trazer' ? off : on) {
    if (!byGroup.has(r.group.id)) byGroup.set(r.group.id, { group: r.group, rows: [] });
    byGroup.get(r.group.id)!.rows.push(r);
  }
  const groups = [...byGroup.values()];
  // trazer para vender também põe o grupo em ⭐ Para vender (aparece logo de cara)
  const ensureInSell = async (groupId: string) => {
    if (!settings.sellGroups.some((e) => e.groupId === groupId)) await setSetting('sellGroups', [...settings.sellGroups, { groupId, highlight: false }]);
  };
  const move = (groupId: string, ids: string[], label: string) => tab === 'trazer'
    ? run(async () => { await setForSale(ids, true); await ensureInSell(groupId); }, `🏷️ ${label} à venda`)
    : run(() => setForSale(ids, false), `📦 ${label} voltou pro estoque`);
  const pcs = (rs: StockRow[]) => rs.reduce((n, r) => n + r.item.currentQuantity, 0);
  const TABS = [['trazer', '🏷️ Trazer para vender', off.length], ['guardar', '📦 Voltar pro estoque', on.length]] as const;
  return (
    <Sheet open onClose={onClose} title="Estoque ⇄ Venda" tall>
      <div className="grid grid-cols-2 gap-1 p-1 rounded-2xl bg-slate-200/70 mb-3" role="tablist">
        {TABS.map(([k, l, n]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`min-h-12 rounded-xl px-2 text-[13px] font-bold leading-tight ${tab === k ? 'bg-white shadow text-slate-900' : 'text-slate-600'}`}>
            {l}<span className="block text-[11px] font-semibold text-slate-500">{n} {n === 1 ? 'cor' : 'cores'}</span>
          </button>
        ))}
      </div>
      <div className={`flex items-center gap-3 rounded-2xl border px-3 py-2.5 mb-3 ${tab === 'trazer' ? 'bg-blue-50 border-blue-200' : 'bg-amber-50 border-amber-200'}`}>
        <span className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 ${tab === 'trazer' ? 'bg-blue-100' : 'bg-amber-100'}`}>{tab === 'trazer' ? '🔒' : '🏷️'}</span>
        <span className="flex-1 min-w-0 leading-snug">
          <span className={`block text-[14px] font-bold ${tab === 'trazer' ? 'text-blue-900' : 'text-amber-900'}`}>
            {tab === 'trazer' ? 'Guardado no estoque' : 'Aparecendo no Vender'}
          </span>
          <span className="block text-[12px] text-slate-600">
            {tab === 'trazer' ? <>Toque em <b>🏷️ Vender</b> para trazer</> : <>Toque em <b>📦 Guardar</b> · as peças não somem</>}
          </span>
        </span>
        {tab === 'trazer' ? (
          <InfoTip title="Trazer para vender" example={[
            ['🔒', 'O Broche está no estoque, mas não aparece no Vender'],
            ['🏷️', <>Toque em <b>Vender</b> no Branco (ou <b>Vender todas</b>)</>],
            ['⭐', <>Pronto: o Broche Branco aparece em <b>Para vender</b></>],
            ['📦', 'A quantidade é a mesma do estoque: nada é criado ou apagado'],
          ]}>Aqui aparece só o que está guardado no estoque e ainda não está vendendo.</InfoTip>
        ) : (
          <InfoTip title="Voltar pro estoque" example={[
            ['🏷️', 'O Plomo Vermelho está aparecendo no Vender'],
            ['📦', <>Toque em <b>Guardar</b> no Vermelho (ou <b>Guardar todas</b>)</>],
            ['👀', 'Ele some do Vender, mas continua no Estoque com as mesmas peças'],
            ['↩️', <>Mudou de ideia? Aba <b>Trazer para vender</b> › <b>Vender</b></>],
          ]}>Aqui aparece só o que está à venda agora. Guardar tira do Vender sem mexer na quantidade.</InfoTip>
        )}
      </div>
      {rows && !groups.length && (
        <Empty icon={tab === 'trazer' ? '✅' : '📦'} title={tab === 'trazer' ? 'Tudo já está à venda' : 'Nada à venda'}>
          {tab === 'trazer' ? 'Não há peças guardadas no estoque.' : 'Use a outra aba para trazer peças.'}
        </Empty>
      )}
      <div className="space-y-3">
        {groups.map(({ group, rows: rs }) => (
          <Card key={group.id} className="overflow-hidden">
            <div className="flex items-center gap-2.5 px-3.5 py-3 border-b border-slate-100" style={{ background: group.color + '12' }}>
              <span className="text-2xl">{group.icon}</span>
              <span className="flex-1 min-w-0">
                <span className="block font-extrabold text-slate-800 break-words">{group.name}</span>
                <span className="block text-[12px] text-slate-500">{rs.length} {rs.length === 1 ? 'cor' : 'cores'} · {pcs(rs)} peças</span>
              </span>
              {rs.length > 1 && (
                <Button size="sm" variant={tab === 'trazer' ? 'primary' : 'outline'} onClick={() => move(group.id, rs.map((r) => r.variant.id), group.name)}>
                  {tab === 'trazer' ? '🏷️ Vender todas' : '📦 Guardar todas'}
                </Button>
              )}
            </div>
            <div className="divide-y divide-slate-100">
              {rs.map((r) => (
                <div key={r.variant.id} className="flex items-center gap-3 px-3.5 py-2">
                  <Swatch color={r.variant.color} size={22} />
                  <span className="flex-1 min-w-0">
                    <span className="block font-semibold text-slate-800 break-words">{r.variant.name}</span>
                    <span className="block text-[12px] text-slate-500">{r.item.currentQuantity} no estoque</span>
                  </span>
                  <button type="button" aria-label={`${tab === 'trazer' ? 'Vender' : 'Guardar'} ${r.variant.name}`}
                    onClick={() => move(group.id, [r.variant.id], r.variant.name)}
                    className={`min-h-10 px-3 rounded-xl text-[13px] font-bold shrink-0 ${tab === 'trazer' ? 'bg-blue-600 text-white active:bg-blue-700' : 'bg-slate-100 text-slate-700 border border-slate-200 active:bg-slate-200'}`}>
                    {tab === 'trazer' ? '🏷️ Vender' : '📦 Guardar'}
                  </button>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
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
  // uma lista só: primeiro os que aparecem (na ordem escolhida), depois os que não aparecem
  const shown = list.map((e, i) => ({ e, i, g: groups?.find((x) => x.id === e.groupId) }));
  const hidden = (groups ?? []).filter((g) => !list.some((e) => e.groupId === g.id));
  return (
    <Sheet open onClose={onClose} title="⭐ Grupos da aba “Para vender”" tall>
      <div className="flex items-start gap-2 rounded-xl bg-blue-50 border border-blue-200 px-3 py-2.5 mb-4 text-[14px] text-blue-900">
        <span className="flex-1">
          Escolha quais grupos <b>aparecem</b> em ⭐ Para vender (os que você mais vende).
          Esconder <b>não apaga nada</b>: o grupo continua em “Todos os grupos” e no Estoque.
        </span>
        <InfoTip title="Mostrar ou esconder grupos" example={[
          ['👀', <><b>Aparece:</b> Azul e Plomo ficam na aba ⭐ Para vender</>],
          ['🙈', <><b>Não aparece:</b> Camisa some só dessa aba</>],
          ['📦', 'As peças de Camisa continuam no Estoque e em “Todos os grupos”'],
          ['⭐', <><b>Destaque:</b> marca o grupo como prioridade</>],
          ['↕️', <><b>Subir/descer:</b> muda a ordem na tela</>],
        ]}>
          É só para deixar a tela de venda mais curta. Nenhuma quantidade ou venda muda.
        </InfoTip>
      </div>

      <div className="text-[13px] font-bold uppercase tracking-wide text-slate-500 mb-2 px-1">Aparecem ({shown.length})</div>
      <div className="space-y-2 mb-5">
        {shown.map(({ e, i, g }) => (
          <Card key={(e.groupId ?? e.pendingName)!} className="p-3">
            <div className="flex items-center gap-3">
              <span className="text-xl">{e.pendingName ? '👑' : g?.icon ?? '📦'}</span>
              <span className="flex-1 min-w-0">
                <span className="block font-bold text-slate-800 break-words">{e.pendingName ?? g?.name ?? '—'}</span>
                <span className="block text-xs text-emerald-700 font-semibold">{e.pendingName ? 'pendente de cadastro' : '👀 aparece'}</span>
              </span>
              <Toggle label="" checked onChange={() => save(list.filter((_, j) => j !== i))} />
            </div>
            <div className="grid grid-cols-3 gap-2 mt-2">
              <button onClick={() => save(list.map((x, j) => (j === i ? { ...x, highlight: !x.highlight } : x)))}
                className={`h-11 rounded-lg text-[13px] font-semibold ${e.highlight ? 'bg-orange-100 text-orange-800' : 'bg-slate-100 text-slate-500'}`}>
                {e.highlight ? '⭐ Destaque' : '☆ Destacar'}
              </button>
              <button disabled={i === 0} onClick={() => move(i, -1)} className="h-11 rounded-lg bg-slate-100 text-[13px] font-semibold text-slate-700 disabled:opacity-30">↑ Subir</button>
              <button disabled={i === list.length - 1} onClick={() => move(i, 1)} className="h-11 rounded-lg bg-slate-100 text-[13px] font-semibold text-slate-700 disabled:opacity-30">↓ Descer</button>
            </div>
          </Card>
        ))}
        {!shown.length && <p className="text-sm text-slate-500 px-1">Nenhum grupo aparece. Ligue abaixo os que você quer ver.</p>}
      </div>

      {hidden.length > 0 && (
        <>
          <div className="text-[13px] font-bold uppercase tracking-wide text-slate-500 mb-2 px-1">Não aparecem ({hidden.length})</div>
          <Card className="divide-y divide-slate-100">
            {hidden.map((g) => (
              <div key={g.id} className="flex items-center gap-3 px-3 py-1">
                <span className="text-xl">{g.icon}</span>
                <span className="flex-1 min-w-0">
                  <span className="block font-semibold text-slate-700 break-words">{g.name}</span>
                  <span className="block text-xs text-slate-400">🙈 escondido · toque para mostrar</span>
                </span>
                <Toggle label="" checked={false} onChange={async () => {
                  await save([...list, { groupId: g.id, highlight: false }]);
                  await setForSale((await db.variants.where('groupId').equals(g.id).toArray()).map((v) => v.id), true);
                }} />
              </div>
            ))}
          </Card>
        </>
      )}
    </Sheet>
  );
}
