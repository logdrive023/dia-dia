/** Ambiente de teste: banco em memória e o que o navegador de teste (jsdom) não tem. */
import 'fake-indexeddb/auto';
import Dexie from 'dexie';

if ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.DEXIE_DEBUG) Dexie.debug = true;

// baixar arquivo (backup/CSV) usa URL.createObjectURL, que o jsdom não implementa
if (typeof URL !== 'undefined' && !URL.createObjectURL) {
  URL.createObjectURL = () => 'blob:teste';
  URL.revokeObjectURL = () => undefined;
}
