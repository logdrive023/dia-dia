import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ensureDailyPay } from './services/cash';
import { autoCloseOldDays } from './services/days';
import { setActor } from './lib/actor';
import { db } from './db/db';
import type { DailyRecord } from './db/types';
import { registerCustomColors, todayStr, uid } from './lib/util';
import { DEFAULT_SETTINGS, getAllSettings, type AppSettings } from './services/settings';
import type { CartLine } from './services/sales';

export type Tab = 'inicio' | 'estoque' | 'vender' | 'caixa' | 'historico';
export type Overlay = null | 'menu' | 'sobre' | 'transferir' | 'cadastro' | 'backup' | 'config' | 'fechar' | 'checkout' | 'comparar' | 'pix' | 'juntar' | 'novidades' | 'movimentos' | 'importar';

interface Ctx {
  date: string;
  setDate: (d: string) => void;
  /** undefined = carregando, null = sem registro para a data */
  day: DailyRecord | null | undefined;
  settings: AppSettings;
  tab: Tab;
  setTab: (t: Tab) => void;
  overlay: Overlay;
  setOverlay: (o: Overlay) => void;
  cart: CartLine[];
  cartId: string;
  addToCart: (variantId: string, price?: number | null) => void;
  setCart: (lines: CartLine[]) => void;
  resetCart: () => void;
  /** virou a data com uma venda no meio: o novo dia espera a venda terminar (data nova) */
  newDayWaiting: string | null;
  /** Histórico de movimentações aberto numa peça (null = todas) */
  historyFor: string | null;
  /** abre o Histórico de movimentações (com uma peça: já mostra a vida dela) */
  openHistory: (variantId?: string | null) => void;
  /** abre o cadastro já em “novo produto” (origem: de qual tela veio) */
  catalogIntent: 'vender' | null;
  openNewProduct: (from: 'vender') => void;
  clearCatalogIntent: () => void;
}

const AppCtx = createContext<Ctx | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [date, setDateRaw] = useState(todayStr());
  const [tab, setTabRaw] = useState<Tab>('inicio');
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartId, setCartId] = useState(uid());
  const day = useLiveQuery(async () => (await db.dailyRecords.where('date').equals(date).first()) ?? null, [date]);
  const settings = useLiveQuery(getAllSettings, []) ?? DEFAULT_SETTINGS;
  setActor(settings.userName); // quem fez cada registro (histórico)
  registerCustomColors(settings.customColors); // nomes das cores criadas pela usuária
  // carrinho nunca fica com peça que não existe mais (recomeçar, restaurar, juntar, peça apagada) nem sem dia
  const variantIds = useLiveQuery(async () => new Set(await db.variants.toCollection().primaryKeys() as string[]), []);
  useEffect(() => {
    if (!variantIds) return;
    setCart((c) => {
      const ok = day ? c.filter((l) => variantIds.has(l.variantId)) : [];
      return ok.length === c.length ? c : ok;
    });
  }, [variantIds, day]);
  // dia aberto sem a diária (ex.: iniciado antes desta versão): lança uma vez só
  useEffect(() => {
    if (day && day.status === 'open') ensureDailyPay(day.id).catch(() => undefined);
  }, [day?.id, day?.status]);

  const setDate = useCallback((d: string) => { setDateRaw(d); setCart([]); setCartId(uid()); }, []);

  // se estava em "hoje" e virou o dia (app aberto de um dia para o outro), segue para o novo hoje
  const lastToday = useRef(todayStr());
  const dateRef = useRef(date);
  dateRef.current = date;
  // venda no meio (peça no carrinho ou fechando a venda): o dia não vira até ela terminar,
  // senão o carrinho sumiria e a venda iria para um dia já encerrado
  const busyRef = useRef(false);
  busyRef.current = cart.length > 0 || overlay === 'checkout';
  const [newDayWaiting, setNewDayWaiting] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [catalogIntent, setCatalogIntent] = useState<'vender' | null>(null);
  const openNewProduct = useCallback((from: 'vender') => { setCatalogIntent(from); setOverlay('cadastro'); }, []);
  const clearCatalogIntent = useCallback(() => setCatalogIntent(null), []);
  const openHistory = useCallback((variantId: string | null = null) => { setHistoryFor(variantId); setOverlay('movimentos'); }, []);
  const checkRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    const check = () => {
      const now = todayStr();
      if (now === lastToday.current) { setNewDayWaiting(null); return; }
      if (busyRef.current) { setNewDayWaiting(now); return; } // termina a venda primeiro (fica no dia em que começou)
      setNewDayWaiting(null);
      autoCloseOldDays(now).catch(() => undefined); // virou a data: o dia de ontem encerra sozinho
      if (dateRef.current === lastToday.current) setDate(now);
      lastToday.current = now;
    };
    checkRef.current = check;
    const id = setInterval(check, 60_000);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', check); window.removeEventListener('focus', check); };
  }, [setDate]);
  // a venda terminou (carrinho vazio e fora do fechar venda): se a data já virou, vira agora
  useEffect(() => { if (!busyRef.current) checkRef.current(); }, [cart.length, overlay]);
  const setTab = useCallback((t: Tab) => { setTabRaw(t); window.scrollTo({ top: 0 }); }, []);
  const addToCart = useCallback((variantId: string, price: number | null = null) => {
    setCart((c) => {
      const i = c.findIndex((l) => l.variantId === variantId && !l.reservationId);
      if (i >= 0) return c.map((l, j) => (j === i ? { ...l, quantity: l.quantity + 1 } : l));
      return [...c, { variantId, quantity: 1, unitPriceInCents: price }];
    });
  }, []);
  const resetCart = useCallback(() => { setCart([]); setCartId(uid()); }, []);

  const value = useMemo(() => ({
    date, setDate, day, settings, tab, setTab, overlay, setOverlay, cart, cartId, addToCart, setCart, resetCart, newDayWaiting, historyFor, openHistory, catalogIntent, openNewProduct, clearCatalogIntent,
  }), [date, setDate, day, settings, tab, setTab, overlay, cart, cartId, addToCart, resetCart, newDayWaiting, historyFor, openHistory, catalogIntent, openNewProduct, clearCatalogIntent]);
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp() {
  const c = useContext(AppCtx);
  if (!c) throw new Error('AppProvider ausente');
  return c;
}
