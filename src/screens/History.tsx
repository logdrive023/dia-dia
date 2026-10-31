import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { fmtDate, money, todayStr } from '../lib/util';
import { cashChain, compareDays } from '../services/summary';
import { useApp } from '../state';
import { MOVE_LABEL } from './Stock';
import { Badge, Button, Card, Empty, Sheet } from '../components/ui';
import type { MovementType } from '../db/types';

const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

export default function History() {
  const { setDate, setTab, setOverlay } = useApp();
  const [month, setMonth] = useState(() => todayStr().slice(0, 7));
  const days = useLiveQuery(async () => {
    const ds = await db.dailyRecords.orderBy('date').reverse().toArray();
    const chain = await cashChain();
    return Promise.all(ds.map(async (d) => {
      const [items, sales, moves, cash] = await Promise.all([
        db.dailyStockItems.where('dailyRecordId').equals(d.id).toArray(),
        db.sales.where('dailyRecordId').equals(d.id).toArray(),
        db.stockMovements.where('dailyRecordId').equals(d.id).toArray(),
        chain.get(d.id)!,
      ]);
      return {
        d, units: items.reduce((s, i) => s + i.currentQuantity, 0),
        sold: sales.filter((s) => s.status === 'ok').reduce((s, x) => s + x.quantity, 0),
        entered: moves.filter((m) => m.type === 'entrada').reduce((s, m) => s + m.quantity, 0),
        out: moves.filter((m) => m.type === 'saida' || m.type === 'perda').reduce((s, m) => s - m.quantity, 0),
        cash,
      };
    }));
  }, []);
  const byDate = new Map((days ?? []).map((x) => [x.d.date, x]));
  const open = (date: string) => { setDate(date); setTab('inicio'); };

  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const cells: (string | null)[] = Array(first.getDay()).fill(null);
  for (let d = 1; d <= new Date(y, m, 0).getDate(); d++) cells.push(`${month}-${String(d).padStart(2, '0')}`);
  const shiftMonth = (n: number) => { const d = new Date(y, m - 1 + n, 1); setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); };
  const today = todayStr();

  return (
    <div>
      <Card className="p-3">
        <div className="flex items-center justify-between mb-2">
          <button className="w-9 h-9 rounded-lg bg-slate-100" onClick={() => shiftMonth(-1)}>‹</button>
          <div className="font-bold">{MONTHS[m - 1]} {y}</div>
          <button className="w-9 h-9 rounded-lg bg-slate-100" onClick={() => shiftMonth(1)}>›</button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-slate-400 mb-1">
          {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((d, i) => <div key={i}>{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((c, i) => {
            if (!c) return <div key={i} />;
            const info = byDate.get(c);
            const cls = info ? (info.d.status === 'closed' ? 'bg-purple-100 text-purple-800' : 'bg-emerald-100 text-emerald-800') : 'bg-slate-50 text-slate-400';
            return (
              <button key={c} onClick={() => open(c)} className={`aspect-square rounded-lg text-sm font-semibold ${cls} ${c === today ? 'ring-2 ring-blue-500' : ''}`}>
                {Number(c.slice(8))}
                {info && info.cash.salesTotal > 0 && <div className="text-[9px] font-normal -mt-0.5">{money(info.cash.salesTotal)}</div>}
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

      <h2 className="text-[13px] font-bold uppercase tracking-wide text-slate-500 mt-5 mb-2 px-1">Dias registrados</h2>
      {days && !days.length && <Empty icon="🗓️" title="Nenhum dia ainda">Inicie o dia na tela Início.</Empty>}
      <div className="space-y-2">
        {days?.map(({ d, units, sold, entered, out, cash }) => (
          <Card key={d.id} className="p-3 active:bg-slate-50 cursor-pointer" onClick={() => open(d.date)}>
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-800 flex-1">{fmtDate(d.date)}</span>
              {d.status === 'closed' ? <Badge tone="purple">encerrado</Badge> : <Badge tone="green">aberto</Badge>}
            </div>
            <div className="grid grid-cols-4 gap-1 mt-2 text-center">
              <Mini label="Estoque" v={units} />
              <Mini label="Vendidas" v={sold} tone="text-emerald-600" />
              <Mini label="Entradas" v={entered} tone="text-blue-600" />
              <Mini label="Saídas" v={out} tone="text-red-600" />
            </div>
            <div className="text-xs text-slate-500 mt-1.5">
              Vendas <b>{money(cash.salesTotal)}</b> · Saldo <b>{money(cash.accumulated)}</b>
              {d.sourceDate && <> · copiado de {fmtDate(d.sourceDate, false)}</>}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Mini({ label, v, tone = 'text-slate-800' }: { label: string; v: number; tone?: string }) {
  return <div><div className={`font-extrabold tabular-nums ${tone}`}>{v}</div><div className="text-[10px] text-slate-500">{label}</div></div>;
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
                  <span className="flex-1 font-semibold text-slate-800 truncate">{r.group.name} · {r.variant.name}</span>
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

