import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { db } from './db/db';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { seedIfNeeded } from './db/seed';
import { PixSheet } from './components/Pix';
import { useLiveQuery } from 'dexie-react-hooks';
import { AppProvider, useApp, type Tab } from './state';
import { closeTopSheet, InfoTip, Sheet, UiProvider } from './components/ui';
import { todayStr } from './lib/util';
import Home from './screens/Home';
import Stock from './screens/Stock';
import Sell, { CheckoutSheet } from './screens/Sell';
import Cash from './screens/Cash';
/**
 * Tela carregada sob demanda. Se o arquivo não existir mais (o app foi atualizado com ele aberto),
 * recarrega uma vez para pegar a versão nova em vez de cair na tela de erro.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lazyRetry<T extends { default: React.ComponentType<any> }>(load: () => Promise<T>) {
  return lazy(async () => {
    try {
      const m = await load();
      try { sessionStorage.removeItem('chunkReload'); } catch { /* ok */ }
      return m;
    } catch (e) {
      let tried = false;
      try { tried = sessionStorage.getItem('chunkReload') === '1'; sessionStorage.setItem('chunkReload', '1'); } catch { /* ok */ }
      if (!tried) { location.reload(); return new Promise<T>(() => {}); }
      throw new Error(`APP_ATUALIZADO: ${(e as Error).message}`);
    }
  });
}

// telas usadas de vez em quando: o código só é baixado/lido quando abre (app abre mais rápido no celular)
const History = lazyRetry(() => import('./screens/History'));
const CompareSheet = lazyRetry(() => import('./screens/History').then((m) => ({ default: m.CompareSheet })));
const CloseDaySheet = lazyRetry(() => import('./screens/CloseDay'));
const CatalogSheet = lazyRetry(() => import('./screens/Catalog'));
const BackupSheet = lazyRetry(() => import('./screens/Backup'));
const SettingsSheet = lazyRetry(() => import('./screens/Settings'));
const TransferSheet = lazyRetry(() => import('./screens/Transfer'));

// Navegação: 4 abas embaixo (Vender no meio, em destaque) + um único Menu no topo para o resto.
const TABS: [Tab, string, string][] = [['inicio', '🏠', 'Início'], ['vender', '🛍️', 'Vender'], ['estoque', '📦', 'Estoque'], ['caixa', '💰', 'Caixa']];
const APP_VERSION = '1.0';
const TITLES: Record<Tab, string> = { inicio: 'Dia a Dia', estoque: 'Estoque', vender: 'Vender', caixa: 'Caixa', historico: 'Histórico' };

function Shell() {
  const { tab, setTab, overlay, setOverlay, cart, date, setDate } = useApp();
  const close = () => setOverlay(null);
  const cartCount = cart.reduce((s, l) => s + l.quantity, 0);
  return (
    <div className="min-h-dvh max-w-lg mx-auto">
      <header className="sticky top-0 z-20 bg-white/95 border-b border-slate-200 pt-[env(safe-area-inset-top)] shadow-[0_1px_8px_rgba(15,23,42,0.04)]">
        <div className="flex items-center gap-3 px-4 h-16">
          {tab === 'historico' ? (
            <button className="w-11 h-11 -ml-1.5 rounded-xl text-2xl text-slate-600 active:bg-slate-100" onClick={() => setTab('inicio')} aria-label="Voltar">‹</button>
          ) : (
            <img src="./icon-192.png" alt="" className="w-10 h-10 rounded-xl shadow-sm shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <h1 className="text-[19px] font-extrabold text-slate-800 leading-tight break-words">{TITLES[tab]}</h1>
            <SavedBadge />
          </div>
          <button className="h-11 pl-3 pr-3.5 shrink-0 rounded-xl bg-slate-100 text-[15px] font-semibold text-slate-700 active:bg-slate-200 flex items-center gap-1.5"
            onClick={() => setOverlay('menu')} aria-label="Abrir menu">
            <span className="text-lg leading-none">☰</span> Menu
          </button>
        </div>
      </header>
      <main className="px-4 pb-32 pt-1">
        {tab === 'inicio' && <Home />}
        {tab === 'estoque' && <Stock />}
        {tab === 'vender' && <Sell />}
        {tab === 'caixa' && <Cash />}
        {tab === 'historico' && <Suspense fallback={<Loading />}><History /></Suspense>}
      </main>
      <nav className="fixed bottom-0 inset-x-0 z-40 bg-white border-t border-slate-200 pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-lg mx-auto grid grid-cols-4 h-[68px] px-1.5 gap-1 py-1.5">
          {TABS.map(([k, i, l]) => {
            const active = tab === k;
            return (
              <button key={k} aria-current={active ? 'page' : undefined}
                onClick={() => {
                  // Início = hoje: sempre volta para a data de hoje
                  if (k === 'inicio' && date !== todayStr()) setDate(todayStr());
                  setTab(k);
                }}
                className={`relative flex flex-col items-center justify-center rounded-2xl
                  ${active ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30' : 'text-slate-500 active:bg-slate-100'}`}>
                <span className={`text-[22px] leading-none ${active ? '' : 'grayscale opacity-60'}`}>{i}</span>
                <span className={`text-[12px] mt-0.5 ${active ? 'font-bold' : 'font-medium'}`}>{l}</span>
                {k === 'vender' && cartCount > 0 && <span className="absolute top-0.5 right-[14%] bg-emerald-500 text-white text-[10px] rounded-full min-w-5 h-5 px-1 flex items-center justify-center font-bold ring-2 ring-white">{cartCount}</span>}
              </button>
            );
          })}
        </div>
      </nav>
      <MenuSheet open={overlay === 'menu'} onClose={close} />
      <CheckoutSheet open={overlay === 'checkout'} onClose={close} />
      <Suspense fallback={null}>
        {overlay === 'fechar' && <CloseDaySheet open onClose={close} />}
        {overlay === 'comparar' && <CompareSheet open onClose={close} />}
        {overlay === 'cadastro' && <CatalogSheet open onClose={close} />}
        {overlay === 'backup' && <BackupSheet open onClose={close} />}
        {overlay === 'config' && <SettingsSheet open onClose={close} />}
        {overlay === 'transferir' && <TransferSheet open onClose={close} />}
      </Suspense>
      <AboutSheet open={overlay === 'sobre'} onClose={close} />
      <PixSheet open={overlay === 'pix'} onClose={close} />
      <BackButton />
      <UpdateBanner />
    </div>
  );
}

/** "✓ Salvo 14:32": horário do último registro gravado no banco (prova de que está tudo lá). */
function SavedBadge() {
  const last = useLiveQuery(async () => {
    const latest = await Promise.all([
      db.stockMovements.orderBy('createdAt').last(), db.cashMovements.orderBy('createdAt').last(),
      db.orders.orderBy('createdAt').last(), db.auditLogs.orderBy('createdAt').last(),
    ]);
    const dayUpd = (await db.dailyRecords.toArray()).map((d) => d.updatedAt);
    const all = [...latest.map((x) => x?.createdAt), ...dayUpd].filter(Boolean) as string[];
    return all.sort().pop() ?? null;
  }, []);
  const when = last ? new Date(last) : null;
  const sameDay = when && todayStr(when) === todayStr();
  const hhmm = when?.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const label = !when ? 'Salvo' : sameDay ? `Salvo ${hhmm}` : `Salvo ${when.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${hhmm}`;
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* a linha toda é o botão (fácil de tocar); abre a explicação */}
      <button type="button" onClick={() => setOpen(true)} aria-label="Ver quando foi salvo"
        className="flex items-center gap-1.5 text-[12px] font-semibold text-emerald-700 py-1 -my-1 pr-2 rounded-md active:bg-emerald-50 max-w-full">
        <span className="w-4 h-4 rounded-full bg-emerald-500 text-white text-[10px] flex items-center justify-center shrink-0">✓</span>
        <span className="break-words">{when ? `Tudo salvo · ${label.replace('Salvo ', '')}` : 'Tudo salvo'}</span>
        <span className="text-slate-400 font-normal">ⓘ</span>
      </button>
      <InfoTip hideButton open={open} onOpenChange={setOpen} title="Tudo está salvo"
        example={[
          ['🛍️', <>Vendeu 1 Plomo Vermelho às {hhmm ?? '14:32'}</>],
          ['📴', 'Fechou o app ou desligou o celular'],
          ['✅', <>Abriu de novo: a venda está lá e aparece “Tudo salvo · {hhmm ?? '14:32'}”</>],
        ]}>
        {when
          ? <>Última vez que salvou: <b>{sameDay ? 'hoje' : when.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' })} às {when.toLocaleTimeString('pt-BR')}</b>. </>
          : <>Ainda não há nada lançado. </>}
        Não precisa apertar salvar: cada toque fica gravado na hora neste celular, mesmo sem internet. Para ter uma cópia fora do celular, use Menu › Backup.
      </InfoTip>
    </>
  );
}

function Loading() {
  return <div className="py-16 text-center text-slate-400 text-sm">Abrindo…</div>;
}

/**
 * Botão "voltar" do celular (Android): fecha a janela aberta em vez de sair do app;
 * sem janela aberta, volta para o Início; no Início, deixa sair.
 */
function BackButton() {
  const { tab, setTab } = useApp();
  useEffect(() => {
    history.pushState({ diaDia: true }, '');
    const onPop = () => {
      if (closeTopSheet()) { history.pushState({ diaDia: true }, ''); return; }
      if (tabRef.current !== 'inicio') { setTab('inicio'); history.pushState({ diaDia: true }, ''); return; }
      history.back();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [setTab]);
  tabRef.current = tab;
  return null;
}
const tabRef = { current: 'inicio' as Tab };

/** Tudo que não é do dia a dia fica aqui, com nome e explicação. */
function MenuSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { setTab, setOverlay } = useApp();
  if (!open) return null;
  type Item = { icon: string; tint: string; title: string; desc: string; go: () => void };
  const sections: { label: string; items: Item[] }[] = [
    { label: 'Dia a dia', items: [
      { icon: '✏️', tint: 'bg-blue-100', title: 'Produtos e grupos', desc: 'Criar, renomear, preço e estoque ideal', go: () => setOverlay('cadastro') },
      { icon: '⚡', tint: 'bg-amber-100', title: 'Mostrar meu Pix', desc: 'QR code na tela para a cliente pagar', go: () => setOverlay('pix') },
      { icon: '🗓️', tint: 'bg-indigo-100', title: 'Histórico', desc: 'Dias anteriores e comparar dias', go: () => { setTab('historico'); onClose(); } },
    ] },
    { label: 'Seus dados', items: [
      { icon: '📲', tint: 'bg-emerald-100', title: 'Passar para outro celular', desc: 'Enviar tudo e receber no outro', go: () => setOverlay('transferir') },
      { icon: '💾', tint: 'bg-orange-100', title: 'Backup', desc: 'Cópia de segurança, texto e planilhas', go: () => setOverlay('backup') },
    ] },
    { label: 'App', items: [
      { icon: '⚙️', tint: 'bg-slate-200', title: 'Configurações', desc: 'Moeda, pagamentos, verificar dados', go: () => setOverlay('config') },
      { icon: '💕', tint: 'bg-pink-100', title: 'Sobre', desc: 'Sobre o Dia a Dia', go: () => setOverlay('sobre') },
    ] },
  ];
  return (
    <Sheet open onClose={onClose} title="Menu">
      <div className="pb-2">
        {sections.map((sec) => (
          <div key={sec.label} className="mb-4">
            <div className="text-[12px] font-bold uppercase tracking-wide text-slate-400 mb-1.5 px-1">{sec.label}</div>
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden divide-y divide-slate-100">
              {sec.items.map((it) => (
                <button key={it.title} onClick={it.go} className="w-full min-w-0 flex items-center gap-3 px-3.5 py-3 text-left active:bg-slate-50">
                  <span className={`w-11 h-11 rounded-xl flex items-center justify-center text-[22px] shrink-0 ${it.tint}`}>{it.icon}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-bold text-slate-800 text-[16px] leading-tight break-words">{it.title}</span>
                    <span className="block text-[13px] text-slate-500 leading-tight mt-0.5 break-words">{it.desc}</span>
                  </span>
                  <span className="shrink-0 text-slate-300 text-xl">›</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

/** Sobre o app (com carinho). */
function AboutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <Sheet open onClose={onClose} title="Sobre">
      <div className="text-center pt-2 pb-4">
        <img src="./icon-192.png" alt="" className="w-20 h-20 rounded-3xl shadow-md mx-auto" />
        <div className="text-2xl font-extrabold text-slate-800 mt-3">Dia a Dia</div>
        <div className="text-sm text-slate-500">versão {APP_VERSION}</div>
        <p className="text-[15px] text-slate-600 mt-3 px-4 leading-relaxed">
          Estoque, vendas e caixa do seu negócio, direto no celular — mesmo sem internet.
        </p>

        <div className="mt-5 mx-2 rounded-3xl bg-gradient-to-br from-pink-50 to-rose-100 border border-pink-200 px-5 py-6">
          <div className="text-4xl animate-heartbeat">💕</div>
          <div className="text-[19px] font-extrabold text-rose-700 mt-2">Feito com amor</div>
          <div className="text-[16px] text-rose-600 mt-0.5">pelo seu amor 🥰</div>
          <div className="text-[13px] text-rose-500/90 mt-3 leading-relaxed">
            Cada botão foi pensado para deixar o seu dia mais leve.<br />Boas vendas! 🌸✨
          </div>
        </div>

        <div className="mt-5 text-[12px] text-slate-400 leading-relaxed px-4">
          🔒 Seus dados ficam só neste celular · 📴 funciona offline
        </div>
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
  const updated = !!error && /APP_ATUALIZADO|dynamically imported module|Loading chunk|Importing a module script failed/i.test(error);
  return (
    <div className="min-h-dvh max-w-md mx-auto flex flex-col justify-center p-6 text-slate-700">
      <div className="text-4xl mb-2">🛠️</div>
      <h1 className="text-xl font-bold">{updated ? 'O app foi atualizado' : error ? 'Não foi possível abrir os dados' : 'O app está demorando para abrir'}</h1>
      <p className="text-sm mt-2">
        Seus dados continuam guardados neste aparelho. Feche outras abas do app e toque em <b>Tentar de novo</b>.
        Se continuar, toque em <b>Atualizar o app</b> (não apaga nada).
      </p>
      {updated && <p className="text-sm mt-2 text-blue-700 font-semibold">Saiu uma versão nova. Toque em <b>Atualizar o app</b> para abrir a versão nova — seus dados ficam guardados.</p>}
      {error && !updated && <p className="text-xs text-red-600 mt-2 break-words">Detalhe: {error}</p>}
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
