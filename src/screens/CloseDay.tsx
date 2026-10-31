import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { fmtDate, money, PAYMENT_EMOJI, PAYMENT_LABEL, PAYMENTS, toCents } from '../lib/util';
import { closeDay } from '../services/days';
import { copyText, notebookReport, openWhatsApp, shareText, whatsappReport } from '../services/report';
import { daySummary } from '../services/summary';
import { useApp } from '../state';
import { Button, Card, Field, Input, Sheet, useBusy, useUi } from '../components/ui';

/** "Encerrar o dia": resumo + relatório (WhatsApp e formato do caderno) + confirmação. */
export default function CloseDaySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { day, settings } = useApp();
  const { run, toast, confirm } = useUi();
  const [busy, wrap] = useBusy();
  const [fmt, setFmt] = useState<'whats' | 'caderno'>('whats');
  const [counted, setCounted] = useState('');
  const s = useLiveQuery(async () => (day && open ? daySummary(day.id, day.date) : null), [day?.id, open]);
  if (!open || !day) return null;
  const opts = { symbol: settings.currencySymbol, title: settings.reportTitle };
  const text = s ? (fmt === 'whats' ? whatsappReport(day.date, s, opts) : notebookReport(day.date, s, opts)) : '';
  const closed = day.status === 'closed';

  return (
    <Sheet open onClose={onClose} title={closed ? `Relatório · ${fmtDate(day.date, false)}` : '🌙 Encerrar o dia'} tall
      footer={
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Button className="!bg-[#25D366]" onClick={() => openWhatsApp(text)}>💬 Enviar no WhatsApp</Button>
            <Button variant="outline" onClick={() => shareText(text, `Fechamento ${day.date}`)}>📤 Outros apps</Button>
          </div>
          {!closed && (
            <Button size="lg" className="w-full" disabled={busy} onClick={() => wrap(async () => {
              if (!(await confirm({ title: 'Encerrar o dia?', message: 'O dia fica bloqueado para mudanças acidentais. Dá para reabrir depois.', confirm: 'Encerrar' }))) return;
              const r = await run(() => closeDay(day.id, counted ? toCents(counted) : undefined), 'Dia encerrado! Até amanhã 🌙');
              if (r !== undefined) setFmt('whats');
            })}>🔒 Encerrar o dia</Button>
          )}
        </div>
      }>
      {s && (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Card className="p-2.5"><div className="text-[11px] text-slate-500">Vendeu</div><div className="text-xl font-extrabold text-emerald-600 tabular-nums">{money(s.cash.salesTotal)}</div><div className="text-[11px] text-slate-500">{s.soldUnits} peças</div></Card>
            <Card className="p-2.5"><div className="text-[11px] text-slate-500">Entrou</div><div className="text-xl font-extrabold text-blue-600 tabular-nums">{s.enteredUnits}</div><div className="text-[11px] text-slate-500">peças</div></Card>
            <Card className="p-2.5"><div className="text-[11px] text-slate-500">Repor</div><div className="text-xl font-extrabold text-orange-600 tabular-nums">{s.restock.length}</div><div className="text-[11px] text-slate-500">itens</div></Card>
          </div>
          <div className="grid grid-cols-4 gap-1.5 mt-2">
            {PAYMENTS.map((p) => (
              <div key={p} className="bg-white rounded-lg border border-slate-200 py-1.5 text-center">
                <div className="text-[11px] text-slate-500">{PAYMENT_EMOJI[p]} {PAYMENT_LABEL[p]}</div>
                <div className="font-bold text-sm tabular-nums">{money(s.cash.salesByMethod[p])}</div>
              </div>
            ))}
          </div>
          <Card className="p-3 mt-2 flex items-center justify-between">
            <span className="text-sm text-slate-600">Saldo final (ontem {money(s.cash.opening)} + hoje {money(s.cash.todayNet)}{s.cash.retiradas ? ` − ${money(s.cash.retiradas)}` : ''})</span>
            <span className="text-xl font-extrabold tabular-nums">{money(s.cash.accumulated)}</span>
          </Card>
          {!closed && (
            <div className="mt-3">
              <Field label="Dinheiro vivo contado (opcional)" hint={s.cash.counted !== null ? `Já contado: ${money(s.cash.counted)}` : 'Se preencher, a diferença aparece no relatório.'}>
                <Input inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} placeholder={money(s.cash.cashOnHand)} />
              </Field>
            </div>
          )}

          <div className="grid grid-cols-2 bg-slate-200/70 rounded-xl p-1 mt-3 mb-2">
            <button onClick={() => setFmt('whats')} className={`h-9 rounded-lg text-sm font-semibold ${fmt === 'whats' ? 'bg-white shadow' : 'text-slate-500'}`}>💬 WhatsApp</button>
            <button onClick={() => setFmt('caderno')} className={`h-9 rounded-lg text-sm font-semibold ${fmt === 'caderno' ? 'bg-white shadow' : 'text-slate-500'}`}>📒 Caderno</button>
          </div>
          {fmt === 'whats' ? (
            <div className="bg-[#e7ffdb] rounded-2xl rounded-tr-sm p-3.5 shadow-sm whitespace-pre-wrap text-[14px] leading-relaxed text-slate-800 border border-emerald-100"
              dangerouslySetInnerHTML={{ __html: escapeAndBold(text) }} />
          ) : (
            <div className="notebook rounded-2xl p-4 whitespace-pre-wrap text-[16px] shadow-sm border border-sky-200">{text}</div>
          )}
          <button className="text-sm text-blue-600 font-semibold mt-2" onClick={async () => { if (await copyText(text)) toast('Texto copiado'); }}>📋 Copiar texto</button>
        </>
      )}
    </Sheet>
  );
}

function escapeAndBold(t: string) {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\*([^*\n]+)\*/g, '<b>$1</b>');
}
