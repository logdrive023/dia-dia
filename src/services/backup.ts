import { db } from '../db/db';
import { nowIso } from '../lib/util';
import { setSetting } from './settings';

export const BACKUP_FORMAT = 'ESTOQUE_BACKUP';
export const BACKUP_VERSION = 1;
export const TEXT_HEADER = 'ESTOQUE_BACKUP_V1';

const TABLES = [
  'groups', 'variants', 'categories', 'dailyRecords', 'dailyStockItems', 'stockMovements', 'orders',
  'sales', 'reservations', 'cashRecords', 'cashMovements', 'settings', 'auditLogs',
] as const;
type TableName = (typeof TABLES)[number];

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  schemaVersion: number;
  exportedAt: string;
  app: string;
  counts: Record<TableName, number>;
  checksum: string;
  data: Record<TableName, Record<string, unknown>[]>;
}

/** FNV-1a 32 bits — suficiente para detectar texto cortado ou corrompido. */
export function checksum(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export async function buildBackup(): Promise<BackupFile> {
  const data = {} as BackupFile['data'];
  await db.transaction('r', db.allTables, async () => {
    for (const t of TABLES) data[t] = (await db.table(t).toArray()) as Record<string, unknown>[];
  });
  const counts = Object.fromEntries(TABLES.map((t) => [t, data[t].length])) as BackupFile['counts'];
  return {
    format: BACKUP_FORMAT, version: BACKUP_VERSION, schemaVersion: db.verno, exportedAt: nowIso(), app: 'dia-dia',
    counts, checksum: checksum(JSON.stringify(data)), data,
  };
}

export function backupFileName(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `backup_estoque_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}.json`;
}

// ---------------- validação ----------------

export class BackupError extends Error {}

export function validateBackup(raw: unknown): BackupFile {
  const b = raw as BackupFile;
  if (!b || typeof b !== 'object' || b.format !== BACKUP_FORMAT) throw new BackupError('Arquivo não é um backup deste aplicativo.');
  if (typeof b.version !== 'number' || b.version > BACKUP_VERSION) throw new BackupError(`Versão de backup não suportada (${b.version}).`);
  if (!b.data || typeof b.data !== 'object') throw new BackupError('Backup sem dados.');
  for (const t of TABLES) {
    if (!Array.isArray(b.data[t])) throw new BackupError(`Backup incompleto: falta "${t}".`);
    if (b.counts && b.counts[t] !== b.data[t].length) throw new BackupError(`Quantidade de registros não confere em "${t}".`);
    const ids = new Set<string>();
    for (const r of b.data[t]) {
      if (!r || typeof r.id !== 'string') throw new BackupError(`Registro sem identificador em "${t}".`);
      if (ids.has(r.id as string)) throw new BackupError(`Identificador duplicado em "${t}".`);
      ids.add(r.id as string);
    }
  }
  if (b.checksum && checksum(JSON.stringify(b.data)) !== b.checksum) throw new BackupError('Backup corrompido (verificação falhou).');

  const ids = (t: TableName) => new Set(b.data[t].map((r) => r.id as string));
  const groups = ids('groups'), variants = ids('variants'), days = ids('dailyRecords'), orders = ids('orders');
  const check = (t: TableName, field: string, set: Set<string>, optional = false) => {
    for (const r of b.data[t]) {
      const v = r[field] as string | null | undefined;
      if ((v === null || v === undefined) && optional) continue;
      if (!set.has(v as string)) throw new BackupError(`Relacionamento inválido: ${t}.${field}.`);
    }
  };
  check('variants', 'groupId', groups);
  check('dailyStockItems', 'dailyRecordId', days);
  check('dailyStockItems', 'variantId', variants);
  check('stockMovements', 'dailyRecordId', days);
  check('stockMovements', 'variantId', variants);
  check('orders', 'dailyRecordId', days);
  check('sales', 'orderId', orders);
  check('sales', 'variantId', variants);
  check('reservations', 'variantId', variants);
  check('cashRecords', 'dailyRecordId', days);
  check('cashMovements', 'dailyRecordId', days);
  const dates = new Set<string>();
  for (const d of b.data.dailyRecords) {
    if (dates.has(d.date as string)) throw new BackupError(`Data duplicada: ${d.date}.`);
    dates.add(d.date as string);
  }
  return b;
}

/** Substitui todos os dados locais pelo backup, em uma única transação (falhou = nada muda). */
export async function restoreBackup(raw: unknown) {
  const b = validateBackup(raw);
  await db.transaction('rw', db.allTables, async () => {
    for (const t of TABLES) await db.table(t).clear();
    for (const t of TABLES) await db.table(t).bulkAdd(b.data[t]);
  });
  return b;
}

export function summarizeBackup(b: BackupFile) {
  const dates = b.data.dailyRecords.map((d) => d.date as string).sort();
  return {
    exportedAt: b.exportedAt,
    groups: b.data.groups.length,
    variants: b.data.variants.length,
    days: dates.length,
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
    orders: b.data.orders.length,
    movements: b.data.stockMovements.length,
  };
}

export async function markBackupDone() {
  await setSetting('lastBackupAt', nowIso());
}

// ---------------- backup em texto ----------------

function toBase64(s: string) {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function fromBase64(b: string) {
  const bin = atob(b);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/**
 * Formato (uma ou mais partes):
 *   ESTOQUE_BACKUP_V1 <id> <parte>/<total> <checksum-da-parte> <checksum-total>
 *   <base64>
 *   FIM <id> <parte>/<total>
 */
export function encodeTextBackup(b: BackupFile, partSize = 30000): string[] {
  const payload = toBase64(JSON.stringify(b));
  const total = Math.max(1, Math.ceil(payload.length / partSize));
  const id = checksum(payload + b.exportedAt).slice(0, 6);
  const all = checksum(payload);
  const parts: string[] = [];
  for (let i = 0; i < total; i++) {
    const chunk = payload.slice(i * partSize, (i + 1) * partSize);
    parts.push(`${TEXT_HEADER} ${id} ${i + 1}/${total} ${checksum(chunk)} ${all}\n${chunk}\nFIM ${id} ${i + 1}/${total}`);
  }
  return parts;
}

export function decodeTextBackup(text: string): BackupFile {
  const re = new RegExp(`${TEXT_HEADER} (\\w+) (\\d+)/(\\d+) ([0-9a-f]{8}) ([0-9a-f]{8})\\s+([A-Za-z0-9+/=\\s]+?)\\s*FIM \\1 \\2/\\3`, 'g');
  const found = new Map<number, string>();
  let id: string | null = null, total = 0, all = '';
  for (const m of text.matchAll(re)) {
    if (id && m[1] !== id) throw new BackupError('As partes coladas são de backups diferentes.');
    id = m[1]; total = Number(m[3]); all = m[5];
    const chunk = m[6].replace(/\s/g, '');
    if (checksum(chunk) !== m[4]) throw new BackupError(`A parte ${m[2]} está corrompida ou incompleta.`);
    found.set(Number(m[2]), chunk);
  }
  if (!id) throw new BackupError(`Texto não reconhecido. Ele deve começar com ${TEXT_HEADER}.`);
  const missing = [];
  for (let i = 1; i <= total; i++) if (!found.has(i)) missing.push(i);
  if (missing.length) throw new BackupError(`Faltam partes: ${missing.join(', ')} de ${total}.`);
  const payload = Array.from({ length: total }, (_, i) => found.get(i + 1)).join('');
  if (checksum(payload) !== all) throw new BackupError('O backup em texto não confere. Copie as partes novamente.');
  let json: unknown;
  try { json = JSON.parse(fromBase64(payload)); } catch { throw new BackupError('Conteúdo do backup ilegível.'); }
  return validateBackup(json);
}

export function downloadFile(name: string, content: string, type = 'application/json') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Tenta usar o compartilhamento nativo do celular com o arquivo; senão baixa. */
export async function shareOrDownloadFile(name: string, content: string, type = 'application/json') {
  try {
    const file = new File([content], name, { type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      return 'shared';
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return 'aborted';
  }
  downloadFile(name, content, type);
  return 'downloaded';
}
