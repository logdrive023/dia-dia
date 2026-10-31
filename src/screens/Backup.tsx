import { useRef, useState } from 'react';
import { fmtDate, todayStr } from '../lib/util';
import {
  backupFileName, buildBackup, decodeTextBackup, encodeTextBackup, markBackupDone, restoreBackup, shareOrDownloadFile,
  summarizeBackup, validateBackup, type BackupFile,
} from '../services/backup';
import { buildCsv, type CsvKind } from '../services/csv';
import { copyText } from '../services/report';
import { useApp } from '../state';
import { Button, Card, SectionTitle, Sheet, useBusy, useUi } from '../components/ui';

export default function BackupSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings, day } = useApp();
  const { run, toast, confirm } = useUi();
  const [busy, wrap] = useBusy();
  const [parts, setParts] = useState<string[] | null>(null);
  const [pasted, setPasted] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  if (!open) return null;

  const genFile = () => wrap(async () => {
    const b = await buildBackup();
    const r = await shareOrDownloadFile(backupFileName(), JSON.stringify(b, null, 1));
    if (r !== 'aborted') { await markBackupDone(); toast(r === 'shared' ? 'Backup compartilhado' : 'Backup salvo em Downloads'); }
  });
  const genText = () => wrap(async () => {
    const b = await buildBackup();
    setParts(encodeTextBackup(b));
    await markBackupDone();
  });
  const askRestore = async (b: BackupFile) => {
    const s = summarizeBackup(b);
    const ok = await confirm({
      title: 'Restaurar este backup?', tone: 'danger', confirm: 'Substituir tudo',
      message: <>
        Feito em <b>{new Date(s.exportedAt).toLocaleString('pt-BR')}</b><br />
        {s.groups} grupos · {s.variants} variações · {s.days} dias{s.firstDate && <> ({fmtDate(s.firstDate, false)} a {fmtDate(s.lastDate!, false)})</>} · {s.orders} vendas<br /><br />
        <b>Todos os dados atuais deste aparelho serão substituídos.</b>
      </>,
    });
    if (ok) {
      const r = await run(() => restoreBackup(b), 'Backup restaurado!');
      if (r) { setPasted(''); onClose(); }
    }
  };
  const fromFile = async (f: File) => {
    try {
      const b = validateBackup(JSON.parse(await f.text()));
      askRestore(b);
    } catch (e) { toast(e instanceof SyntaxError ? 'Arquivo não é um JSON válido.' : (e as Error).message, 'err'); }
  };
  const fromText = () => {
    try { askRestore(decodeTextBackup(pasted)); } catch (e) { toast((e as Error).message, 'err'); }
  };
  const csv = (k: CsvKind) => wrap(async () => {
    const content = await buildCsv(k, k === 'estoque' ? day?.id : undefined);
    await shareOrDownloadFile(`${k}_${k === 'estoque' && day ? day.date : todayStr()}.csv`, content, 'text/csv');
  });

  return (
    <Sheet open onClose={onClose} title="💾 Backup e restauração" tall>
      <Card className="p-3 bg-orange-50 border-orange-200 text-sm text-orange-900">
        Os dados ficam <b>só neste aparelho</b>. Podem ser perdidos se o navegador for limpo, o app desinstalado ou o celular perdido.
        Faça backup com frequência e guarde no WhatsApp, e-mail ou Drive.
        <div className="mt-1 font-semibold">Último backup: {settings.lastBackupAt ? new Date(settings.lastBackupAt).toLocaleString('pt-BR') : 'nunca'}</div>
      </Card>

      <SectionTitle>Gerar backup</SectionTitle>
      <div className="grid grid-cols-2 gap-2">
        <Button disabled={busy} onClick={genFile}>📁 Arquivo</Button>
        <Button variant="outline" disabled={busy} onClick={genText}>💬 Texto</Button>
      </div>
      <p className="text-xs text-slate-500 mt-1.5">Arquivo .json com tudo (cadastro, dias, vendas, caixa, histórico). O texto pode ser colado numa conversa do WhatsApp com você mesmo.</p>

      {parts && (
        <Card className="p-3 mt-3">
          <div className="font-semibold text-slate-700 mb-2">Backup em texto · {parts.length} {parts.length === 1 ? 'parte' : 'partes'}</div>
          {parts.map((p, i) => (
            <div key={i} className="flex items-center gap-2 mb-1.5">
              <code className="flex-1 text-[10px] bg-slate-100 rounded px-2 py-1.5 truncate">{p.slice(0, 60)}…</code>
              <Button size="sm" variant="soft" onClick={async () => { if (await copyText(p)) toast(`Parte ${i + 1} copiada`); }}>Copiar {parts.length > 1 ? i + 1 : ''}</Button>
              {navigator.share && <Button size="sm" variant="soft" onClick={() => navigator.share({ text: p }).catch(() => {})}>📤</Button>}
            </div>
          ))}
          <p className="text-xs text-slate-500">Para restaurar, cole todas as partes (em qualquer ordem).</p>
        </Card>
      )}

      <SectionTitle>Restaurar</SectionTitle>
      <Button variant="outline" className="w-full" onClick={() => fileRef.current?.click()}>📂 Escolher arquivo de backup</Button>
      <input ref={fileRef} type="file" accept=".json,application/json" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) fromFile(f); e.target.value = ''; }} />
      <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="…ou cole aqui o texto do backup (ESTOQUE_BACKUP_V1 …)"
        className="w-full h-28 mt-2 p-3 rounded-xl border border-slate-300 text-xs font-mono outline-none focus:border-blue-500" />
      <Button variant="outline" className="w-full mt-1" disabled={!pasted.trim()} onClick={fromText}>Restaurar pelo texto</Button>
      <p className="text-xs text-slate-500 mt-1.5">O backup é conferido antes. Se estiver incompleto ou corrompido, nada é alterado.</p>

      <SectionTitle>Exportar planilhas (CSV)</SectionTitle>
      <div className="grid grid-cols-2 gap-2">
        {([['estoque', '📦 Estoque do dia'], ['vendas', '🛍️ Vendas'], ['movimentacoes', '🧾 Movimentações'], ['caixa', '💰 Caixa'], ['historico', '🗓️ Histórico']] as [CsvKind, string][]).map(([k, l]) => (
          <Button key={k} variant="soft" disabled={busy} onClick={() => csv(k)}>{l}</Button>
        ))}
      </div>
      <p className="text-xs text-slate-500 mt-1.5">CSV abre no Excel/Planilhas. Não substitui o backup completo.</p>
    </Sheet>
  );
}
