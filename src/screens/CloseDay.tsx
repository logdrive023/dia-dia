import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { fmtDate, money, PAYMENT_EMOJI, PAYMENT_LABEL, PAYMENTS, toCents } from '../lib/util';
import { closeDay } from '../services/days';
import { copyText, notebookReport, sendWhatsApp, shareText, splitForWhatsApp, whatsappReport, whatsappSize } from '../services/report';
import { daySummary } from '../services/summary';
import { setSetting } from '../services/settings';
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
  const opts = { symbol: settings.currencySymbol, title: settings.reportTitle, showStock: settings.reportShowStock, restockDetail: settings.reportRestockDetail, stockStartEnd: settings.reportStockStartEnd, totals: settings.reportTotals, dividers: settings.reportDividers };
  // o que for digitado em "Dinheiro vivo contado" já aparece no relatório (antes de encerrar)
  const typed = counted.trim() ? toCents(counted) : null;
  const view = s && typed !== null ? { ...s, cash: { ...s.cash, counted: typed, difference: typed - s.cash.cashOnHand } } : s;
  const generated = view ? (fmt === 'whats' ? whatsappReport(day.date, view, opts) : notebookReport(day.date, view, opts)) : '';
  const text = editing && draft !== null ? draft : generated;
  const pickFmt = (f: 'whats' | 'caderno') => { setFmt(f); setDraft(null); setEditing(false); };
  const closed = day.status === 'closed';

  return (
    <Sheet open onClose={() => { setEditing(false); setDraft(null); onClose(); }} title={closed ? `Relatório · ${fmtDate(day.date, false)}` : '🌙 Encerrar o dia'} tall
      footer={
        <div className="space-y-2">
          <Button className="w-full !bg-[#25D366]" onClick={async () => { const r = await sendWhatsApp(text, settings.reportSplit); if (r === 'copied') toast('📋 Mensagem grande: copiada. Abra o WhatsApp e cole.'); }}>💬 Enviar no WhatsApp</Button>
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
            <span className="min-w-0 text-sm text-slate-600 break-words">✅ Total (ontem {money(s.cash.opening)} {s.cash.dayResult < 0 ? '−' : '+'} hoje {money(Math.abs(s.cash.dayResult))})</span>
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
          {fmt === 'whats' && (
            <div className="flex items-center gap-2 mb-2 bg-white rounded-xl border border-slate-200 px-3 py-1">
              <div className="flex-1">
                <Toggle label="📦 Mostrar o estoque" checked={settings.reportShowStock}
                  onChange={(on) => { setSetting('reportShowStock', on).catch(() => undefined); setDraft(null); setEditing(false); }} />
              </div>
              <InfoTip title="Mostrar o estoque" example={[
                ['✅', <><b>Ligado:</b> a mensagem lista o que tem agora, cor por cor</>],
                ['⚠️', '“Cor Branco: 3 ⚠️ repor 2” · “Cor Rosa: 0 🚫 esgotado”'],
                ['🚫', <><b>Desligado:</b> só o total (“Estoque no fim do dia: 233 peças”)</>],
              ]}>
                Fica salvo: vale também para o “Enviar relatório” do Início. A parte “Precisa repor” continua igual.
              </InfoTip>
            </div>
          )}
          {fmt === 'whats' && settings.reportShowStock && (
            <div className="flex items-center gap-2 mb-2 bg-white rounded-xl border border-slate-200 px-3 py-1">
              <div className="flex-1">
                <Toggle label="🌅 Começo → fim do dia em cada cor" checked={settings.reportStockStartEnd}
                  onChange={(on) => { setSetting('reportStockStartEnd', on).catch(() => undefined); setDraft(null); setEditing(false); }} />
              </div>
              <InfoTip title="Começo → fim do dia" example={[
                ['✅', <><b>Ligado:</b> “Cor Azul: começou 3 → terminou 2”</>],
                ['🚫', <><b>Desligado:</b> “Cor Azul: 2” (só o que tem agora)</>],
                ['🔒', '“🔒 2 reservadas”: ainda estão no estoque, guardadas para alguém'],
              ]}>
                Só muda a lista “Estoque agora”. Fica salvo.
              </InfoTip>
            </div>
          )}
          {fmt === 'whats' && (
            <div className="flex items-center gap-2 mb-2 bg-white rounded-xl border border-slate-200 px-3 py-1">
              <div className="flex-1">
                <Toggle label="🧾 Totais no final" checked={settings.reportTotals}
                  onChange={(on) => { setSetting('reportTotals', on).catch(() => undefined); setDraft(null); setEditing(false); }} />
              </div>
              <InfoTip title="Totais no final" example={[
                ['📦', 'Total no estoque: 385 peças'],
                ['🔁', 'Total para repor: 41 peças'],
                ['🌅', 'Começo do dia 399 → 🌙 final 385 = −14'],
              ]}>
                Os mesmos números do Início, no fim da mensagem. Fica salvo.
              </InfoTip>
            </div>
          )}
          {fmt === 'whats' && (
            <div className="flex items-center gap-2 mb-2 bg-white rounded-xl border border-slate-200 px-3 py-1">
              <div className="flex-1">
                <Toggle label="➖ Divisão entre os grupos" checked={settings.reportDividers}
                  onChange={(on) => { setSetting('reportDividers', on).catch(() => undefined); setDraft(null); setEditing(false); }} />
              </div>
              <InfoTip title="Divisão entre os grupos" example={[
                ['📦', 'Plomo · Cor Rojo: 18 …'],
                ['➖', '- - - - - - - -'],
                ['📦', 'Lila · Cor Verde: 8 …'],
              ]}>
                Uma linha separando um grupo do outro, para ler mais fácil. Fica salvo.
              </InfoTip>
            </div>
          )}
          {fmt === 'whats' && (
            <div className="flex items-center gap-2 mb-2 bg-white rounded-xl border border-slate-200 px-3 py-1">
              <div className="flex-1">
                <Toggle label="🔢 Repor com “tem X de Y”" checked={settings.reportRestockDetail}
                  onChange={(on) => { setSetting('reportRestockDetail', on).catch(() => undefined); setDraft(null); setEditing(false); }} />
              </div>
              <InfoTip title="Repor com “tem X de Y”" example={[
                ['🚫', <><b>Desligado:</b> “Cor Blanco: 1” (só o número)</>],
                ['✅', <><b>Ligado:</b> “Cor Blanco: 1 (tem 14 de 15)”</>],
              ]}>
                Só muda a parte “Precisa repor” da mensagem. Fica salvo.
              </InfoTip>
            </div>
          )}
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
          {fmt === 'whats' && <MessageSize text={text} split={settings.reportSplit} onSplit={(on) => { setSetting('reportSplit', on).catch(() => undefined); }} />}
          <p className="text-[12px] text-slate-400 text-center mt-2">Este é o texto que vai ser enviado ou copiado.</p>
        </>
      )}
    </Sheet>
  );
}

/** “Tamanho atual / máximo” da mensagem, bem claro, e o que acontece quando passa. */
function MessageSize({ text, split, onSplit }: { text: string; split: boolean; onSplit: (on: boolean) => void }) {
  const z = whatsappSize(text);
  const parts = !z.fits && split ? splitForWhatsApp(text) : null;
  const n = (v: number) => v.toLocaleString('pt-BR');
  const pct = Math.min(100, Math.round((z.link / z.max) * 100));
  return (
    <div aria-label="Tamanho da mensagem" className={`mt-3 rounded-xl border px-3 py-2.5 ${z.tooBig ? 'border-red-300 bg-red-50' : z.fits ? 'border-emerald-200 bg-emerald-50' : 'border-amber-300 bg-amber-50'}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-bold text-slate-700">📏 Tamanho da mensagem</span>
        <span className={`text-[15px] font-bold tabular-nums ${z.fits ? 'text-emerald-700' : 'text-amber-700'}`}>{n(z.link)} / {n(z.max)}</span>
      </div>
      <div className="h-2 rounded-full bg-white/80 mt-1.5 overflow-hidden">
        <div className={`h-full rounded-full ${z.fits ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[12.5px] text-slate-700 mt-1.5 leading-snug">
        {z.tooBig
          ? <>🚫 Grande demais até para o WhatsApp ({n(z.letters)} de {n(65536)} letras). Desligue a lista do estoque.</>
          : z.fits
            ? <>✅ Cabe: “Enviar no WhatsApp” abre direto a conversa.</>
            : parts
              ? <>✂️ Passou do máximo: vai em <b>{parts.length} partes</b>. Toque em “Enviar no WhatsApp” → manda a parte 1; volte para o app e toque em <b>“Mandar parte 2”</b>. Nada é cortado.</>
              : <>📤 Passou do máximo do link direto: ao tocar em “Enviar no WhatsApp” abre o <b>compartilhar</b> do celular (escolha o WhatsApp). A mensagem vai <b>inteira</b>, nada é cortado.</>}
      </p>
      {parts && (
        <ul className="mt-1.5 space-y-0.5" aria-label="Como vai ficar">
          {parts.map((p, i) => (
            <li key={i} className="text-[12.5px] text-slate-700 tabular-nums">
              📨 Parte {i + 1}: <b>{n(whatsappSize(p).link)} / {n(z.max)}</b> · começa em “{firstTitle(p)}”
            </li>
          ))}
        </ul>
      )}
      {!z.tooBig && (
        <div className="mt-1 border-t border-black/5">
          <Toggle label="✂️ Mandar em partes se passar" checked={split} onChange={onSplit} />
        </div>
      )}
    </div>
  );
}

/** primeira linha de conteúdo da parte (depois do “Parte 1 de 2”), sem os asteriscos */
function firstTitle(p: string) {
  const line = p.split('\n').slice(1).find((l) => l.trim()) ?? '';
  const t = line.replace(/\*/g, '').trim();
  return t.length > 34 ? t.slice(0, 33) + '…' : t;
}

function escapeAndBold(t: string) {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\*([^*\n]+)\*/g, '<b>$1</b>');
}
