import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { fmtDate, todayStr } from '../lib/util';
import {
  getSafetyCopy, undoLastRestore, readFileText, BackupError, buildBackup, decodeTextBackup, markBackupDone, restoreBackup, shareOrDownloadFile, summarizeBackup, validateBackup,
  type BackupFile,
} from '../services/backup';
import { Button, Card, Sheet, useBusy, useUi } from '../components/ui';

/**
 * Passar para outro celular: um arquivo com TUDO (cadastro, dias, vendas, caixa, histórico).
 * Celular antigo: "Enviar tudo" → compartilhar. Celular novo: "Receber" → escolher o arquivo → confirmar.
 */
export default function TransferSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast, confirm, run } = useUi();
  const [busy, wrap] = useBusy();
  const fileRef = useRef<HTMLInputElement>(null);
  const [paste, setPaste] = useState(false);
  const [text, setText] = useState('');
  const local = useLiveQuery(async () => ({ days: await db.dailyRecords.count(), orders: await db.orders.count() }), []);
  if (!open) return null;

  const send = () => wrap(async () => {
    const b = await buildBackup();
    const r = await shareOrDownloadFile(`dia-dia_passar-para-outro-celular_${todayStr()}.json`, JSON.stringify(b));
    if (r === 'aborted') return;
    await markBackupDone();
    toast(r === 'shared' ? 'Arquivo enviado. Agora abra o app no outro celular.' : 'Arquivo salvo em Downloads. Mande para o outro celular.');
  });

  const receive = async (b: BackupFile) => {
    const s = summarizeBackup(b);
    const hasData = (local?.days ?? 0) > 0;
    const ok = await confirm({
      title: 'Receber estes dados?', tone: hasData ? 'danger' : 'primary', confirm: hasData ? 'Substituir e receber' : 'Receber tudo',
      message: <>
        Arquivo de <b>{new Date(s.exportedAt).toLocaleString('pt-BR')}</b><br />
        {s.groups} grupos · {s.variants} cores/modelos · {s.days} dias
        {s.firstDate && <> ({fmtDate(s.firstDate, false)} a {fmtDate(s.lastDate!, false)})</>} · {s.orders} vendas
        {hasData && <><br /><br /><b>Este celular já tem {local!.days} dia(s) e {local!.orders} venda(s). Eles serão trocados pelos do arquivo.</b></>}
      </>,
    });
    if (!ok) return;
    const r = await run(() => restoreBackup(b), 'Pronto! Tudo foi recebido.');
    if (r) { onClose(); setTimeout(() => location.reload(), 700); }
  };

  const fromFile = (f: File) => wrap(async () => {
    try {
      const raw = await readFileText(f);
      // aceita o arquivo .json e também um .txt com o backup em texto
      const b = raw.trimStart().startsWith('{') ? validateBackup(JSON.parse(raw)) : await decodeTextBackup(raw);
      await receive(b);
    } catch (e) {
      toast(e instanceof SyntaxError ? 'Este arquivo não é do app Dia a Dia.' : e instanceof BackupError ? e.message : 'Não foi possível ler o arquivo.', 'err');
    }
  });

  return (
    <Sheet open onClose={onClose} title="📲 Passar para outro celular" tall>
      <UndoRestoreCard />
      <Card className="p-4">
        <div className="font-bold text-slate-800 text-[17px]">1. No celular antigo</div>
        <p className="text-sm text-slate-600 mt-1">Gera um arquivo com <b>tudo</b>: produtos, estoque de todos os dias, vendas, caixa e histórico.</p>
        <Button size="lg" className="w-full mt-3" disabled={busy} onClick={send}>📤 Enviar tudo</Button>
        <p className="text-xs text-slate-500 mt-2">Escolha WhatsApp (para você mesma ou para o outro número), AirDrop ou e-mail.</p>
      </Card>

      <div className="text-center text-slate-400 my-2">↓</div>

      <Card className="p-4">
        <div className="font-bold text-slate-800 text-[17px]">2. No celular novo</div>
        <p className="text-sm text-slate-600 mt-1">Abra este app, toque abaixo e escolha o arquivo recebido.</p>
        <Button size="lg" variant="success" className="w-full mt-3" disabled={busy} onClick={() => fileRef.current?.click()}>📥 Receber (escolher arquivo)</Button>
        <input ref={fileRef} type="file" accept=".json,application/json,.txt,text/plain" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) fromFile(f); e.target.value = ''; }} />
        <div className="text-xs text-slate-500 mt-2 space-y-1">
          <p><b>iPhone:</b> no WhatsApp, toque no arquivo › Compartilhar › <b>Salvar em Arquivos</b>. Depois escolha ele aqui.</p>
          <p><b>Android:</b> o arquivo fica em Downloads (ou na pasta do WhatsApp).</p>
        </div>
        {!paste ? (
          <button className="text-xs text-slate-500 underline mt-3" onClick={() => setPaste(true)}>Recebeu em texto (ESTOQUE_BACKUP_V1)? Colar aqui</button>
        ) : (
          <div className="mt-3">
            <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Cole aqui todas as partes"
              className="w-full h-24 p-3 rounded-xl border border-slate-300 text-base font-mono outline-none focus:border-blue-500" />
            <Button variant="outline" className="w-full mt-1" disabled={!text.trim() || busy}
              onClick={() => wrap(async () => { try { await receive(await decodeTextBackup(text)); } catch (e) { toast((e as Error).message, 'err'); } })}>
              Receber pelo texto
            </Button>
          </div>
        )}
      </Card>
      <p className="text-xs text-slate-400 text-center mt-4">O arquivo é conferido antes. Se estiver incompleto, nada muda no celular novo.</p>
    </Sheet>
  );
}

function UndoRestoreCard() {
  const { run, confirm } = useUi();
  const saved = useLiveQuery(() => getSafetyCopy(), []);
  if (!saved) return null;
  return (
    <Card className="p-3 mb-3 border-amber-200 bg-amber-50">
      <div className="text-[14px] text-amber-900">
        <b>Recebeu ou restaurou e se arrependeu?</b> O app guardou como estava em {new Date(saved.createdAt).toLocaleString('pt-BR')} ({saved.summary}).
      </div>
      <Button variant="outline" className="w-full mt-2" onClick={async () => {
        if (await confirm({ title: 'Voltar como estava?', confirm: 'Voltar', message: 'Os dados de agora ficam guardados no lugar, então dá para refazer depois se mudar de ideia.' })) {
          const r = await run(() => undoLastRestore(), 'Voltou como estava');
          if (r) setTimeout(() => location.reload(), 600);
        }
      }}>↩ Voltar como estava antes</Button>
    </Card>
  );
}
