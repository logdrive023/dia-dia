import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { money, PAYMENT_LABEL, PAYMENTS, todayStr } from '../lib/util';
import type { PaymentMethod } from '../db/types';
import type { CashSummary } from '../services/summary';
import { daySummary, idealOf } from '../services/summary';
import { openWhatsApp, whatsappReport } from '../services/report';
import { previousDay } from '../services/days';
import { useApp } from '../state';
import { DayNotices, DayBar, StartDayCard } from '../components/day';
import { Button, InfoTip, SectionTitle } from '../components/ui';

export default function Home() {
  const { day, date, setTab, setOverlay, settings } = useApp();
  const sym = settings.currencySymbol;
  const isToday = date === todayStr();
  const [groupFilter, setGroupFilterRaw] = useState<'todos' | 'venda' | 'guardado'>(() => {
    try { return (localStorage.getItem('homeGroupFilter') as 'todos' | 'venda' | 'guardado') || 'todos'; } catch { return 'todos'; }
  });
  const setGroupFilter = (f: 'todos' | 'venda' | 'guardado') => { setGroupFilterRaw(f); try { localStorage.setItem('homeGroupFilter', f); } catch { /* ok */ } };
  const data = useLiveQuery(async () => {
    const [groups, variants] = await Promise.all([db.groups.toArray(), db.variants.toArray()]);
    const activeGroups = groups.filter((g) => !g.archivedAt && g.active).sort((a, b) => a.displayOrder - b.displayOrder);
    const activeVariants = variants.filter((v) => !v.archivedAt && v.active && activeGroups.some((g) => g.id === v.groupId));
    const s = day ? await daySummary(day.id, day.date) : null;
    // sem registro na data: mostra o saldo do último dia anterior (ou a carga inicial)
    const refDayId = day?.id ?? (await previousDay(date))?.id;
    // total de peças por grupo (uma consulta para todos os cartões)
    const groupOf = new Map(variants.filter((v) => !v.archivedAt).map((v) => [v.id, v.groupId]));
    const totals = new Map<string, number>();
    const starts = new Map<string, number>();
    const counts = new Map<string, number>();
    const ideals = new Map<string, number>();
    for (const v of variants) if (!v.archivedAt) {
      counts.set(v.groupId, (counts.get(v.groupId) ?? 0) + 1);
      ideals.set(v.groupId, (ideals.get(v.groupId) ?? 0) + idealOf(v));
    }
    if (refDayId) {
      for (const i of await db.dailyStockItems.where('dailyRecordId').equals(refDayId).toArray()) {
        const g = groupOf.get(i.variantId);
        if (g) { totals.set(g, (totals.get(g) ?? 0) + i.currentQuantity); starts.set(g, (starts.get(g) ?? 0) + i.initialQuantity); }
      }
    } else for (const v of variants) if (!v.archivedAt) totals.set(v.groupId, (totals.get(v.groupId) ?? 0) + v.startQuantity);
    // à venda = tem pelo menos uma cor à venda; guardado = todas as cores fora da venda
    const forSale = new Map<string, boolean>();
    for (const v of variants) if (!v.archivedAt) forSale.set(v.groupId, (forSale.get(v.groupId) ?? false) || v.forSale !== false);
    return { activeGroups, activeVariants, s, totals, counts, ideals, starts, forSale, hasDay: !!day };
  }, [day?.id, day?.date, date]);

  const backupDays = settings.lastBackupAt ? Math.floor((Date.now() - Date.parse(settings.lastBackupAt)) / 86400000) : null;
  const needBackup = backupDays === null ? !!day : backupDays >= settings.backupReminderDays;

  return (
    <div>
      <DayBar />
      <DayNotices />
      {day === null && <StartDayCard />}

      {day && data?.s && (() => {
        const s = data.s;
        const c = s.cash;
        const out = s.restock.filter((r) => r.out).length;
        const when = isToday ? 'hoje' : 'neste dia';
        return (
          <>
            {day.status === 'open' && (
              <div className="grid grid-cols-2 gap-2.5">
                <Button size="lg" className="text-base" onClick={() => setTab('vender')}>🛍️ Nova venda</Button>
                <Button size="lg" variant="outline" className="text-base" onClick={() => setOverlay('fechar')}>🌙 Encerrar o dia</Button>
              </div>
            )}

            {/* exportar: um toque manda o relatório do dia para o WhatsApp */}
            <div className="mt-2.5 flex gap-2">
              <button onClick={() => openWhatsApp(whatsappReport(day.date, s, { symbol: sym, title: settings.reportTitle }))}
                className="flex-1 flex items-center gap-3 rounded-2xl bg-[#25D366] text-white px-4 py-3 text-left shadow-sm shadow-emerald-600/30 active:brightness-95">
                <span className="text-3xl">💬</span>
                <span className="min-w-0">
                  <span className="block font-bold text-[16px] leading-tight">Enviar relatório do dia no WhatsApp</span>
                  <span className="block text-[12px] text-white/90 leading-tight mt-0.5">Vendas por Pix/Dinheiro/Cartão · caixa · o que entrou · o que precisa repor</span>
                </span>
              </button>
              <button onClick={() => setOverlay('fechar')} className="w-16 rounded-2xl bg-white border border-slate-200 text-[11px] font-semibold text-slate-600 active:bg-slate-50">
                <span className="block text-xl">👀</span>Ver antes
              </button>
            </div>

            <SalesCard isToday={isToday} sym={sym} orders={s.salesCount} pieces={s.soldUnits} cash={c}
              methods={PAYMENTS.filter((p) => settings.paymentMethods.includes(p) || c.salesByMethod[p])} onCash={() => setTab('caixa')} />

            <div className="grid grid-cols-2 gap-2.5 mt-3">
              <Stat icon="📦" label="Peças no estoque" value={s.totalUnits} onClick={() => setTab('estoque')}
                tip={{ title: 'Peças no estoque', text: 'Quantas peças você tem agora, somando todos os grupos e cores.',
                  example: [['🌅', 'Começou o dia com 238'], ['🛍️', 'Vendeu 3'], ['📦', 'Aqui mostra 235']] }} />
              <Stat icon="🔁" label="Para repor" value={s.restockUnits} tone={s.restockUnits ? 'orange' : undefined} onClick={() => setTab('estoque')}
                tip={{ title: 'Para repor', text: 'Peças que faltam para voltar ao estoque ideal. O ideal é a quantidade que você cadastrou (dá para mudar em Menu › Produtos).',
                  example: [['📝', 'Cadastrou 15 Plomo Vermelho'], ['🛍️', 'Vendeu 1 → “repor 1”'], ['📥', 'Entrou 1 peça (+) → sai da lista']] }} />
              <Stat icon="🚫" label="Esgotados" value={out} tone={out ? 'red' : undefined} onClick={() => setTab('estoque')}
                tip={{ title: 'Esgotados', text: 'Cores/modelos sem nenhuma peça disponível para vender.',
                  example: [['🟡', 'Azul Amarelo está com 0'], ['🚫', 'Conta 1 esgotado'], ['📌', 'Peça reservada também não fica à venda']] }} />
              <Stat icon="📥" label={`Entrou ${when}`} value={s.enteredUnits} tone={s.enteredUnits ? 'green' : undefined} onClick={() => setTab('estoque')}
                tip={{ title: `Entrou ${when}`, text: 'Peças novas que você colocou no estoque (botão + na aba Estoque). Vendas canceladas não contam aqui.',
                  example: [['📦', 'Chegaram 5 Plomo Vermelho'], ['➕', 'Você tocou 5× no + (aba Estoque)'], ['📥', 'Aqui mostra 5']] }} />
            </div>
            <div className="mt-2.5 flex items-center gap-3 bg-white rounded-xl border border-slate-200 pl-3 pr-1.5 py-1.5">
              <span className="text-xl">🗂️</span>
              <span className="flex-1 text-[14px] text-slate-700 leading-tight">
                <b>{data.activeGroups.length}</b> grupos · <b>{data.activeVariants.length}</b> cores/modelos
              </span>
              <button onClick={() => setOverlay('cadastro')} className="h-11 px-3 rounded-lg bg-blue-50 text-blue-700 text-[14px] font-semibold active:bg-blue-100">✏️ Editar produtos</button>
            </div>
          </>
        );
      })()}

      <IosInstallTip />
      {needBackup && day !== undefined && (
        <div className="mt-3 rounded-2xl border-2 border-orange-300 bg-orange-50 p-3.5">
          <div className="flex items-start gap-3">
            <span className="text-3xl leading-none">⚠️</span>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-bold text-orange-900 text-[16px]">
                  {backupDays === null ? 'Você ainda não fez backup' : `Último backup há ${backupDays} dias`}
                </span>
                <InfoTip title="Por que fazer backup?" example={[
                  ['📱', 'O celular caiu na água, foi roubado ou trocou de aparelho'],
                  ['🧹', 'Alguém limpou os dados do navegador'],
                  ['😱', 'Sem backup: estoque, vendas e caixa se perdem'],
                  ['💾', 'Com backup: abre o app no outro celular e recebe tudo'],
                  ['⏱️', 'Leva 10 segundos: Fazer backup › mandar para você no WhatsApp'],
                ]}>
                  Os dados ficam só dentro deste celular, não vão para a internet. O backup é uma cópia guardada fora dele (WhatsApp, e-mail, Drive).
                </InfoTip>
              </div>
              <p className="text-[14px] text-orange-900/90 mt-1 leading-snug">
                Tudo fica <b>só neste celular</b>. Se ele quebrar ou for perdido, os dados somem. Faça uma cópia e mande para você no WhatsApp.
              </p>
            </div>
          </div>
          <Button className="w-full mt-3 !bg-orange-500" onClick={() => setOverlay('backup')}>💾 Fazer backup agora</Button>
        </div>
      )}

      {data && (
        <>
          <SectionTitle right={<button className="text-sm text-blue-600 font-semibold" onClick={() => setOverlay('cadastro')}>Editar</button>}>
            <span className="inline-flex items-center gap-1.5">Grupos
              <InfoTip title="Como ler os grupos" example={[
                ['🎀', 'Plomo 47 · repor 1'],
                ['📦', 'Você tem 47 peças de Plomo'],
                ['🔁', 'Falta 1 para voltar ao que cadastrou (vendeu 1)'],
              ]}>
                O número grande é quanto você tem agora. “Repor” é quantas peças faltam para voltar ao estoque ideal (a quantidade cadastrada).
              </InfoTip>
            </span>
          </SectionTitle>
          {(() => {
            const nVenda = data.activeGroups.filter((g) => data.forSale.get(g.id)).length;
            const opts: ['todos' | 'venda' | 'guardado', string, number][] = [
              ['todos', 'Todos', data.activeGroups.length], ['venda', '🏷️ À venda', nVenda], ['guardado', '🔒 Guardados', data.activeGroups.length - nVenda],
            ];
            return (
              <div className="grid grid-cols-3 gap-1 bg-slate-200/70 rounded-xl p-1 mb-2.5">
                {opts.map(([k, l, n]) => (
                  <button key={k} onClick={() => setGroupFilter(k)} aria-pressed={groupFilter === k}
                    className={`h-11 rounded-lg text-[13px] font-semibold flex items-center justify-center gap-1 ${groupFilter === k ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}>
                    {l} <span className={`rounded-full px-1.5 text-[11px] ${groupFilter === k ? 'bg-slate-800 text-white' : 'bg-slate-300/70 text-slate-600'}`}>{n}</span>
                  </button>
                ))}
              </div>
            );
          })()}
          <div className="grid grid-cols-2 gap-2.5">
            {data.activeGroups.filter((g) => groupFilter === 'todos' || (groupFilter === 'venda') === (data.forSale.get(g.id) ?? false)).map((g) => (
              <GroupCard key={g.id} icon={g.icon} name={g.name} color={g.color} total={data.totals.get(g.id) ?? 0} start={data.hasDay ? data.starts.get(g.id) ?? 0 : undefined} count={data.counts.get(g.id) ?? 0} ideal={data.ideals.get(g.id) ?? 0}
                alerts={(data.s?.restock ?? []).filter((r) => r.group.id === g.id).reduce((n, r) => n + r.restock, 0)} forSale={data.forSale.get(g.id) ?? false} onClick={() => setTab('estoque')} />
            ))}
          </div>
        </>
      )}

    </div>
  );
}

function Stat({ icon, label, value, tone, onClick, tip }: {
  icon: string; label: string; value: number; tone?: 'orange' | 'red' | 'green'; onClick?: () => void;
  tip: { title: string; text: string; example: [string, string][] };
}) {
  const [open, setOpen] = useState(false);
  const c = tone === 'orange' ? 'text-orange-600' : tone === 'red' ? 'text-red-600' : tone === 'green' ? 'text-emerald-600' : 'text-slate-800';
  return (
    <>
      {/* um toque em qualquer parte do cartão explica o número; "Ver no Estoque" fica dentro da explicação */}
      <button type="button" onClick={() => setOpen(true)} aria-label={`${label}: ${value}. Toque para entender`}
        className="bg-white rounded-xl border border-slate-200 p-3 text-left active:bg-slate-50 active:scale-[0.98] transition">
        <div className="flex items-center justify-between">
          <span className="text-lg">{icon}</span>
          <span className="w-6 h-6 rounded-full bg-slate-200 text-slate-600 text-[12px] font-bold flex items-center justify-center">i</span>
        </div>
        <div className={`text-3xl font-extrabold tabular-nums mt-0.5 ${c}`}>{value}</div>
        <div className="text-[13px] font-semibold text-slate-600 leading-tight">{label}</div>
      </button>
      <InfoTip hideButton open={open} onOpenChange={setOpen} title={tip.title} example={tip.example}
        action={onClick ? { label: 'Ver no Estoque ›', onClick } : undefined}>{tip.text}</InfoTip>
    </>
  );
}

function GroupCard({ icon, name, color, total, start, count, ideal, alerts, forSale, onClick }:
  { icon?: string; name: string; color: string; total: number; start?: number; count: number; ideal: number; alerts: number; forSale: boolean; onClick: () => void }) {
  const pct = ideal > 0 ? Math.min(100, Math.round((total / ideal) * 100)) : 100;
  return (
    <button onClick={onClick} className="min-w-0 bg-white rounded-2xl border border-slate-200 p-3 text-left active:bg-slate-50 active:scale-[0.98] transition relative overflow-hidden">
      <span className="absolute left-0 top-0 bottom-0 w-1.5" style={{ background: color }} />
      <div className="flex items-center gap-2 pl-1">
        <span className="text-xl">{icon || '📦'}</span>
        <span className="font-bold text-slate-800 break-words flex-1 min-w-0">{name}</span>
        <span className="shrink-0 text-slate-300">›</span>
      </div>
      <div className="pl-1 mt-1">
        {forSale
          ? <span className="rounded-full bg-blue-50 text-blue-700 px-2 py-0.5 text-[10px] font-bold">🏷️ à venda</span>
          : <span className="rounded-full bg-slate-800 text-white px-2 py-0.5 text-[10px] font-bold">🔒 guardado</span>}
      </div>
      <div className="pl-1 mt-2 flex items-end justify-between gap-1">
        <span className="flex items-baseline gap-1">
          <span className="text-[28px] font-extrabold tabular-nums leading-none">{total}</span>
          <span className="text-[12px] text-slate-500 font-semibold">{total === 1 ? 'peça' : 'peças'}</span>
        </span>
        {start !== undefined && start !== total && (
          <span className={`rounded-lg px-1.5 py-0.5 text-[11px] font-extrabold tabular-nums leading-tight text-center ${total < start ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
            {total < start ? '▼ −' : '▲ +'}{Math.abs(total - start)}<span className="block text-[9px] font-semibold opacity-80">hoje</span>
          </span>
        )}
      </div>
      {/* barra: quanto tem do estoque ideal */}
      <div className="pl-1 mt-2">
        <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
          <div className={`h-full rounded-full ${alerts ? 'bg-orange-400' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
      {start !== undefined && (
        <div className="pl-1 mt-1.5 flex justify-between text-[11px] text-slate-500 tabular-nums">
          <span>🌅 começou <b className="text-slate-700">{start}</b></span>
          <span>ideal <b className="text-slate-700">{ideal}</b></span>
        </div>
      )}
      <div className="pl-1 mt-2 flex flex-wrap gap-1">
        <span className="rounded-full bg-slate-100 text-slate-600 px-2 py-0.5 text-[11px] font-semibold">🎨 {count} {count === 1 ? 'cor' : 'cores'}</span>
        {alerts
          ? <span className="rounded-full bg-orange-100 text-orange-700 px-2 py-0.5 text-[11px] font-bold">🔁 repor {alerts}</span>
          : <span className="rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5 text-[11px] font-semibold">✓ completo</span>}
      </div>
    </button>
  );
}

/** Vendas do dia: total grande, de onde veio o dinheiro (barra + formas) e atalho para o caixa. */
function SalesCard({ isToday, sym, orders, pieces, cash, methods, onCash }: {
  isToday: boolean; sym: string; orders: number; pieces: number; cash: CashSummary; methods: PaymentMethod[]; onCash: () => void;
}) {
  const total = cash.salesTotal;
  const COLOR: Record<PaymentMethod, string> = { dinheiro: 'bg-emerald-300', pix: 'bg-amber-300', cartao: 'bg-sky-300', debito: 'bg-violet-300', outro: 'bg-white/60' };
  return (
    <div className="mt-3 rounded-2xl overflow-hidden shadow-sm bg-gradient-to-br from-blue-600 to-indigo-700 text-white">
      <div className="p-4 pb-3">
        <div className="flex items-center gap-1.5 text-blue-100 text-sm font-semibold">
          {isToday ? 'Vendido hoje' : 'Vendido no dia'}
          <InfoTip title="Vendido" example={[
            ['🛍️', '2 vendas: uma de 70 em dinheiro e outra de 140 no Pix'],
            ['💰', 'Vendido: 210'],
            ['📊', 'A barra mostra a parte de cada forma: 1/3 dinheiro, 2/3 Pix'],
          ]}>Soma das vendas do dia. Vendas canceladas não contam.</InfoTip>
        </div>
        <div className="text-[40px] leading-none font-extrabold tabular-nums mt-1">{money(total, sym)}</div>
        <div className="text-blue-100 text-[13px] mt-1">
          {orders} {orders === 1 ? 'venda' : 'vendas'} · {pieces} {pieces === 1 ? 'peça' : 'peças'}
          {orders > 0 && total > 0 && <> · média {money(Math.round(total / orders))}</>}
        </div>
        {/* barra de proporção por forma de pagamento */}
        <div className="flex h-2 rounded-full overflow-hidden bg-white/15 mt-3">
          {total > 0 && methods.map((m) => cash.salesByMethod[m] > 0 && (
            <div key={m} className={COLOR[m]} style={{ width: `${(cash.salesByMethod[m] / total) * 100}%` }} />
          ))}
        </div>
        <div className="grid gap-1.5 mt-2.5" style={{ gridTemplateColumns: `repeat(${methods.length}, minmax(0,1fr))` }}>
          {methods.map((m) => (
            <div key={m} className="rounded-xl bg-white/10 px-2 py-1.5">
              <div className="flex items-center gap-1 text-[11px] text-blue-100">
                <span className={`w-2 h-2 rounded-full ${COLOR[m]}`} />{PAYMENT_LABEL[m]}
              </div>
              <div className="font-bold tabular-nums text-[15px] leading-tight">{money(cash.salesByMethod[m])}</div>
              <div className="text-[10px] text-blue-200 tabular-nums">{total > 0 ? Math.round((cash.salesByMethod[m] / total) * 100) : 0}%</div>
            </div>
          ))}
        </div>
      </div>
      <div className="px-3 pb-3">
        <button onClick={onCash} className="w-full flex items-center gap-3 px-3.5 py-3 rounded-xl bg-white text-slate-800 shadow-sm active:bg-slate-50 text-left">
          <span className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center text-xl shrink-0">🧮</span>
          <span className="flex-1 min-w-0">
            <span className="block text-[14px] font-bold leading-tight">Saldo do caixa</span>
            <span className="block text-[12px] text-slate-500 leading-snug mt-0.5">📅 ontem <b className="text-slate-700 tabular-nums">{money(cash.opening)}</b></span>
            <span className="block text-[12px] text-slate-500 leading-snug">💵 na mão <b className="text-slate-700 tabular-nums">{money(cash.cashOnHand)}</b></span>
          </span>
          <span className="shrink-0 text-[22px] font-extrabold tabular-nums text-emerald-700">{money(cash.accumulated, sym)}</span>
          <span className="shrink-0 text-slate-300 text-xl">›</span>
        </button>
      </div>
    </div>
  );
}

/** iPhone: o Safari pode apagar os dados de sites não instalados. Pede para instalar na tela de início. */
function IosInstallTip() {
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone;
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem('iosTipHidden') === '1'; } catch { return false; } });
  if (!isIos || standalone || hidden) return null;
  return (
    <div className="mt-3 flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2.5 text-sm text-blue-900">
      <span className="text-2xl">📲</span>
      <span className="flex-1">
        <b>Instale o app para não perder os dados.</b> No Safari, toque em <b>Compartilhar</b> ⬆️ e depois em <b>Adicionar à Tela de Início</b>.
      </span>
      <button className="text-blue-700 font-bold px-1" aria-label="Fechar aviso"
        onClick={() => { setHidden(true); try { localStorage.setItem('iosTipHidden', '1'); } catch { /* ok */ } }}>✕</button>
    </div>
  );
}
