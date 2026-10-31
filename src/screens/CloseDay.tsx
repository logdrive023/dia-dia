import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { fmtDate, money, PAYMENT_EMOJI, PAYMENT_LABEL, PAYMENTS, toCents } from '../lib/util';
import { closeDay } from '../services/days';
import { copyText, notebookReport, openWhatsApp, shareText, whatsappReport } from '../services/report';
import { daySummary } from '../services/summary';
import { useApp } from '../state';
import { Button, Card, Field, InfoTip, Input, Sheet, Toggle, useBusy, useUi } from '../components/ui';

/** "Encerrar o dia": resumo + relatório (WhatsApp e formato do caderno) + confirmação. */
export default function CloseDaySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { day, settings, resetCart } = useApp();
  const { run, toast, confirm } = useUi();
  const [busy, wrap] = useBusy();
  const [fmt, setFmt] = useState<'whats' | 'caderno'>('whats');
  const [counted, setCounted] = useState('');
  // editar mensagem: desligado = texto gerado pelo app; ligado = pode mexer antes de enviar
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const s = useLiveQuery(async () => (day && open ? daySummary(day.id, day.date) : null), [day?.id, open]);
  if (!open || !day) return null;
  const opts = { symbol: settings.currencySymbol, title: settings.reportTitle };
  const generated = s ? (fmt === 'whats' ? whatsappReport(day.date, s, opts) : notebookReport(day.date, s, opts)) : '';
  const text = editing && draft !== null ? draft : generated;
  const pickFmt = (f: 'whats' | 'caderno') => { setFmt(f); setDraft(null); setEditing(false); };
  const closed = day.status === 'closed';

  return (
    <Sheet open onClose={() => { setEditing(false); setDraft(null); onClose(); }} title={closed ? `Relatório · ${fmtDate(day.date, false)}` : '🌙 Encerrar o dia'} tall
      footer={
        <div className="space-y-2">
          <Button className="w-full !bg-[#25D366]" onClick={() => openWhatsApp(text)}>💬 Enviar no WhatsApp</Button>
          <div className="grid grid-cols-2 gap-2">
            <Button variant={copied ? 'success' : 'outline'} onClick={async () => {
              if (await copyText(text)) { setCopied(true); setTimeout(() => setCopied(false), 2000); } else toast('Não foi possível copiar', 'err');
            }}>{copied ? '✓ Copiado!' : '📋 Copiar texto'}</Button>
            <Button variant="outline" onClick={() => shareText(text, `Fechamento ${day.date}`)}>📤 Outros apps</Button>
          </div>
          {!closed && (
            <Button size="lg" className="w-full" disabled={busy} onClick={() => wrap(async () => {
              if (!(await confirm({ title: 'Encerrar o dia?', message: 'O dia fica bloqueado para mudanças acidentais. Dá para reabrir depois.', confirm: 'Encerrar' }))) return;
              const r = await run(() => closeDay(day.id, counted ? toCents(counted) : undefined), 'Dia encerrado! Até amanhã 🌙');
              if (r !== undefined) resetCart(); // carrinho não serve para dia encerrado
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
            <Card className="p-2.5"><div className="text-[11px] text-slate-500">Repor</div><div className="text-xl font-extrabold text-orange-600 tabular-nums">{s.restockUnits}</div><div className="text-[11px] text-slate-500">peças</div></Card>
          </div>
          <div className="grid grid-cols-2 gap-1.5 mt-2">
            {PAYMENTS.filter((p) => settings.paymentMethods.includes(p) || s.cash.salesByMethod[p]).map((p) => (
              <div key={p} className="min-w-0 bg-white rounded-lg border border-slate-200 px-2.5 py-1.5 flex items-center justify-between gap-2">
                <span className="min-w-0 text-[12px] text-slate-500 break-words">{PAYMENT_EMOJI[p]} {PAYMENT_LABEL[p]}</span>
                <span className="shrink-0 font-bold text-sm tabular-nums">{money(s.cash.salesByMethod[p])}</span>
              </div>
            ))}
          </div>
          <Card className="p-3 mt-2 flex items-center justify-between gap-3">
            <span className="min-w-0 text-sm text-slate-600 break-words">Saldo final (ontem {money(s.cash.opening)} + hoje {money(s.cash.todayNet)}{s.cash.retiradas ? ` − retirada ${money(s.cash.retiradas)}` : ''}{s.cash.pagamentos ? ` − pagamento ${money(s.cash.pagamentos)}` : ''})</span>
            <span className="shrink-0 text-xl font-extrabold tabular-nums">{money(s.cash.accumulated)}</span>
          </Card>
          {!closed && (
            <div className="mt-3">
              <Field label="Dinheiro vivo contado (opcional)" hint={s.cash.counted !== null ? `Já contado: ${money(s.cash.counted)}` : 'Se preencher, a diferença aparece no relatório.'}>
                <Input inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} placeholder={money(s.cash.cashOnHand)} />
              </Field>
            </div>
          )}

          <div className="grid grid-cols-2 bg-slate-200/70 rounded-xl p-1 mt-3 mb-2">
            <button onClick={() => pickFmt('whats')} className={`h-11 rounded-lg text-sm font-semibold ${fmt === 'whats' ? 'bg-white shadow' : 'text-slate-500'}`}>💬 WhatsApp</button>
            <button onClick={() => pickFmt('caderno')} className={`h-11 rounded-lg text-sm font-semibold ${fmt === 'caderno' ? 'bg-white shadow' : 'text-slate-500'}`}>📒 Caderno</button>
          </div>
          <div className="flex items-center gap-2 mb-2 bg-white rounded-xl border border-slate-200 px-3 py-1">
            <div className="flex-1">
              <Toggle label="✏️ Editar mensagem" checked={editing}
                onChange={(on) => { setEditing(on); setDraft(on ? generated : null); }} />
            </div>
            <InfoTip title="Editar mensagem" example={[
              ['🔒', <><b>Desligado:</b> vai o texto feito pelo app</>],
              ['✏️', <><b>Ligado:</b> você pode escrever junto</>],
              ['💬', '“Vendeu: 210 — dia fraco por causa da chuva 🌧️”'],
            ]}>
              Liga para mexer no texto antes de mandar (acrescentar um recado, tirar uma linha). Não muda nenhum dado do app, só a mensagem.
            </InfoTip>
          </div>
          {editing ? (
            <>
              <textarea value={draft ?? ''} onChange={(e) => setDraft(e.target.value)} rows={14}
                className="w-full rounded-2xl border-2 border-blue-300 bg-white p-3 text-base leading-relaxed outline-none focus:border-blue-500" />
              {draft !== generated && (
                <button className="text-sm text-slate-600 font-semibold" onClick={() => setDraft(generated)}>↺ Voltar ao texto original</button>
              )}
            </>
          ) : fmt === 'whats' ? (
            <div className="bg-[#e7ffdb] rounded-2xl rounded-tr-sm p-3.5 shadow-sm whitespace-pre-wrap text-[14px] leading-relaxed text-slate-800 border border-emerald-100"
              dangerouslySetInnerHTML={{ __html: escapeAndBold(text) }} />
          ) : (
            <div className="notebook rounded-2xl p-4 whitespace-pre-wrap text-[16px] shadow-sm border border-sky-200">{text}</div>
          )}
          <p className="text-[12px] text-slate-400 text-center mt-2">Este é o texto que vai ser enviado ou copiado.</p>
        </>
      )}
    </Sheet>
  );
}

function escapeAndBold(t: string) {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\*([^*\n]+)\*/g, '<b>$1</b>');
}
