import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { fmtDate, money, todayStr } from '../lib/util';
import { cashChain, compareDays, effectiveMovements } from '../services/summary';
import { useApp } from '../state';
import { MOVE_LABEL } from './Stock';
import { Badge, Button, Card, Empty, Sheet } from '../components/ui';
import type { MovementType, PaymentMethod } from '../db/types';

const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

const WEEK_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const METHOD_COLOR: Record<PaymentMethod, string> = { dinheiro: 'bg-emerald-400', pix: 'bg-amber-400', cartao: 'bg-sky-400', debito: 'bg-violet-400', outro: 'bg-slate-400' };

export default function History() {
  const { setDate, setTab, setOverlay } = useApp();
  const [month, setMonth] = useState(() => todayStr().slice(0, 7));
  // só o mês exibido (rápido mesmo com anos de uso); o caixa encadeado vai até o fim do mês
  const days = useLiveQuery(async () => {
    const ds = (await db.dailyRecords.where('date').between(`${month}-01`, `${month}-31`, true, true).toArray()).reverse();
    const chain = await cashChain(`${month}-31`);
    return Promise.all(ds.map(async (d) => {
      const [items, sales, moves, orders] = await Promise.all([
        db.dailyStockItems.where('dailyRecordId').equals(d.id).toArray(),
        db.sales.where('dailyRecordId').equals(d.id).toArray(),
        db.stockMovements.where('dailyRecordId').equals(d.id).toArray(),
        db.orders.where('dailyRecordId').equals(d.id).toArray(),
      ]);
      const eff = effectiveMovements(moves);
      return {
        d, units: items.reduce((s, i) => s + i.currentQuantity, 0),
        sold: sales.filter((s) => s.status === 'ok').reduce((s, x) => s + x.quantity, 0) + chain.get(d.id)!.notebookUnits,
        orders: orders.filter((o) => o.status === 'ok').length + chain.get(d.id)!.notebookCount,
        entered: eff.filter((m) => m.type === 'entrada').reduce((s, m) => s + m.quantity, 0),
        out: eff.filter((m) => m.type === 'saida' || m.type === 'perda').reduce((s, m) => s - m.quantity, 0),
        cash: chain.get(d.id)!,
      };
    }));
  }, [month]);
  const byDate = new Map((days ?? []).map((x) => [x.d.date, x]));
  const open = (date: string) => { setDate(date); setTab('inicio'); };

  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const cells: (string | null)[] = Array(first.getDay()).fill(null);
  for (let d = 1; d <= new Date(y, m, 0).getDate(); d++) cells.push(`${month}-${String(d).padStart(2, '0')}`);
  const shiftMonth = (n: number) => { const d = new Date(y, m - 1 + n, 1); setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); };
  const today = todayStr();

  // resumo do mês
  const list = days ?? [];
  const monthSales = list.reduce((s, x) => s + x.cash.salesTotal, 0);
  const monthPieces = list.reduce((s, x) => s + x.sold, 0);
  const daysWithSales = list.filter((x) => x.cash.salesTotal > 0).length;
  const best = list.reduce<(typeof list)[number] | null>((b, x) => (!b || x.cash.salesTotal > b.cash.salesTotal ? x : b), null);
  const maxSale = Math.max(1, ...list.map((x) => x.cash.salesTotal));

  return (
    <div>
      {/* mês + resumo */}
      <Card className="p-3.5">
        <div className="flex items-center justify-between">
          <button className="w-11 h-11 rounded-xl bg-slate-100 text-lg active:bg-slate-200" onClick={() => shiftMonth(-1)} aria-label="Mês anterior">‹</button>
          <div className="text-center">
            <div className="text-[17px] font-extrabold text-slate-800">{MONTHS[m - 1]} {y}</div>
            <div className="text-[12px] text-slate-500">{list.length} {list.length === 1 ? 'dia registrado' : 'dias registrados'}</div>
          </div>
          <button className="w-11 h-11 rounded-xl bg-slate-100 text-lg active:bg-slate-200" onClick={() => shiftMonth(1)} aria-label="Próximo mês">›</button>
        </div>
        <div className="grid grid-cols-2 gap-2 mt-3">
          <MonthTile icon="💰" label="Vendido no mês" value={money(monthSales)} tone="text-emerald-700" />
          <MonthTile icon="🛍️" label="Peças vendidas" value={String(monthPieces)} />
          <MonthTile icon="📅" label="Dias com venda" value={String(daysWithSales)} />
          <MonthTile icon="📊" label="Média por dia" value={money(daysWithSales ? Math.round(monthSales / daysWithSales) : 0)} />
        </div>
        {best && best.cash.salesTotal > 0 && (
          <button onClick={() => open(best.d.date)} className="mt-2 w-full flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-left active:bg-amber-100">
            <span className="text-lg">🏆</span>
            <span className="flex-1 text-[13px] text-amber-900">Melhor dia: <b>{WEEK_SHORT[new Date(best.d.date + 'T12:00').getDay()]}, {fmtDate(best.d.date, false)}</b></span>
            <span className="font-extrabold text-amber-800 tabular-nums">{money(best.cash.salesTotal)}</span>
          </button>
        )}
      </Card>

      {/* calendário */}
      <Card className="p-3 mt-3">
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-slate-400 mb-1">
          {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((d, i) => <div key={i}>{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((c, i) => {
            if (!c) return <div key={i} />;
            const info = byDate.get(c);
            const cls = info ? (info.d.status === 'closed' ? 'bg-purple-50 text-purple-800 border-purple-200' : 'bg-emerald-50 text-emerald-800 border-emerald-200') : 'bg-slate-50 text-slate-400 border-transparent';
            return (
              <button key={c} onClick={() => open(c)} className={`aspect-square rounded-lg border text-sm font-bold flex flex-col items-center justify-center ${cls} ${c === today ? 'ring-2 ring-blue-500' : ''}`}>
                {Number(c.slice(8))}
                {info && info.cash.salesTotal > 0 && <span className="text-[9px] font-semibold leading-none mt-0.5">{money(info.cash.salesTotal)}</span>}
              </button>
            );
          })}
        </div>
        <div className="flex gap-3 justify-center mt-2 text-[11px] text-slate-500">
          <span><span className="inline-block w-2.5 h-2.5 rounded bg-emerald-200 mr-1" />aberto</span>
          <span><span className="inline-block w-2.5 h-2.5 rounded bg-purple-200 mr-1" />encerrado</span>
          <span><span className="inline-block w-2.5 h-2.5 rounded bg-slate-100 mr-1" />sem registro</span>
        </div>
      </Card>

      <Button variant="outline" className="w-full mt-3" onClick={() => setOverlay('comparar')}>⇄ Comparar dois dias</Button>

      <h2 className="text-[13px] font-bold uppercase tracking-wide text-slate-500 mt-5 mb-2 px-1">Dias registrados em {MONTHS[m - 1].toLowerCase()}</h2>
      {days && !days.length && <Empty icon="🗓️" title="Nenhum dia neste mês">Use ‹ › para ver outros meses.</Empty>}
      <div className="space-y-2.5">
        {list.map(({ d, units, sold, orders, entered, out, cash }) => {
          const dt = new Date(d.date + 'T12:00');
          return (
            <button key={d.id} onClick={() => open(d.date)} className="w-full text-left bg-white rounded-2xl border border-slate-200 p-3 active:bg-slate-50">
              <div className="flex items-center gap-3">
                <span className={`w-12 h-12 shrink-0 rounded-xl flex flex-col items-center justify-center leading-none ${d.date === today ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700'}`}>
                  <span className="text-[10px] font-bold uppercase opacity-80">{WEEK_SHORT[dt.getDay()]}</span>
                  <span className="text-[19px] font-extrabold">{dt.getDate()}</span>
                </span>
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className="font-bold text-slate-800">{d.date === today ? 'Hoje' : fmtDate(d.date, false)}</span>
                    {d.status === 'closed'
                      ? <span className="rounded-full bg-purple-100 text-purple-700 px-2 py-0.5 text-[11px] font-bold">🔒 encerrado</span>
                      : <span className="rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-[11px] font-bold">● aberto</span>}
                  </span>
                  <span className="block text-[12px] text-slate-500">{orders} {orders === 1 ? 'venda' : 'vendas'} · {sold} {sold === 1 ? 'peça' : 'peças'}</span>
                </span>
                <span className="text-right">
                  <span className="block text-[20px] font-extrabold tabular-nums text-emerald-700 leading-none">{money(cash.salesTotal)}</span>
                  <span className="block text-[11px] text-slate-400">vendido</span>
                </span>
              </div>
              {/* barra: tamanho = vendas do dia comparado ao melhor dia; cores = formas de pagamento */}
              <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden mt-2.5 flex" style={{ width: `${Math.max(4, (cash.salesTotal / maxSale) * 100)}%` }}>
                {cash.salesTotal > 0 && (['dinheiro', 'pix', 'cartao', 'debito', 'outro'] as PaymentMethod[]).map((mm) => cash.salesByMethod[mm] > 0 && (
                  <span key={mm} className={METHOD_COLOR[mm]} style={{ width: `${(cash.salesByMethod[mm] / cash.salesTotal) * 100}%` }} />
                ))}
              </div>
              <div className="flex flex-wrap gap-1 mt-2">
                <Pill>📦 {units} no estoque</Pill>
                {entered > 0 && <Pill tone="bg-emerald-50 text-emerald-700">📥 +{entered}</Pill>}
                {out > 0 && <Pill tone="bg-red-50 text-red-700">📤 −{out}</Pill>}
                {cash.darTotal + cash.despesas > 0 && <Pill tone="bg-orange-50 text-orange-700">🤝 −{money(cash.darTotal + cash.despesas)}</Pill>}
                <Pill tone="bg-emerald-50 text-emerald-800">🧮 saldo {money(cash.accumulated)}</Pill>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MonthTile({ icon, label, value, tone = 'text-slate-800' }: { icon: string; label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2">
      <div className="text-[11px] text-slate-500 font-semibold">{icon} {label}</div>
      <div className={`text-[19px] font-extrabold tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}

function Pill({ children, tone = 'bg-slate-100 text-slate-600' }: { children: React.ReactNode; tone?: string }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`}>{children}</span>;
}

export function CompareSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { date } = useApp();
  const days = useLiveQuery(() => db.dailyRecords.orderBy('date').toArray(), []);
  const [a, setA] = useState<string>('');
  const [b, setB] = useState<string>('');
  const [onlyDiff, setOnlyDiff] = useState(true);
  const dates = (days ?? []).map((d) => d.date);
  const B = b || (dates.includes(date) ? date : dates[dates.length - 1] ?? '');
  const A = a || dates.filter((d) => d < B).pop() || '';
  const rows = useLiveQuery(() => (A && B && open ? compareDays(A, B) : Promise.resolve([])), [A, B, open]);
  if (!open) return null;
  const shown = (rows ?? []).filter((r) => !onlyDiff || r.diff !== 0 || r.unexplained !== 0);
  const divergences = (rows ?? []).filter((r) => r.unexplained !== 0).length;
  const sel = (v: string, set: (s: string) => void) => (
    <select value={v} onChange={(e) => set(e.target.value)} className="flex-1 h-11 rounded-xl border border-slate-300 bg-white px-2 font-semibold">
      {dates.map((d) => <option key={d} value={d}>{fmtDate(d)}</option>)}
    </select>
  );
  return (
    <Sheet open onClose={onClose} title="Comparar dias" tall>
      {dates.length < 2 ? <Empty icon="⇄" title="Precisa de pelo menos 2 dias registrados" /> : (
        <>
          <div className="flex items-center gap-2">{sel(A, setA)}<span>→</span>{sel(B, setB)}</div>
          <div className="flex items-center justify-between mt-2 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} /> Só o que mudou</label>
            {divergences > 0 ? <Badge tone="red">⚠ {divergences} sem explicação</Badge> : <Badge tone="green">tudo explicado</Badge>}
          </div>
          <p className="text-xs text-slate-500 mt-2">Diferenças explicadas por vendas, entradas, saídas e ajustes registrados. O que sobra é divergência (sem movimentação correspondente).</p>
          <div className="space-y-1.5 mt-3">
            {shown.map((r) => (
              <Card key={r.variant.id} className={`p-2.5 ${r.unexplained ? 'border-red-300 bg-red-50/50' : ''}`}>
                <div className="flex items-center gap-2">
                  <span className="flex-1 font-semibold text-slate-800 break-words">{r.group.name} · {r.variant.name}</span>
                  <span className="tabular-nums text-slate-600">{r.a} → <b>{r.b}</b></span>
                  <span className={`w-10 text-right font-bold tabular-nums ${r.diff > 0 ? 'text-emerald-600' : r.diff < 0 ? 'text-red-600' : 'text-slate-400'}`}>{r.diff > 0 ? '+' : ''}{r.diff}</span>
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {Object.entries(r.byType).map(([t, q]) => `${MOVE_LABEL[t as MovementType]} ${q! > 0 ? '+' : ''}${q}`).join(' · ') || 'sem movimentos'}
                  {r.unexplained !== 0 && <b className="text-red-600"> · divergência {r.unexplained > 0 ? '+' : ''}{r.unexplained}</b>}
                </div>
              </Card>
            ))}
            {!shown.length && <Empty icon="✅" title="Nenhuma diferença" />}
          </div>
        </>
      )}
    </Sheet>
  );
}

