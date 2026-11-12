import { db } from '../db/db';
import { nowIso, uid } from '../lib/util';
import { setSetting } from './settings';

export const BACKUP_FORMAT = 'ESTOQUE_BACKUP';
export const BACKUP_VERSION = 1;
export const TEXT_HEADER = 'ESTOQUE_BACKUP_V1';

const REQUIRED = [
  'groups', 'variants', 'categories', 'dailyRecords', 'dailyStockItems', 'stockMovements', 'orders',
  'sales', 'reservations', 'cashRecords', 'cashMovements', 'settings', 'auditLogs',
] as const;
/** tabelas que vieram depois: backup antigo não tem (vira lista vazia); app antigo ignora */
const OPTIONAL = ['imports', 'credits'] as const;
const TABLES = [...REQUIRED, ...OPTIONAL] as const;
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

export class BackupError extends Error { name = 'BackupError'; }

export function validateBackup(raw: unknown): BackupFile {
  const orig = raw as BackupFile;
  if (!orig || typeof orig !== 'object' || orig.format !== BACKUP_FORMAT) throw new BackupError('Arquivo não é um backup deste aplicativo.');
  if (typeof orig.version !== 'number' || orig.version > BACKUP_VERSION) throw new BackupError(`Versão de backup não suportada (${orig.version}).`);
  if (!orig.data || typeof orig.data !== 'object') throw new BackupError('Backup sem dados.');
  // conferência: os dados como vieram; backup antigo conferido de novo já com as tabelas opcionais vazias também vale
  if (orig.checksum && checksum(JSON.stringify(orig.data)) !== orig.checksum) {
    // backup conferido antes de existir alguma tabela opcional: tenta sem cada combinação das opcionais vazias
    const empty = (OPTIONAL as readonly string[]).filter((k) => Array.isArray(orig.data[k as TableName]) && !orig.data[k as TableName].length);
    let ok = false;
    for (let mask = 1; mask < 1 << empty.length && !ok; mask++) {
      const drop = new Set(empty.filter((_, i) => mask & (1 << i)));
      const without = Object.fromEntries(Object.entries(orig.data).filter(([k]) => !drop.has(k)));
      ok = checksum(JSON.stringify(without)) === orig.checksum;
    }
    if (!ok) throw new BackupError('Backup corrompido (verificação falhou).');
  }
  // cópia completada (o objeto recebido não muda)
  const b: BackupFile = { ...orig, data: { ...orig.data } };
  for (const t of OPTIONAL) if (b.data[t] === undefined) b.data[t] = [];
  for (const t of TABLES) {
    if (!Array.isArray(b.data[t])) throw new BackupError(`Backup incompleto: falta "${t}".`);
    if (b.counts && b.counts[t] !== undefined && b.counts[t] !== b.data[t].length) throw new BackupError(`Quantidade de registros não confere em "${t}".`);
    const ids = new Set<string>();
    for (const r of b.data[t]) {
      if (!r || typeof r.id !== 'string') throw new BackupError(`Registro sem identificador em "${t}".`);
      if (ids.has(r.id as string)) throw new BackupError(`Identificador duplicado em "${t}".`);
      ids.add(r.id as string);
    }
  }
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
    if (typeof d.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d.date)) throw new BackupError('Data inválida no backup.');
    if (dates.has(d.date as string)) throw new BackupError(`Data duplicada: ${d.date}.`);
    dates.add(d.date as string);
  }
  const unique = (t: TableName, key: (r: Record<string, unknown>) => string, msg: string) => {
    const seen = new Set<string>();
    for (const r of b.data[t]) { const k = key(r); if (seen.has(k)) throw new BackupError(msg); seen.add(k); }
  };
  unique('dailyStockItems', (r) => `${r.dailyRecordId}|${r.variantId}`, 'Estoque repetido para a mesma peça no mesmo dia.');
  unique('settings', (r) => String(r.key), 'Configuração repetida no backup.');
  unique('cashRecords', (r) => String(r.dailyRecordId), 'Caixa repetido para o mesmo dia.');
  for (const i of b.data.dailyStockItems)
    if (!Number.isInteger(i.currentQuantity) || !Number.isInteger(i.initialQuantity)) throw new BackupError('Quantidade inválida no backup.');
  for (const c of b.data.cashMovements)
    if (!Number.isInteger(c.amountInCents)) throw new BackupError('Valor inválido no backup.');
  return b;
}

/** Substitui todos os dados locais pelo backup, em uma única transação (falhou = nada muda). */
/** O que já existe neste celular vale guardar antes de trocar? */
async function hasLocalData() {
  return (await db.dailyRecords.count()) > 0 || (await db.auditLogs.count()) > 0;
}

export async function getSafetyCopy() {
  return db.safety.get('last');
}

/**
 * Substitui todos os dados locais pelo backup, em uma única transação (falhou = nada muda).
 * Antes, guarda uma cópia do que havia: dá para voltar atrás com undoLastRestore().
 */
export async function restoreBackup(raw: unknown, opts: { keepSafety?: boolean } = { keepSafety: true }) {
  const b = validateBackup(raw);
  if (opts.keepSafety && await hasLocalData()) {
    const current = await buildBackup();
    const s = summarizeBackup(current);
    await db.safety.put({ id: 'last', createdAt: nowIso(), json: JSON.stringify(current),
      summary: `${s.days} dia(s) · ${s.orders} venda(s) · ${s.variants} cores/modelos` });
  }
  try {
    await db.transaction('rw', db.allTables, async () => {
      for (const t of TABLES) await db.table(t).clear();
      for (const t of TABLES) await db.table(t).bulkAdd(b.data[t]);
    });
  } catch (e) {
    // a transação desfaz tudo: os dados atuais continuam como estavam
    throw new BackupError(`Não foi possível restaurar; nada foi alterado. (${(e as Error).name})`);
  }
  return b;
}

/** Volta como estava antes do último recebimento/restauração (e guarda o atual, para dar para refazer). */
export async function undoLastRestore() {
  const saved = await db.safety.get('last');
  if (!saved) throw new BackupError('Não há nada para desfazer.');
  return restoreBackup(JSON.parse(saved.json), { keepSafety: true });
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

/** gzip quando o navegador oferece (Chrome, Safari 16.4+, Node 18+); senão texto puro. */
async function gzip(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    if (typeof CompressionStream === 'undefined' || typeof Blob.prototype.stream !== 'function') return null;
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null; // navegador sem compressão: vai em texto puro (continua válido, só maior)
  }
}
async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined' || typeof Blob.prototype.stream !== 'function')
    throw new BackupError('Este navegador não consegue abrir backup comprimido. Use o backup em arquivo ou atualize o navegador.');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
const bytesToB64 = (bytes: Uint8Array) => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const b64ToBytes = (b: string) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));

/**
 * Formato (uma ou mais partes):
 *   ESTOQUE_BACKUP_V1 <id> <parte>/<total> <checksum-da-parte> <checksum-total> [gz]
 *   <base64>
 *   FIM <id> <parte>/<total>
 * "gz" = conteúdo comprimido (backups antigos, sem "gz", continuam sendo lidos).
 */
// 60 mil caracteres por parte: cabe numa mensagem do WhatsApp (limite ~65 mil)
export async function encodeTextBackup(b: BackupFile, partSize = 60000): Promise<string[]> {
  const raw = new TextEncoder().encode(JSON.stringify(b));
  const z = await gzip(raw);
  const payload = z ? bytesToB64(z) : toBase64(JSON.stringify(b));
  const flag = z ? ' gz' : '';
  const total = Math.max(1, Math.ceil(payload.length / partSize));
  const id = checksum(payload + b.exportedAt).slice(0, 6);
  const all = checksum(payload);
  const parts: string[] = [];
  for (let i = 0; i < total; i++) {
    const chunk = payload.slice(i * partSize, (i + 1) * partSize);
    parts.push(`${TEXT_HEADER} ${id} ${i + 1}/${total} ${checksum(chunk)} ${all}${flag}\n${chunk}\nFIM ${id} ${i + 1}/${total}`);
  }
  return parts;
}

export async function decodeTextBackup(text: string): Promise<BackupFile> {
  const re = new RegExp(`${TEXT_HEADER} (\\w+) (\\d+)/(\\d+) ([0-9a-f]{8}) ([0-9a-f]{8})( gz)?\\s+([A-Za-z0-9+/=\\s]+?)\\s*FIM \\1 \\2/\\3`, 'g');
  const found = new Map<number, string>();
  let id: string | null = null, total = 0, all = '', gz = false;
  for (const m of text.matchAll(re)) {
    if (id && m[1] !== id) throw new BackupError('As partes coladas são de backups diferentes.');
    id = m[1]; total = Number(m[3]); all = m[5]; gz = !!m[6];
    const chunk = m[7].replace(/\s/g, '');
    if (checksum(chunk) !== m[4]) throw new BackupError(`A parte ${m[2]} está corrompida ou incompleta.`);
    found.set(Number(m[2]), chunk);
  }
  if (!id) throw new BackupError(`Texto não reconhecido. Ele deve começar com ${TEXT_HEADER}.`);
  if (total < 1 || total > 10000) throw new BackupError('Cabeçalho do backup inválido.');
  const missing = [];
  for (let i = 1; i <= total; i++) if (!found.has(i)) missing.push(i);
  if (missing.length) throw new BackupError(`Faltam partes: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? '…' : ''} de ${total}.`);
  const payload = Array.from({ length: total }, (_, i) => found.get(i + 1)).join('');
  if (checksum(payload) !== all) throw new BackupError('O backup em texto não confere. Copie as partes novamente.');
  let json: unknown;
  try {
    json = JSON.parse(gz ? new TextDecoder().decode(await gunzip(b64ToBytes(payload))) : fromBase64(payload));
  } catch (e) {
    if (e instanceof BackupError) throw e;
    throw new BackupError('Conteúdo do backup ilegível.');
  }
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

/** Lê o arquivo escolhido como texto (FileReader como reserva para celulares mais antigos). */
export function readFileText(f: Blob): Promise<string> {
  if (typeof f.text === 'function') return f.text();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(r.error ?? new Error('Falha ao ler o arquivo'));
    r.readAsText(f);
  });
}

/**
 * Apaga tudo e volta aos dados padrão (o celular principal até 04/11: cadastro, estoque, vendas e caixa).
 * Antes guarda uma cópia: dá para “voltar como estava”.
 */
export async function resetToInitialData() {
  const { loadDefaultData } = await import('../db/seed');
  await saveSafetyAndClear();
  await loadDefaultData();
}

/**
 * Apaga tudo e deixa o app vazio: sem grupos, sem cores, sem dias, caixa em 0, configurações padrão.
 * Marca como “já preparado” para os dados iniciais não voltarem sozinhos ao abrir o app.
 * Antes guarda uma cópia: dá para “voltar como estava”.
 */
export async function resetToZero() {
  await saveSafetyAndClear();
  const now = nowIso();
  await db.settings.bulkAdd([
    { id: uid(), key: 'seedDone', value: `zerado ${now}` },
    { id: uid(), key: 'forSaleDefaults', value: `zerado ${now}` },
  ]);
}

/** Guarda a cópia de segurança (se houver dados) e limpa todas as tabelas. */
async function saveSafetyAndClear() {
  if (await hasLocalData()) {
    const current = await buildBackup();
    const s = summarizeBackup(current);
    await db.safety.put({ id: 'last', createdAt: nowIso(), json: JSON.stringify(current),
      summary: `${s.days} dia(s) · ${s.orders} venda(s) · ${s.variants} cores/modelos` });
  }
  await db.transaction('rw', db.allTables, async () => {
    for (const t of TABLES) await db.table(t).clear();
  });
}
