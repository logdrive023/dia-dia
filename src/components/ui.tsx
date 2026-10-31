import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { colorName, NAMED_COLORS } from '../lib/util';

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
      className={`shrink-0 h-10 px-4 rounded-full text-sm font-medium border transition
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

/**
 * Escolha de cor: o nome da cor escolhida aparece ao lado do título (“Cor · Azul”).
 * `colors` padrão = paleta com nomes (inclui Poá e Branco).
 */
export function ColorField({ value, onChange, label = 'Cor', colors }: {
  value?: string | null; onChange: (c: string) => void; label?: ReactNode; colors?: string[];
}) {
  const list = colors ?? NAMED_COLORS.map(([c]) => c);
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-1.5 text-sm font-semibold text-slate-700">
        <span>{label}</span>
        {value && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white border border-slate-200 pl-1 pr-2.5 py-0.5 text-[13px] font-bold text-slate-800">
            <Swatch color={value} size={16} />{colorName(value)}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {list.map((c) => (
          <button key={c} type="button" onClick={() => onChange(c)} aria-label={`Cor ${colorName(c)}`} aria-pressed={value === c} title={colorName(c)}
            className={`rounded-full p-0.5 ${value === c ? 'ring-2 ring-offset-1 ring-blue-500' : ''}`}><Swatch color={c} size={32} /></button>
        ))}
      </div>
    </div>
  );
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
    <button type="button" role="switch" aria-checked={checked} aria-label={label || (checked ? 'Ligado' : 'Desligado')} onClick={() => onChange(!checked)}
      className={`flex items-center justify-between py-2.5 min-h-11 ${label ? 'w-full' : 'shrink-0'}`}>
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

// janelas abertas, da mais antiga para a mais nova (o voltar do celular e o Esc fecham a de cima)
const sheetStack: { close: () => void }[] = [];
export function closeTopSheet() {
  const top = sheetStack[sheetStack.length - 1];
  if (!top) return false;
  top.close();
  return true;
}
if (typeof window !== 'undefined')
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeTopSheet(); });

/** Registra uma janela aberta: o voltar do celular/Esc fecha a de cima e a página atrás não rola. */
function useOverlay(open: boolean, onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const entry = { close: () => closeRef.current() };
    sheetStack.push(entry);
    document.body.style.overflow = 'hidden';
    return () => {
      const i = sheetStack.indexOf(entry);
      if (i >= 0) sheetStack.splice(i, 1);
      if (!sheetStack.length) document.body.style.overflow = '';
    };
  }, [open]);
}

export function Sheet({ open, onClose, title, children, footer, tall }:
  { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; footer?: ReactNode; tall?: boolean }) {
  useOverlay(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-slate-900/40 animate-fade" onClick={onClose} />
      <div className={`relative w-full max-w-lg min-w-0 overflow-hidden bg-slate-50 rounded-t-3xl shadow-2xl flex flex-col animate-up ${tall ? 'sheet-tall' : 'sheet-max'}`}>
        <div className="flex items-center justify-between px-5 pt-3 pb-2">
          <div className="text-lg font-bold text-slate-800 break-words">{title}</div>
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-slate-200/70 text-slate-600 text-lg" aria-label="Fechar">✕</button>
        </div>
        <div className="overflow-y-auto overflow-x-hidden px-5 pb-4 flex-1 min-h-0 overscroll-contain min-w-0 [-webkit-overflow-scrolling:touch] [touch-action:pan-y]">{children}</div>
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
  useOverlay(!!req, () => close(false));
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

/**
 * ⓘ que explica o número/termo com um exemplo. No celular abre um cartão no meio da tela
 * (toque para abrir e para fechar).
 */
export function InfoTip({ title, children, example, action, open: openProp, onOpenChange, hideButton }: {
  title: string; children: ReactNode;
  /** de preferência uma lista curta: [emoji, texto] por linha */
  example?: ReactNode | [ReactNode, ReactNode][];
  /** botão extra dentro do cartão (ex.: "Ver no Estoque") */
  action?: { label: string; onClick: () => void };
  /** controlado por fora (ex.: o cartão inteiro abre a explicação) */
  open?: boolean; onOpenChange?: (v: boolean) => void; hideButton?: boolean;
}) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (v: boolean) => { onOpenChange?.(v); if (openProp === undefined) setOpenState(v); };
  useOverlay(open, () => setOpen(false));
  return (
    <>
      {!hideButton && (
        // o círculo é pequeno, mas a área de toque tem 44px (não precisa mirar)
        <button type="button" aria-label={`O que é: ${title}`}
          onClick={(e) => { e.stopPropagation(); setOpen(true); }}
          className="relative inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-200 text-slate-600 text-[12px] font-bold align-middle shrink-0
            after:content-[''] after:absolute after:-inset-[10px] active:bg-slate-300">i</button>
      )}
      {open && createPortal(
        // fora do título/cartão onde o ⓘ está: não herda maiúsculas nem negrito
        <div className="fixed inset-0 z-[65] flex items-center justify-center p-5 normal-case tracking-normal font-normal text-left"
          onClick={(e) => { e.stopPropagation(); setOpen(false); }}>
          <div className="absolute inset-0 bg-slate-900/40 animate-fade" />
          <div className="relative bg-white rounded-3xl p-5 w-full max-w-sm shadow-2xl animate-pop" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold">i</span>
              <div className="text-[17px] font-bold text-slate-800 leading-tight">{title}</div>
            </div>
            <div className="text-[15px] leading-relaxed text-slate-600 mt-3">{children}</div>
            {example && (
              <div className="mt-4 rounded-2xl bg-amber-50 border border-amber-200/70 overflow-hidden">
                <div className="px-3.5 pt-2.5 text-[12px] font-semibold text-amber-700 tracking-wide">💡 Por exemplo</div>
                {Array.isArray(example) ? (
                  <ul className="px-3.5 pb-3 pt-1.5 space-y-2">
                    {(example as [ReactNode, ReactNode][]).map(([emoji, text], i) => (
                      <li key={i} className="flex items-start gap-2.5 text-[15px] leading-snug text-slate-700">
                        <span className="min-w-6 flex justify-center text-[17px] leading-tight shrink-0">{emoji}</span>
                        <span className="flex-1">{text}</span>
                      </li>
                    ))}
                  </ul>
                ) : <div className="px-3.5 pb-3 pt-1 text-[15px] leading-relaxed text-slate-700">{example}</div>}
              </div>
            )}
            {action ? (
              <div className="grid grid-cols-2 gap-2 mt-5">
                <Button variant="soft" onClick={() => setOpen(false)}>Entendi</Button>
                <Button onClick={() => { setOpen(false); action.onClick(); }}>{action.label}</Button>
              </div>
            ) : <Button className="w-full mt-5" onClick={() => setOpen(false)}>Entendi</Button>}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

/** Botão de ajuda compacto ("🛍️ Como vender ⓘ"): abre a explicação com exemplo. Ocupa uma linha só. */
export function HelpButton({ icon, label, title, children, example }: {
  icon: string; label: string; title: string; children: ReactNode; example?: ReactNode | [ReactNode, ReactNode][];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="flex-1 min-w-0 h-11 px-3 rounded-xl bg-white border border-slate-200 flex items-center gap-2 text-left active:bg-slate-50">
        <span className="text-lg">{icon}</span>
        <span className="flex-1 break-words text-[14px] font-semibold text-slate-700">{label}</span>
        <span className="w-5 h-5 rounded-full bg-slate-200 text-slate-600 text-[11px] font-bold flex items-center justify-center">i</span>
      </button>
      <InfoTip hideButton open={open} onOpenChange={setOpen} title={title} example={example}>{children}</InfoTip>
    </>
  );
}
