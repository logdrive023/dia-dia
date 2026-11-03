import type { EntryKind } from '../db/types';

/** Por que o estoque subiu: chegou mercadoria (nova ou reposição) ou foi só correção da contagem (ajuste). */
export type IncreaseReason = EntryKind | 'ajuste';

const OPTIONS: { v: IncreaseReason; icon: string; label: string; hint: string }[] = [
  { v: 'nova', icon: '📦', label: 'Mercadoria nova', hint: 'peça que a loja ainda não tinha' },
  { v: 'reposicao', icon: '🔁', label: 'Reposição', hint: 'mais peças de algo que já vende' },
  { v: 'ajuste', icon: '✏️', label: 'Correção da contagem', hint: 'não chegou nada: estava errado' },
];

/**
 * Escolha do motivo. `withAdjust` mostra também “Correção da contagem” (usado no “Definir” e no
 * “No estoque hoje”, quando a quantidade sobe). Entrada conta em “Entrou hoje”; correção é ajuste.
 */
export function EntryReasonPicker({ value, onChange, withAdjust = false }: { value: IncreaseReason | null; onChange: (v: IncreaseReason) => void; withAdjust?: boolean }) {
  const list = withAdjust ? OPTIONS : OPTIONS.filter((o) => o.v !== 'ajuste');
  return (
    <div role="radiogroup" aria-label={withAdjust ? 'Por que aumentou?' : 'Tipo da entrada'} className={`grid gap-1.5 mb-3 ${withAdjust ? 'grid-cols-3' : 'grid-cols-2'}`}>
      {list.map((o) => (
        <button key={o.v} type="button" role="radio" aria-checked={value === o.v} aria-label={o.label} onClick={() => onChange(o.v)}
          className={`rounded-xl border px-2 py-2 text-left leading-tight ${value === o.v ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-slate-200 text-slate-700'}`}>
          <span className="block text-[13px] font-bold">{o.icon} {o.label}</span>
          <span className={`block text-[11px] mt-0.5 ${value === o.v ? 'text-white/85' : 'text-slate-500'}`}>{o.hint}</span>
        </button>
      ))}
    </div>
  );
}
