import { Component, useEffect, useState, type ReactNode } from 'react';
import { db } from './db/db';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { seedIfNeeded } from './db/seed';
import { AppProvider, useApp, type Tab } from './state';
import { Sheet, UiProvider } from './components/ui';
import Home from './screens/Home';
import Stock from './screens/Stock';
import Sell, { CheckoutSheet } from './screens/Sell';
import Cash from './screens/Cash';
import History, { CompareSheet } from './screens/History';
import CloseDaySheet from './screens/CloseDay';
import CatalogSheet from './screens/Catalog';
import BackupSheet from './screens/Backup';
import SettingsSheet from './screens/Settings';

// Navegação: 4 abas embaixo (Vender no meio, em destaque) + um único Menu no topo para o resto.
const TABS: [Tab, string, string][] = [['inicio', '🏠', 'Início'], ['vender', '🛍️', 'Vender'], ['estoque', '📦', 'Estoque'], ['caixa', '💰', 'Caixa']];
const TITLES: Record<Tab, string> = { inicio: 'Dia a Dia', estoque: 'Estoque', vender: 'Vender', caixa: 'Caixa', historico: 'Histórico' };

function Shell() {
  const { tab, setTab, overlay, setOverlay, cart } = useApp();
  const close = () => setOverlay(null);
  const cartCount = cart.reduce((s, l) => s + l.quantity, 0);
  return (
    <div className="min-h-dvh max-w-lg mx-auto">
      <header className="sticky top-0 z-20 bg-slate-100/90 backdrop-blur pt-[env(safe-area-inset-top)]">
        <div className="flex items-center gap-2 px-4 h-14">
          {tab === 'historico' && <button className="w-10 h-10 -ml-2 text-2xl text-slate-600" onClick={() => setTab('inicio')} aria-label="Voltar">‹</button>}
          <h1 className="text-xl font-extrabold text-slate-800 flex-1">{TITLES[tab]}</h1>
          <button className="h-10 px-3.5 rounded-xl bg-white border border-slate-200 text-sm font-semibold text-slate-700" onClick={() => setOverlay('menu')}>☰ Menu</button>
        </div>
      </header>
      <main className="px-4 pb-28 pt-1">
        {tab === 'inicio' && <Home />}
        {tab === 'estoque' && <Stock />}
        {tab === 'vender' && <Sell />}
        {tab === 'caixa' && <Cash />}
        {tab === 'historico' && <History />}
      </main>
      <nav className="fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-slate-200 pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-lg mx-auto grid grid-cols-4 h-16 px-1">
          {TABS.map(([k, i, l]) => k === 'vender' ? (
            <button key={k} onClick={() => setTab(k)} className="relative flex items-center justify-center">
              <span className={`flex flex-col items-center justify-center w-[86%] h-12 rounded-2xl font-bold text-[12px] shadow-sm
                ${tab === k ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-700'}`}>
                <span className="text-xl leading-none">{i}</span>{l}
              </span>
              {cartCount > 0 && <span className="absolute top-1 right-[10%] bg-emerald-500 text-white text-[10px] rounded-full min-w-5 h-5 px-1 flex items-center justify-center font-bold">{cartCount}</span>}
            </button>
          ) : (
            <button key={k} onClick={() => setTab(k)} className={`relative flex flex-col items-center justify-center gap-0.5 ${tab === k ? 'text-blue-600' : 'text-slate-500'}`}>
              <span className={`text-xl transition ${tab === k ? 'scale-110' : 'grayscale opacity-70'}`}>{i}</span>
              <span className="text-[11px] font-semibold">{l}</span>
              {tab === k && <span className="absolute top-0 w-8 h-0.5 rounded-full bg-blue-600" />}
            </button>
          ))}
        </div>
      </nav>
      <MenuSheet open={overlay === 'menu'} onClose={close} />
      <CheckoutSheet open={overlay === 'checkout'} onClose={close} />
      <CloseDaySheet open={overlay === 'fechar'} onClose={close} />
      <CompareSheet open={overlay === 'comparar'} onClose={close} />
      <CatalogSheet open={overlay === 'cadastro'} onClose={close} />
      <BackupSheet open={overlay === 'backup'} onClose={close} />
      <SettingsSheet open={overlay === 'config'} onClose={close} />
      <UpdateBanner />
    </div>
  );
}

/** Tudo que não é do dia a dia fica aqui, com nome e explicação. */
function MenuSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { setTab, setOverlay } = useApp();
  if (!open) return null;
  const items: [string, string, string, () => void][] = [
    ['✏️', 'Produtos e grupos', 'Criar, renomear, preço, estoque mínimo', () => setOverlay('cadastro')],
    ['🗓️', 'Histórico', 'Dias anteriores e comparar dias', () => { setTab('historico'); onClose(); }],
    ['💾', 'Backup', 'Salvar ou restaurar todos os dados', () => setOverlay('backup')],
    ['⚙️', 'Configurações', 'Moeda, pagamentos, verificar dados', () => setOverlay('config')],
  ];
  return (
    <Sheet open onClose={onClose} title="Menu">
      <div className="space-y-2 pb-2">
        {items.map(([i, t, d, fn]) => (
          <button key={t} onClick={fn} className="w-full flex items-center gap-3 bg-white border border-slate-200 rounded-2xl px-4 py-3 text-left active:bg-slate-50">
            <span className="text-2xl">{i}</span>
            <span className="flex-1">
              <span className="block font-bold text-slate-800">{t}</span>
              <span className="block text-xs text-slate-500">{d}</span>
            </span>
            <span className="text-slate-400">›</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

function UpdateBanner() {
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW();
  if (!needRefresh) return null;
  return (
    <div className="fixed bottom-[calc(72px+env(safe-area-inset-bottom))] inset-x-4 z-[45] max-w-lg mx-auto bg-slate-800 text-white rounded-xl p-3 flex items-center gap-3 shadow-xl">
      <span className="flex-1 text-sm">Nova versão disponível. Seus dados continuam salvos.</span>
      <button className="font-semibold text-sm bg-blue-600 px-3 h-9 rounded-lg" onClick={() => updateServiceWorker(true)}>Atualizar</button>
    </div>
  );
}

const BOOT_TIMEOUT_MS = 8000;

export default function App() {
  const [state, setState] = useState<'loading' | 'ready' | 'slow' | 'error'>('loading');
  const [error, setError] = useState('');
  useEffect(() => {
    let done = false;
    // nunca ficar preso no "Carregando": se o banco não abrir a tempo, mostra o que fazer
    const timer = setTimeout(() => { if (!done) setState('slow'); }, BOOT_TIMEOUT_MS);
    db.open()
      .then(() => seedIfNeeded())
      .then(() => { done = true; clearTimeout(timer); setState('ready'); })
      .catch((e) => { done = true; clearTimeout(timer); setError(String(e?.message ?? e)); setState('error'); });
    navigator.storage?.persist?.().catch(() => {});
    return () => clearTimeout(timer);
  }, []);
  if (state === 'loading') return <Splash />;
  if (state === 'slow' || state === 'error') return <Recovery error={state === 'error' ? error : ''} />;
  return (
    <ErrorBoundary>
      <UiProvider>
        <AppProvider>
          <Shell />
        </AppProvider>
      </UiProvider>
    </ErrorBoundary>
  );
}

function Splash() {
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center gap-3 text-slate-500">
      <img src="./icon-192.png" alt="" className="w-16 h-16 rounded-2xl animate-pulse" />
      <span className="text-sm">Abrindo…</span>
    </div>
  );
}

/** Tela de socorro: os dados ficam no aparelho; aqui só recarrega ou atualiza os arquivos do app. */
export function Recovery({ error }: { error?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="min-h-dvh max-w-md mx-auto flex flex-col justify-center p-6 text-slate-700">
      <div className="text-4xl mb-2">🛠️</div>
      <h1 className="text-xl font-bold">{error ? 'Não foi possível abrir os dados' : 'O app está demorando para abrir'}</h1>
      <p className="text-sm mt-2">
        Seus dados continuam guardados neste aparelho. Feche outras abas do app e toque em <b>Tentar de novo</b>.
        Se continuar, toque em <b>Atualizar o app</b> (não apaga nada).
      </p>
      {error && <p className="text-xs text-red-600 mt-2 break-words">Detalhe: {error}</p>}
      <button className="mt-5 h-12 rounded-xl bg-blue-600 text-white font-semibold" onClick={() => location.reload()}>Tentar de novo</button>
      <button className="mt-2 h-12 rounded-xl border border-slate-300 font-semibold disabled:opacity-50" disabled={busy}
        onClick={async () => { setBusy(true); await resetAppFiles(); location.reload(); }}>
        {busy ? 'Atualizando…' : 'Atualizar o app'}
      </button>
    </div>
  );
}

/** Remove só o cache de arquivos e o service worker (o banco IndexedDB fica intacto). */
async function resetAppFiles() {
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
    await Promise.all(regs.map((r) => r.unregister()));
    const keys = (await window.caches?.keys?.()) ?? [];
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch { /* segue para o reload */ }
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: Error) { return { error: e.message || String(e) }; }
  componentDidCatch(e: Error) { console.error(e); }
  render() { return this.state.error ? <Recovery error={this.state.error} /> : this.props.children; }
}
