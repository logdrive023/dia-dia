import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ensureDailyPay } from './services/cash';
import { db } from './db/db';
import type { DailyRecord } from './db/types';
import { todayStr, uid } from './lib/util';
import { DEFAULT_SETTINGS, getAllSettings, type AppSettings } from './services/settings';
import type { CartLine } from './services/sales';

export type Tab = 'inicio' | 'estoque' | 'vender' | 'caixa' | 'historico';
export type Overlay = null | 'menu' | 'sobre' | 'transferir' | 'cadastro' | 'backup' | 'config' | 'fechar' | 'checkout' | 'comparar';

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
  // dia aberto sem a diária (ex.: iniciado antes desta versão): lança uma vez só
  useEffect(() => {
    if (day && day.status === 'open') ensureDailyPay(day.id).catch(() => undefined);
  }, [day?.id, day?.status]);

  const setDate = useCallback((d: string) => { setDateRaw(d); setCart([]); setCartId(uid()); }, []);

  // se estava em "hoje" e virou o dia (app aberto de um dia para o outro), segue para o novo hoje
  const lastToday = useRef(todayStr());
  const dateRef = useRef(date);
  dateRef.current = date;
  useEffect(() => {
    const check = () => {
      const now = todayStr();
      if (now === lastToday.current) return;
      if (dateRef.current === lastToday.current) setDate(now);
      lastToday.current = now;
    };
    const id = setInterval(check, 60_000);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', check); window.removeEventListener('focus', check); };
  }, [setDate]);
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
    date, setDate, day, settings, tab, setTab, overlay, setOverlay, cart, cartId, addToCart, setCart, resetCart,
  }), [date, setDate, day, settings, tab, setTab, overlay, cart, cartId, addToCart, resetCart]);
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp() {
  const c = useContext(AppCtx);
  if (!c) throw new Error('AppProvider ausente');
  return c;
}
