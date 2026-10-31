import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { money, PAYMENT_EMOJI, PAYMENT_LABEL, PAYMENTS } from '../lib/util';
import { daySummary } from '../services/summary';
import { openWhatsApp, whatsappReport } from '../services/report';
import { previousDay } from '../services/days';
import { useApp } from '../state';
import { DayNotices, DayBar, StartDayCard } from '../components/day';
import { Button, Card, SectionTitle } from '../components/ui';

export default function Home() {
  const { day, date, setTab, setOverlay, settings } = useApp();
  const sym = settings.currencySymbol;
  const data = useLiveQuery(async () => {
    const [groups, variants] = await Promise.all([db.groups.toArray(), db.variants.toArray()]);
    const activeGroups = groups.filter((g) => !g.archivedAt && g.active).sort((a, b) => a.displayOrder - b.displayOrder);
    const activeVariants = variants.filter((v) => !v.archivedAt && v.active && activeGroups.some((g) => g.id === v.groupId));
    const s = day ? await daySummary(day.id, day.date) : null;
    // sem registro na data: mostra o saldo do último dia anterior (ou a carga inicial)
    const refDayId = day?.id ?? (await previousDay(date))?.id;
    return { activeGroups, activeVariants, s, refDayId };
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
        const low = s.restock.filter((r) => r.low).length;
        const out = s.restock.filter((r) => r.out).length;
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

            <Card className="mt-3 p-4 bg-gradient-to-br from-blue-600 to-blue-700 text-white border-0">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-blue-100 text-sm">Vendido hoje</div>
                  <div className="text-3xl font-extrabold tabular-nums">{sym && <span className="text-xl mr-1">{sym}</span>}{money(c.salesTotal)}</div>
                  <div className="text-blue-100 text-sm">{s.orders.length} {s.orders.length === 1 ? 'venda' : 'vendas'} · {s.soldUnits} {s.soldUnits === 1 ? 'peça' : 'peças'}</div>
                </div>
                <button onClick={() => setTab('caixa')} className="text-right">
                  <div className="text-blue-100 text-sm">Saldo do caixa</div>
                  <div className="text-xl font-bold tabular-nums">{money(c.accumulated)}</div>
                  <div className="text-blue-100 text-xs">ontem {money(c.opening)} ›</div>
                </button>
              </div>
              <div className="grid gap-1.5 mt-3" style={{ gridTemplateColumns: `repeat(${settings.paymentMethods.length}, minmax(0,1fr))` }}>
                {PAYMENTS.filter((p) => settings.paymentMethods.includes(p)).map((p) => (
                  <div key={p} className="bg-white/15 rounded-lg px-2 py-1.5 text-center">
                    <div className="text-[11px] text-blue-100">{PAYMENT_EMOJI[p]} {PAYMENT_LABEL[p]}</div>
                    <div className="font-bold tabular-nums text-sm">{money(c.salesByMethod[p])}</div>
                  </div>
                ))}
              </div>
            </Card>

            <div className="grid grid-cols-3 gap-2.5 mt-3">
              <Stat label="Peças em estoque" value={s.totalUnits} onClick={() => setTab('estoque')} />
              <Stat label="Grupos" value={data.activeGroups.length} onClick={() => setOverlay('cadastro')} />
              <Stat label="Variações" value={data.activeVariants.length} onClick={() => setOverlay('cadastro')} />
              <Stat label="Estoque baixo" value={low} tone={low ? 'orange' : undefined} onClick={() => setTab('estoque')} />
              <Stat label="Esgotados" value={out} tone={out ? 'red' : undefined} onClick={() => setTab('estoque')} />
              <Stat label="Entrou hoje" value={s.enteredUnits} tone={s.enteredUnits ? 'green' : undefined} onClick={() => setTab('estoque')} />
            </div>
          </>
        );
      })()}

      {needBackup && day !== undefined && (
        <button onClick={() => setOverlay('backup')}
          className="w-full mt-3 flex items-center gap-3 bg-orange-50 border border-orange-200 rounded-xl px-3 py-2.5 text-left">
          <span className="text-2xl">💾</span>
          <span className="text-sm text-orange-900 flex-1">
            {backupDays === null ? 'Você ainda não fez backup.' : `Último backup há ${backupDays} dias.`} Os dados ficam só neste celular — faça um backup.
          </span>
          <span className="text-orange-700">›</span>
        </button>
      )}

      {data && (
        <>
          <SectionTitle right={<button className="text-sm text-blue-600 font-semibold" onClick={() => setOverlay('cadastro')}>Editar</button>}>
            Grupos
          </SectionTitle>
          <div className="grid grid-cols-2 gap-2.5">
            {data.activeGroups.map((g) => {
              const rows = data.s ? data.s.restock : [];
              const total = data.refDayId
                ? undefined
                : data.activeVariants.filter((v) => v.groupId === g.id).reduce((s, v) => s + v.startQuantity, 0);
              return <GroupCard key={g.id} id={g.id} icon={g.icon} name={g.name} color={g.color} dayId={data.refDayId}
                fallbackTotal={total} alerts={rows.filter((r) => r.group.id === g.id).length} onClick={() => setTab('estoque')} />;
            })}
          </div>
        </>
      )}

    </div>
  );
}

function Stat({ label, value, tone, onClick }: { label: string; value: number; tone?: 'orange' | 'red' | 'green'; onClick?: () => void }) {
  const c = tone === 'orange' ? 'text-orange-600' : tone === 'red' ? 'text-red-600' : tone === 'green' ? 'text-emerald-600' : 'text-slate-800';
  return (
    <button onClick={onClick} className="bg-white rounded-xl border border-slate-200 p-2.5 text-left active:bg-slate-50">
      <div className={`text-2xl font-extrabold tabular-nums ${c}`}>{value}</div>
      <div className="text-[11px] text-slate-500 leading-tight">{label}</div>
    </button>
  );
}

function GroupCard({ id, icon, name, color, dayId, fallbackTotal, alerts, onClick }:
  { id: string; icon?: string; name: string; color: string; dayId?: string; fallbackTotal?: number; alerts: number; onClick: () => void }) {
  const info = useLiveQuery(async () => {
    const vs = (await db.variants.where('groupId').equals(id).toArray()).filter((v) => !v.archivedAt);
    if (!dayId) return { total: fallbackTotal ?? 0, count: vs.length };
    const items = await db.dailyStockItems.where('dailyRecordId').equals(dayId).toArray();
    const ids = new Set(vs.map((v) => v.id));
    return { total: items.filter((i) => ids.has(i.variantId)).reduce((s, i) => s + i.currentQuantity, 0), count: vs.length };
  }, [id, dayId, fallbackTotal]);
  return (
    <button onClick={onClick} className="bg-white rounded-xl border border-slate-200 p-3 text-left active:bg-slate-50 relative overflow-hidden">
      <span className="absolute left-0 top-0 bottom-0 w-1.5" style={{ background: color }} />
      <div className="flex items-center gap-2">
        <span className="text-xl">{icon || '📦'}</span>
        <span className="font-bold text-slate-800 truncate flex-1">{name}</span>
      </div>
      <div className="flex items-end justify-between mt-1">
        <span className="text-2xl font-extrabold tabular-nums">{info?.total ?? '–'}</span>
        <span className="text-[11px] text-slate-500 text-right">{info?.count ?? 0} variações{alerts ? <><br /><span className="text-orange-600 font-semibold">{alerts} p/ repor</span></> : null}</span>
      </div>
    </button>
  );
}
