/**
 * "começou 14 → agora 11 · −3 · repor 3": o mesmo visual em todo lugar que mostra estoque
 * (linhas do Estoque, cabeçalho dos grupos, Vender e cartões do Início).
 */
export function StockFlow({ start, now, restock = 0, out = false, reserved = 0, size = 'md' }: {
  start: number; now: number; restock?: number; out?: boolean; reserved?: number; size?: 'sm' | 'md';
}) {
  const diff = now - start;
  const t = size === 'sm' ? 'text-[11px]' : 'text-[12px]';
  return (
    <span className="flex flex-wrap items-center gap-1 mt-1 min-w-0 max-w-full">
      <span className={`inline-flex flex-wrap items-center max-w-full rounded-lg border border-slate-200 overflow-hidden ${t} tabular-nums`}>
        <span className="px-1.5 py-0.5 bg-slate-50 text-slate-500">começou <b className="text-slate-700">{start}</b></span>
        <span className="px-1 text-slate-400 bg-white">→</span>
        <span className={`px-1.5 py-0.5 bg-white ${out ? 'text-red-600' : 'text-slate-500'}`}>agora <b className={out ? 'text-red-600' : 'text-slate-900'}>{now}</b></span>
      </span>
      {diff !== 0 && (
        <span className={`rounded-full px-1.5 py-0.5 ${t} font-bold tabular-nums ${diff < 0 ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
          {diff > 0 ? '▲ +' : '▼ −'}{Math.abs(diff)}
        </span>
      )}
      {out && <span className={`rounded-full bg-red-100 text-red-700 px-1.5 py-0.5 ${t} font-bold`}>🚫 esgotado</span>}
      {restock > 0 && <span className={`rounded-full bg-orange-100 text-orange-700 px-1.5 py-0.5 ${t} font-bold`}>🔁 repor {restock}</span>}
      {reserved > 0 && <span className={`rounded-full bg-purple-100 text-purple-700 px-1.5 py-0.5 ${t} font-bold`}>📌 {reserved} reservada{reserved > 1 ? 's' : ''}</span>}
    </span>
  );
}
