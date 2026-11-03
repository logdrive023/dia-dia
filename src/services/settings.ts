import { db } from '../db/db';
import { uid, nowIso } from '../lib/util';
import type { PaymentMethod } from '../db/types';

export interface SellEntry {
  groupId?: string;
  /** Grupo pedido em "Para vender" que ainda não foi cadastrado (ex.: Broche Rey). */
  pendingName?: string;
  highlight: boolean;
}

export interface AppSettings {
  sellGroups: SellEntry[];
  currencySymbol: string;
  paymentMethods: PaymentMethod[];
  defaultPayment: PaymentMethod;
  lastBackupAt: string | null;
  backupReminderDays: number;
  reportTitle: string;
  /** relatório do WhatsApp mostra o estoque de agora, cor por cor */
  reportShowStock: boolean;
  /** em “Precisa repor”, mostrar “(tem 14 de 15)” */
  reportRestockDetail: boolean;
  /** no “Estoque agora”, cada cor com “começou X → terminou Y” */
  reportStockStartEnd: boolean;
  /** no fim da mensagem: totais (estoque, repor, começo → final) */
  reportTotals: boolean;
  /** linha de divisão entre os grupos na mensagem */
  reportDividers: boolean;
  /** mensagem maior que o link do WhatsApp: mandar em partes (parte 1, volta, parte 2) */
  reportSplit: boolean;
  /** Diária de quem vende (centavos). Sugestão ao lançar “Pagamento”. */
  dailyPayInCents: number;
  /** Ao iniciar o dia, já lança a diária daquele dia. */
  autoDailyPay: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  sellGroups: [],
  currencySymbol: '',
  paymentMethods: ['dinheiro', 'pix', 'cartao', 'debito'],
  defaultPayment: 'dinheiro',
  lastBackupAt: null,
  backupReminderDays: 7,
  reportTitle: 'Check List',
  reportShowStock: true,
  reportRestockDetail: false,
  reportStockStartEnd: true,
  reportTotals: true,
  reportDividers: true,
  reportSplit: true,
  dailyPayInCents: 15000,
  autoDailyPay: true,
};

export async function getSetting<K extends keyof AppSettings>(key: K): Promise<AppSettings[K]> {
  const row = await db.settings.where('key').equals(key).first();
  return (row?.value as AppSettings[K]) ?? DEFAULT_SETTINGS[key];
}

/** marca de quando as chaves da mensagem (report…) mudaram: no Juntar, vale a do celular que mudou por último */
export const REPORT_PREFS_AT = 'reportPrefsAt';

export async function setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
  await db.transaction('rw', db.settings, async () => {
    const put = async (k: string, v: unknown) => {
      const row = await db.settings.where('key').equals(k).first();
      if (row) await db.settings.update(row.id, { value: v });
      else await db.settings.add({ id: uid(), key: k, value: v });
    };
    await put(key, value);
    if (String(key).startsWith('report')) await put(REPORT_PREFS_AT, nowIso());
  });
}

export async function getAllSettings(): Promise<AppSettings> {
  const rows = await db.settings.toArray();
  const out: AppSettings = { ...DEFAULT_SETTINGS };
  for (const r of rows) if (r.key in out) (out as unknown as Record<string, unknown>)[r.key] = r.value;
  return out;
}
