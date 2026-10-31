import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

// ---------------- botões e blocos ----------------

type BtnVariant = 'primary' | 'success' | 'danger' | 'warning' | 'ghost' | 'soft' | 'outline';
const BTN: Record<BtnVariant, string> = {
  primary: 'bg-blue-600 text-white active:bg-blue-700 shadow-sm shadow-blue-600/30',
  success: 'bg-emerald-600 text-white active:bg-emerald-700 shadow-sm shadow-emerald-600/30',
  danger: 'bg-red-600 text-white active:bg-red-700',
  warning: 'bg-orange-500 text-white active:bg-orange-600',
  ghost: 'text-slate-600 active:bg-slate-100',
  soft: 'bg-slate-100 text-slate-700 active:bg-slate-200',
  outline: 'border border-slate-300 text-slate-700 bg-white active:bg-slate-50',
};

export function Button({ variant = 'primary', className = '', size = 'md', ...p }:
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md' | 'lg' }) {
  const sz = size === 'lg' ? 'h-14 px-5 text-base' : size === 'sm' ? 'h-9 px-3 text-sm' : 'h-11 px-4 text-[15px]';
  return (
    <button
      {...p}
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition select-none
        disabled:opacity-40 disabled:pointer-events-none ${sz} ${BTN[variant]} ${className}`}
    />
  );
}

export function Card({ className = '', ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...p} className={`bg-white rounded-2xl shadow-sm border border-slate-200/70 ${className}`} />;
}

export function Chip({ active, className = '', ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      {...p}
      className={`shrink-0 h-9 px-3.5 rounded-full text-sm font-medium border transition
        ${active ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 active:bg-slate-100'} ${className}`}
    />
  );
}

export function Badge({ tone = 'slate', children }: { tone?: 'slate' | 'green' | 'red' | 'orange' | 'blue' | 'purple'; children: ReactNode }) {
  const t = {
    slate: 'bg-slate-100 text-slate-600', green: 'bg-emerald-100 text-emerald-700', red: 'bg-red-100 text-red-700',
    orange: 'bg-orange-100 text-orange-700', blue: 'bg-blue-100 text-blue-700', purple: 'bg-purple-100 text-purple-700',
  }[tone];
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${t}`}>{children}</span>;
}

export function Swatch({ color, size = 18 }: { color?: string; size?: number }) {
  if (color === 'poa')
    return (
      <span className="inline-block rounded-full border border-slate-300 shrink-0"
        style={{ width: size, height: size, backgroundColor: '#fff',
          backgroundImage: 'radial-gradient(#111 22%, transparent 24%)', backgroundSize: `${size / 3}px ${size / 3}px` }} />
    );
  return <span className="inline-block rounded-full border border-black/10 shrink-0" style={{ width: size, height: size, background: color || '#cbd5e1' }} />;
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between mt-5 mb-2 px-1">
      <h2 className="text-[13px] font-bold uppercase tracking-wide text-slate-500">{children}</h2>
      {right}
    </div>
  );
}

export function Empty({ icon = '📭', title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="text-center py-10 px-6 text-slate-500">
      <div className="text-4xl mb-2">{icon}</div>
      <div className="font-semibold text-slate-700">{title}</div>
      {children && <div className="text-sm mt-1">{children}</div>}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block mb-3">
      <span className="block text-sm font-semibold text-slate-700 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-xs text-slate-500 mt-1">{hint}</span>}
    </label>
  );
}

export const inputCls = 'w-full h-12 px-3.5 rounded-xl border border-slate-300 bg-white text-base outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20';

export function Input(p: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={`${inputCls} ${p.className ?? ''}`} />;
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex items-center justify-between w-full py-2.5">
      <span className="text-[15px] text-slate-700">{label}</span>
      <span className={`w-12 h-7 rounded-full p-0.5 transition ${checked ? 'bg-blue-600' : 'bg-slate-300'}`}>
        <span className={`block w-6 h-6 rounded-full bg-white shadow transition ${checked ? 'translate-x-5' : ''}`} />
      </span>
    </button>
  );
}

export function Stepper({ value, onChange, min = 0, max }: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <div className="flex items-center gap-1">
      <button type="button" className="w-10 h-10 rounded-xl bg-slate-100 text-xl font-bold text-slate-700 active:bg-slate-200 disabled:opacity-30"
        disabled={value <= min} onClick={() => onChange(value - 1)}>−</button>
      <span className="w-9 text-center text-lg font-bold tabular-nums">{value}</span>
      <button type="button" className="w-10 h-10 rounded-xl bg-slate-100 text-xl font-bold text-slate-700 active:bg-slate-200 disabled:opacity-30"
        disabled={max !== undefined && value >= max} onClick={() => onChange(value + 1)}>+</button>
    </div>
  );
}

// ---------------- folha inferior (modal) ----------------

export function Sheet({ open, onClose, title, children, footer, tall }:
  { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; footer?: ReactNode; tall?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-slate-900/40 animate-fade" onClick={onClose} />
      <div className={`relative w-full max-w-lg bg-slate-50 rounded-t-3xl shadow-2xl flex flex-col animate-up ${tall ? 'h-[92dvh]' : 'max-h-[92dvh]'}`}>
        <div className="flex items-center justify-between px-5 pt-3 pb-2">
          <div className="text-lg font-bold text-slate-800 truncate">{title}</div>
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-slate-200/70 text-slate-600 text-lg" aria-label="Fechar">✕</button>
        </div>
        <div className="overflow-y-auto px-5 pb-4 flex-1 overscroll-contain">{children}</div>
        {footer && <div className="px-5 pt-3 pb-[max(env(safe-area-inset-bottom),12px)] border-t border-slate-200 bg-white rounded-b-none">{footer}</div>}
      </div>
    </div>
  );
}

// ---------------- toast + confirmação ----------------

type ToastAction = { label: string; fn: () => void };
type ToastT = { id: number; text: string; tone: 'ok' | 'err' | 'info'; action?: ToastAction };
type ConfirmReq = { title: string; message?: ReactNode; confirm?: string; tone?: BtnVariant; resolve: (v: boolean) => void };

const UiCtx = createContext<{
  toast: (text: string, tone?: ToastT['tone'], action?: ToastAction) => void;
  confirm: (o: Omit<ConfirmReq, 'resolve'>) => Promise<boolean>;
  run: <T>(fn: () => Promise<T>, okMsg?: string) => Promise<T | undefined>;
} | null>(null);

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastT[]>([]);
  const [req, setReq] = useState<ConfirmReq | null>(null);
  const seq = useRef(0);
  const toast = useCallback((text: string, tone: ToastT['tone'] = 'ok', action?: ToastAction) => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-2), { id, text, tone, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'err' || action ? 4500 : 2200);
  }, []);
  const confirm = useCallback((o: Omit<ConfirmReq, 'resolve'>) => new Promise<boolean>((resolve) => setReq({ ...o, resolve })), []);
  const run = useCallback(async <T,>(fn: () => Promise<T>, okMsg?: string) => {
    try {
      const r = await fn();
      if (okMsg) toast(okMsg);
      return r;
    } catch (e) {
      console.error(e);
      toast((e as Error).message || 'Não foi possível salvar.', 'err');
      return undefined;
    }
  }, [toast]);
  const close = (v: boolean) => { req?.resolve(v); setReq(null); };
  return (
    <UiCtx.Provider value={{ toast, confirm, run }}>
      {children}
      <div className="fixed top-[max(env(safe-area-inset-top),12px)] inset-x-0 z-[70] flex flex-col items-center gap-2 pointer-events-none px-4">
        {toasts.map((t) => (
          <div key={t.id} className={`animate-down px-4 py-2.5 rounded-xl shadow-lg text-sm font-semibold max-w-md flex items-center gap-3
            ${t.tone === 'err' ? 'bg-red-600 text-white' : t.tone === 'info' ? 'bg-slate-800 text-white' : 'bg-emerald-600 text-white'}`}>
            <span>{t.tone === 'ok' ? '✓ ' : t.tone === 'err' ? '⚠ ' : ''}{t.text}</span>
            {t.action && (
              <button className="pointer-events-auto underline font-bold" onClick={() => { t.action!.fn(); setToasts((x) => x.filter((y) => y.id !== t.id)); }}>
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
      {req && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-slate-900/50 animate-fade" onClick={() => close(false)} />
          <div className="relative bg-white rounded-2xl p-5 w-full max-w-sm shadow-2xl animate-pop">
            <div className="text-lg font-bold text-slate-800">{req.title}</div>
            {req.message && <div className="text-slate-600 mt-2 text-[15px]">{req.message}</div>}
            <div className="flex gap-2 mt-5">
              <Button variant="soft" className="flex-1" onClick={() => close(false)}>Voltar</Button>
              <Button variant={req.tone ?? 'primary'} className="flex-1" onClick={() => close(true)}>{req.confirm ?? 'Confirmar'}</Button>
            </div>
          </div>
        </div>
      )}
    </UiCtx.Provider>
  );
}

export function useUi() {
  const c = useContext(UiCtx);
  if (!c) throw new Error('UiProvider ausente');
  return c;
}

/** Evita duplo toque: ignora cliques enquanto a ação anterior não terminou. */
export function useBusy() {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const wrap = useCallback(async (fn: () => Promise<unknown>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try { await fn(); } finally { lock.current = false; setBusy(false); }
  }, []);
  return [busy, wrap] as const;
}
