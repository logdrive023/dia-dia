import { db } from '../db/db';
import { nowIso, uid } from '../lib/util';

/**
 * Pede ao navegador para guardar os dados de forma permanente (não apagar quando o celular
 * precisar de espaço, nem o Safari depois de dias sem uso). Celular com o app instalado na tela
 * inicial costuma aceitar na hora (Chrome e Samsung Internet no Android).
 */
export async function requestPersist(): Promise<{ supported: boolean; persisted: boolean }> {
  const st = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  if (!st?.persist || !st.persisted) return { supported: false, persisted: false };
  try {
    if (await st.persisted()) return { supported: true, persisted: true };
    return { supported: true, persisted: await st.persist() };
  } catch {
    return { supported: true, persisted: false };
  }
}

/** Situação do armazenamento: protegido? quanto usa? a gravação funciona? */
export async function storageStatus() {
  const st = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  let persisted = false, usage: number | null = null, quota: number | null = null;
  try { persisted = !!(await st?.persisted?.()); } catch { /* sem suporte */ }
  try { const e = await st?.estimate?.(); usage = e?.usage ?? null; quota = e?.quota ?? null; } catch { /* sem suporte */ }
  return { supported: !!st?.persist, persisted, usage, quota, writeOk: await writeTest() };
}

/** Grava, lê de volta e apaga um registro de teste: confirma que o celular está salvando de verdade. */
export async function writeTest() {
  const id = `teste-gravacao-${uid()}`;
  try {
    await db.settings.add({ id, key: id, value: nowIso() });
    const back = await db.settings.get(id);
    await db.settings.delete(id);
    return !!back;
  } catch {
    return false;
  }
}
