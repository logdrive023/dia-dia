import { useState } from 'react';
import { buildBackup, decodeTextBackup, encodeTextBackup, markBackupDone, summarizeBackup } from '../services/backup';
import { mergeBackup } from '../services/sync';
import { copyText } from '../services/report';
import { Button, Card, InfoTip, Sheet, useBusy, useUi } from '../components/ui';
import { UndoRestoreCard } from './Transfer';

/**
 * Juntar com outro celular: este celular gera um código com TUDO (texto em base64, com conferência),
 * o outro cola e importa — as vendas, o caixa e o estoque dos dois se somam. Pode repetir quantas vezes quiser.
 */
export default function SyncSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast, confirm, run } = useUi();
  const [busy, wrap] = useBusy();
  const [parts, setParts] = useState<string[] | null>(null);
  const [text, setText] = useState('');
  if (!open) return null;

  // o código tem tudo (é um backup em texto): conta como “último backup” (sem segurar a tela enquanto grava a data)
  const generate = () => wrap(async () => { setParts(await encodeTextBackup(await buildBackup())); markBackupDone().catch(() => undefined); });
  // compartilhar do celular aceita texto grande (link do WhatsApp corta); sem isso, copia
  const send = (p: string, i: number) => wrap(async () => {
    if (navigator.share) {
      try { await navigator.share({ title: `Dia a Dia — juntar celulares${parts!.length > 1 ? ` (parte ${i + 1})` : ''}`, text: p }); return; }
      catch (e) { if ((e as Error).name === 'AbortError') return; }
    }
    toast((await copyText(p)) ? '📋 Copiado: cole no WhatsApp do outro celular' : 'Não foi possível copiar', 'ok');
  });
  const receive = () => wrap(async () => {
    let b;
    try { b = await decodeTextBackup(text); } catch (e) { toast((e as Error).message, 'err'); return; }
    const s = summarizeBackup(b);
    if (!(await confirm({ title: 'Juntar com este celular?', confirm: 'Juntar',
      message: <>Código de <b>{new Date(s.exportedAt).toLocaleString('pt-BR')}</b>: {s.days} dias · {s.orders} vendas.<br /><br />
        As vendas, o caixa e o estoque <b>se somam</b> aos deste celular. O que já existe aqui não duplica. O app guarda uma cópia antes.</> }))) return;
    const r = await run(() => mergeBackup(b));
    if (r) {
      setText('');
      toast(`🔄 Juntou: ${r.orders} vendas novas · ${r.cash} lançamentos · ${r.days} dias novos${r.variants ? ` · ${r.variants} cores novas` : ''}`, 'ok');
      if (r.oversold.length) await confirm({ title: '⚠️ Peça vendida nos dois celulares', confirm: 'Entendi',
        message: <>Os dois celulares venderam a mesma peça e o estoque ficou negativo:<br /><b>{r.oversold.join(', ')}</b><br /><br />Confira a peça e ajuste no Estoque.</> });
    }
  });

  return (
    <Sheet open onClose={() => { setParts(null); onClose(); }} title="🔄 Juntar com outro celular" tall>
      <UndoRestoreCard />
      <div className="flex items-start gap-2 rounded-2xl bg-blue-50 border border-blue-200 p-3 mb-3 text-[13px] text-blue-900">
        <span className="flex-1">Vendeu nos dois celulares? Um gera o código, o outro importa e <b>tudo se soma</b>. Depois faça o caminho de volta para os dois ficarem iguais.</span>
        <InfoTip title="Juntar celulares" example={[
          ['📱', 'Samsung vendeu 3 peças, iPhone vendeu 2'],
          ['📤', <>No Samsung: <b>Gerar código</b> › enviar pelo WhatsApp</>],
          ['📥', <>No iPhone: copiar o código › colar aqui › <b>Juntar</b> → iPhone mostra as 5</>],
          ['🔁', 'Faça o mesmo do iPhone para o Samsung: os dois ficam com as 5'],
          ['✅', 'Importar o mesmo código de novo não duplica nada'],
        ]}>Diferente de “Passar para outro celular”, aqui nada é apagado: os dados se juntam.</InfoTip>
      </div>

      <Card className="p-4">
        <div className="font-bold text-slate-800 text-[17px]">📤 Enviar deste celular</div>
        <p className="text-sm text-slate-600 mt-1">Gera um código com <b>tudo</b> (produtos, estoque, vendas, caixa).</p>
        {!parts ? (
          <Button size="lg" className="w-full mt-3" disabled={busy} onClick={generate}>Gerar código</Button>
        ) : (
          <div className="mt-3 space-y-2">
            {parts.map((p, i) => (
              <div key={i} className="rounded-xl border border-slate-200 p-2.5">
                <div className="text-[12px] text-slate-500 mb-1.5">{parts.length > 1 ? `Parte ${i + 1} de ${parts.length} · ` : ''}{p.length.toLocaleString('pt-BR')} letras</div>
                <div className="font-mono text-[11px] text-slate-400 break-all line-clamp-2 mb-2">{p.slice(0, 160)}…</div>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="success" onClick={() => send(p, i)}>📤 Enviar</Button>
                  <Button variant="outline" onClick={async () => toast((await copyText(p)) ? '📋 Código copiado' : 'Não foi possível copiar', 'ok')}>📋 Copiar</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="text-center text-slate-400 my-2">↓</div>

      <Card className="p-4">
        <div className="font-bold text-slate-800 text-[17px]">📥 Receber do outro celular</div>
        <p className="text-sm text-slate-600 mt-1">Copie o código que chegou (todas as partes) e cole aqui.</p>
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Cole aqui o código (começa com ESTOQUE_BACKUP_V1)"
          className="w-full h-28 mt-2 p-3 rounded-xl border border-slate-300 text-base font-mono outline-none focus:border-blue-500" />
        <Button size="lg" variant="success" className="w-full mt-2" disabled={!text.trim() || busy} onClick={receive}>🔄 Juntar</Button>
      </Card>
    </Sheet>
  );
}
