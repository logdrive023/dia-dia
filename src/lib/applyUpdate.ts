/**
 * Botão “Atualizar”: ativa a versão nova e recarrega — sempre.
 * O recarregar do plugin só acontece no evento “controlling” de atualização, que não chega quando a
 * página não está sob o service worker (Ctrl+Shift+R no computador) ou quando a versão nova foi
 * baixada por outra aba. Aqui: recarrega quando a nova ativa, quando troca o controle ou, no máximo, em 4 s.
 */
export async function applyUpdate(deps: {
  sw?: ServiceWorkerContainer | undefined;
  reload?: () => void;
  timeoutMs?: number;
} = {}) {
  const sw = 'sw' in deps ? deps.sw : (typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined);
  const reload = deps.reload ?? (() => location.reload());
  let done = false;
  const go = () => { if (!done) { done = true; reload(); } };
  try {
    const reg = await sw?.getRegistration();
    const waiting = reg?.waiting;
    // sem versão esperando (outra aba já ativou, ou não há service worker): só recarrega
    if (!sw || !waiting) { go(); return 'reload'; }
    sw.addEventListener('controllerchange', go);
    waiting.addEventListener('statechange', () => { if (waiting.state === 'activated') go(); });
    waiting.postMessage({ type: 'SKIP_WAITING' });
    setTimeout(go, deps.timeoutMs ?? 4000);
    return 'activating';
  } catch {
    go();
    return 'reload';
  }
}
