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

const TIMEOUT = Symbol('timeout');
/** Espera no máximo `ms`; se não respondeu, devolve TIMEOUT (a operação original continua sozinha). */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMEOUT> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve(TIMEOUT), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/** Situação do armazenamento: protegido? quanto usa? a gravação funciona? (nunca fica preso em “Conferindo…”) */
export async function storageStatus() {
  const st = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  let persisted = false, usage: number | null = null, quota: number | null = null;
  try { const p = await withTimeout(Promise.resolve(st?.persisted?.()), 3000); persisted = p !== TIMEOUT && !!p; } catch { /* sem suporte */ }
  try {
    const e = await withTimeout(Promise.resolve(st?.estimate?.()), 3000);
    if (e !== TIMEOUT) { usage = e?.usage ?? null; quota = e?.quota ?? null; }
  } catch { /* sem suporte */ }
  const w = await dbResponds();
  return { supported: !!st?.persist, persisted, usage, quota, writeOk: w === 'ok', busy: w === 'busy' };
}

/**
 * O banco está respondendo? 'busy' = a gravação ficou esperando: outra janela do app (o app instalado
 * e uma aba do Chrome, ou uma janela antiga em segundo plano) está segurando os dados.
 */
export async function dbResponds(ms = 4000): Promise<'ok' | 'busy' | 'fail'> {
  const r = await withTimeout(writeTest(), ms);
  return r === TIMEOUT ? 'busy' : r ? 'ok' : 'fail';
}

export const BUSY_MESSAGE =
  'O app está aberto em outra janela que está segurando os dados (por exemplo, o app instalado e também uma aba do Chrome). ' +
  'Feche todas as janelas do app (botão de janelas abertas do celular → arrastar para fechar) e abra só uma. Nada foi apagado.';

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
