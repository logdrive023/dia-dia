import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { seedIfNeeded } from './db/seed';
import { AppProvider, useApp, type Tab } from './state';
import { UiProvider } from './components/ui';
import Home from './screens/Home';
import Stock from './screens/Stock';
import Sell, { CheckoutSheet } from './screens/Sell';
import Cash from './screens/Cash';
import History, { CompareSheet } from './screens/History';
import CloseDaySheet from './screens/CloseDay';
import CatalogSheet from './screens/Catalog';
import BackupSheet from './screens/Backup';
import SettingsSheet from './screens/Settings';

const TABS: [Tab, string, string][] = [
  ['inicio', '🏠', 'Início'], ['estoque', '📦', 'Estoque'], ['vender', '🏷️', 'Vender'], ['caixa', '💰', 'Caixa'], ['historico', '🗓️', 'Histórico'],
];
const TITLES: Record<Tab, string> = { inicio: 'Dia a Dia', estoque: 'Estoque', vender: 'Para vender', caixa: 'Caixa', historico: 'Histórico' };

function Shell() {
  const { tab, setTab, overlay, setOverlay, cart } = useApp();
  const close = () => setOverlay(null);
  const cartCount = cart.reduce((s, l) => s + l.quantity, 0);
  return (
    <div className="min-h-dvh max-w-lg mx-auto">
      <header className="sticky top-0 z-20 bg-slate-100/90 backdrop-blur pt-[env(safe-area-inset-top)]">
        <div className="flex items-center gap-2 px-4 h-14">
          <h1 className="text-xl font-extrabold text-slate-800 flex-1">{TITLES[tab]}</h1>
          <button className="h-10 px-3 rounded-xl bg-white border border-slate-200 text-sm font-semibold text-slate-700" onClick={() => setOverlay('cadastro')}>✏️ Cadastro</button>
          <button className="w-10 h-10 rounded-xl bg-white border border-slate-200" onClick={() => setOverlay('backup')} aria-label="Backup">💾</button>
          <button className="w-10 h-10 rounded-xl bg-white border border-slate-200" onClick={() => setOverlay('config')} aria-label="Configurações">⚙️</button>
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
        <div className="max-w-lg mx-auto grid grid-cols-5 h-16">
          {TABS.map(([k, i, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`relative flex flex-col items-center justify-center gap-0.5 ${tab === k ? 'text-blue-600' : 'text-slate-500'}`}>
              <span className={`text-xl transition ${tab === k ? 'scale-110' : 'grayscale opacity-70'}`}>{i}</span>
              <span className="text-[11px] font-semibold">{l}</span>
              {k === 'vender' && cartCount > 0 && <span className="absolute top-1.5 right-[22%] bg-emerald-500 text-white text-[10px] rounded-full min-w-4 h-4 px-1 flex items-center justify-center">{cartCount}</span>}
              {tab === k && <span className="absolute top-0 w-8 h-0.5 rounded-full bg-blue-600" />}
            </button>
          ))}
        </div>
      </nav>
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

export default function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    seedIfNeeded().then(() => setReady(true)).catch((e) => setError(String(e?.message ?? e)));
    navigator.storage?.persist?.().catch(() => {});
  }, []);
  if (error) return <div className="p-6 text-red-700">Não foi possível abrir o banco de dados local: {error}</div>;
  if (!ready) return <div className="min-h-dvh flex items-center justify-center text-slate-400">Carregando…</div>;
  return (
    <UiProvider>
      <AppProvider>
        <Shell />
      </AppProvider>
    </UiProvider>
  );
}
