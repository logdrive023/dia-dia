import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { ImportRecord } from '../db/types';
import { fmtDate, todayStr } from '../lib/util';
import { useApp } from '../state';
import { Button, Card, InfoTip, Sheet, Toggle, useBusy, useUi } from '../components/ui';
import { copyText } from '../services/report';
import {
  applyImport, buildImportPlan, importTemplate, planProblems, resolveChoice, undoImport, undoImportPreview,
  type PlanLine, type PlanStatus, type UndoLine,
} from '../services/importer';

const STATUS: Record<PlanStatus, { label: string; cls: string }> = {
  existe: { label: 'já existe', cls: 'bg-blue-100 text-blue-800' },
  nova: { label: 'novo', cls: 'bg-emerald-100 text-emerald-800' },
  parecida: { label: 'escolha', cls: 'bg-amber-100 text-amber-800' },
  erro: { label: 'erro', cls: 'bg-red-100 text-red-700' },
  vazia: { label: 'sem quantidade', cls: 'bg-slate-100 text-slate-500' },
};
const EXAMPLE = 'Plomo\nAzul: 6\nVerde · P: 2\n\nLila > Rosa > 4';
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');

/** Menu › Importar mercadoria: colar um texto com muitos produtos de uma vez (prévia antes de aplicar). */
export default function ImportSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<'nova' | 'feitas'>('nova');
  const count = useLiveQuery(() => db.imports.count(), []) ?? 0;
  if (!open) return null;
  return (
    <Sheet open onClose={onClose} title="📋 Importar mercadoria" tall>
      <div className="grid grid-cols-2 gap-1.5 mb-3" role="tablist">
        {(['nova', 'feitas'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`h-10 rounded-xl text-[14px] font-semibold border ${tab === t ? 'bg-slate-800 text-white border-slate-800' : 'bg-white border-slate-200 text-slate-600'}`}>
            {t === 'nova' ? 'Nova importação' : `Importações feitas (${count})`}
          </button>
        ))}
      </div>
      {tab === 'nova' ? <NewImport onDone={() => setTab('feitas')} /> : <PastImports />}
    </Sheet>
  );
}

function NewImport({ onDone }: { onDone: () => void }) {
  const { settings, day, date } = useApp();
  const { run, confirm, toast } = useUi();
  const [busy, wrap] = useBusy();
  const [text, setText] = useState('');
  const [op, setOp] = useState<'somar' | 'definir'>('somar');
  const [entryKind, setEntryKind] = useState<'nova' | 'reposicao'>(settings.entryNewByDefault ? 'nova' : 'reposicao');
  const [newForSale, setNewForSale] = useState(true);
  const [plan, setPlan] = useState<PlanLine[] | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const todayOpen = useLiveQuery(async () => (await db.dailyRecords.where('date').equals(todayStr()).first())?.status === 'open', [day?.id, date]);
  const opts = { op, newForSale, sizes: settings.sizes };
  const preview = () => wrap(async () => { const r = await run(() => buildImportPlan(text, opts)); if (r) setPlan(r.lines); });
  const setLine = (key: string, patch: Partial<PlanLine>) => setPlan((p) => p?.map((l) => (l.key === key ? { ...l, ...patch } : l)) ?? null);
  const choose = async (l: PlanLine, choice: string) => { const nl = await resolveChoice(l, choice, opts); setPlan((p) => p?.map((x) => (x.key === l.key ? nl : x)) ?? null); };

  if (plan) {
    const use = plan.filter((l) => l.include && l.status !== 'erro' && l.status !== 'vazia');
    const { pending, ready } = planProblems(plan);
    const created = use.filter((l) => l.status === 'nova' || (l.status === 'parecida' && l.choice === 'nova')).length;
    const groupsNew = new Set(use.filter((l) => l.newGroup).map((l) => l.group.toLowerCase())).size;
    const units = use.reduce((n, l) => n + l.delta, 0);
    const errors = plan.filter((l) => l.status === 'erro');
    const confirmImport = () => wrap(async () => {
      if (!(await confirm({ title: 'Confirmar a importação?', confirm: 'Importar',
        message: `${use.length} produto(s) · ${signed(units)} peça(s) · ${created} novo(s)${groupsNew ? ` · ${groupsNew} grupo(s) novo(s)` : ''}. O texto colado fica guardado e dá para desfazer depois.` }))) return;
      const r = await run(() => applyImport(text, plan, { ...opts, entryKind }), 'Importado!');
      if (r) { setPlan(null); setText(''); onDone(); }
    });
    return (
      <>
        <div className="flex flex-wrap gap-1.5 mb-3 text-[12px] font-semibold">
          <span className="rounded-full bg-blue-100 text-blue-800 px-2 py-1">{plan.filter((l) => l.status === 'existe').length} já existem</span>
          <span className="rounded-full bg-emerald-100 text-emerald-800 px-2 py-1">{created} novos</span>
          {groupsNew > 0 && <span className="rounded-full bg-emerald-100 text-emerald-800 px-2 py-1">{groupsNew} grupo(s) novo(s)</span>}
          {pending.length > 0 && <span className="rounded-full bg-amber-100 text-amber-800 px-2 py-1">{pending.length} para escolher</span>}
          {errors.length > 0 && <span className="rounded-full bg-red-100 text-red-700 px-2 py-1">{errors.length} com erro</span>}
          <span className="rounded-full bg-slate-800 text-white px-2 py-1">{signed(units)} peças</span>
        </div>
        <p className="text-[13px] text-slate-600 mb-2">Prévia: <b>nada foi aplicado ainda</b>. Confira cada linha; tire as que não quer.</p>
        <div className="overflow-x-auto -mx-1 mb-3">
          <table className="w-full text-[13px]" aria-label="Prévia da importação">
            <thead><tr className="text-left text-slate-500 text-[12px]"><th className="px-1 py-1">Produto</th><th className="px-1 text-right">Antes</th><th className="px-1 text-right">{op === 'somar' ? 'Entrada' : 'Muda'}</th><th className="px-1 text-right">Depois</th></tr></thead>
            <tbody>
              {plan.map((l) => (
                <tr key={l.key} className={`border-t border-slate-100 align-top ${!l.include ? 'opacity-50' : ''}`}>
                  <td className="px-1 py-1.5">
                    <div className="flex items-start gap-1.5">
                      {l.status !== 'erro' && l.status !== 'vazia' && (
                        <input type="checkbox" className="mt-1" checked={l.include} aria-label={`Incluir ${l.name}`} onChange={(e) => setLine(l.key, { include: e.target.checked })} />
                      )}
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-800 break-words">{l.group ? `${l.group} › ` : ''}{l.name}{l.size ? ` · ${l.size}` : ''}</div>
                        <span className={`inline-block rounded-full px-1.5 py-0.5 text-[11px] font-bold ${STATUS[l.status].cls}`}>{STATUS[l.status].label}</span>
                        {l.message && <div className="text-[12px] text-slate-500 mt-0.5">{l.message}</div>}
                        {l.status === 'parecida' && (
                          <select aria-label={`O que é ${l.name}`} className="mt-1 h-9 rounded-lg border border-amber-300 bg-white px-1.5 text-[13px] max-w-full" value={l.choice ?? ''} onChange={(e) => choose(l, e.target.value)}>
                            <option value="">Escolha…</option>
                            {l.candidates.map((c) => <option key={c.id} value={c.id}>É “{c.label}”</option>)}
                            <option value="nova">É um produto novo</option>
                          </select>
                        )}
                        {(l.status === 'nova' || l.choice === 'nova') && l.include && (
                          <label className="flex items-center gap-1 mt-1 text-[12px] text-slate-600">
                            <input type="checkbox" checked={l.forSale} onChange={(e) => setLine(l.key, { forSale: e.target.checked })} /> à venda (desmarcado: só no estoque)
                          </label>
                        )}
                        <div className="text-[11px] text-slate-400">linha {l.lineNo}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-1 py-1.5 text-right tabular-nums">{l.status === 'erro' || l.status === 'vazia' ? '' : l.before}</td>
                  <td className={`px-1 py-1.5 text-right tabular-nums font-bold ${l.delta > 0 ? 'text-emerald-700' : l.delta < 0 ? 'text-red-600' : ''}`}>{l.status === 'erro' || l.status === 'vazia' ? '' : signed(l.delta)}</td>
                  <td className="px-1 py-1.5 text-right tabular-nums font-bold">{l.status === 'erro' || l.status === 'vazia' ? '' : l.after}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button className="text-[13px] font-semibold text-blue-600 mb-2" onClick={() => setShowRaw(!showRaw)}>{showRaw ? '▾' : '▸'} Texto colado</button>
        {showRaw && <pre className="text-[12px] bg-slate-50 border border-slate-200 rounded-xl p-2 mb-3 whitespace-pre-wrap break-words">{text}</pre>}
        {!todayOpen && <p className="text-[13px] text-red-600 mb-2">Inicie o dia de hoje antes de importar (a mercadoria entra hoje).</p>}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => setPlan(null)}>← Voltar e corrigir</Button>
          <Button disabled={!ready || busy || !todayOpen} onClick={confirmImport}>Confirmar importação</Button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="flex items-start gap-2 mb-2">
        <p className="flex-1 text-[13px] text-slate-600 leading-snug">Cole a lista: o nome do grupo numa linha e, embaixo, cada produto com a quantidade. Antes de aplicar, aparece a prévia.</p>
        <InfoTip title="Como escrever a lista" example={[
          ['📁', <><b>Plomo</b> (linha sem número = grupo)</>],
          ['👗', <><b>Azul: 6</b> (produto: quantidade)</>],
          ['📏', <><b>Verde · P: 2</b> ou <b>Verde (P): 2</b> (com tamanho)</>],
          ['➡️', <><b>Lila &gt; Rosa &gt; 4</b> (tudo numa linha)</>],
          ['📋', 'Dica: “Copiar o modelo” traz o catálogo pronto, só falta pôr os números'],
        ]}>Produto que já existe recebe a quantidade; produto novo é criado (você escolhe se fica à venda). Nada é aplicado antes de confirmar.</InfoTip>
      </div>
      <div className="grid grid-cols-2 gap-2 mb-2">
        <Button variant="outline" size="sm" onClick={async () => { const t = await importTemplate(); toast((await copyText(t)) ? '📋 Modelo copiado' : 'Não deu para copiar'); }}>📋 Copiar o modelo</Button>
        <Button variant="outline" size="sm" onClick={async () => setText(await importTemplate())}>✍️ Pôr o modelo aqui</Button>
      </div>
      <textarea aria-label="Texto da importação" rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder={EXAMPLE}
        className="w-full rounded-2xl border-2 border-slate-200 bg-white p-3 text-base leading-relaxed outline-none focus:border-blue-500 mb-3" />
      <Card className="p-3 mb-3 space-y-2">
        <div className="text-[13px] font-semibold text-slate-700">Produto que já existe:</div>
        <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Operação">
          {([['somar', '➕ Somar ao estoque', 'chegou mercadoria'], ['definir', '✏️ Definir a quantidade', 'contagem: fica o número']] as const).map(([v, l, h]) => (
            <button key={v} role="radio" aria-checked={op === v} onClick={() => setOp(v)}
              className={`rounded-xl border px-2 py-2 text-left ${op === v ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-200 text-slate-700'}`}>
              <span className="block text-[13px] font-bold">{l}</span><span className={`block text-[11px] ${op === v ? 'text-white/85' : 'text-slate-500'}`}>{h}</span>
            </button>
          ))}
        </div>
        {op === 'somar' && (
          <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Tipo da entrada">
            {([['reposicao', '🔁 Reposição'], ['nova', '📦 Mercadoria nova']] as const).map(([v, l]) => (
              <button key={v} role="radio" aria-checked={entryKind === v} onClick={() => setEntryKind(v)}
                className={`h-10 rounded-xl border text-[13px] font-semibold ${entryKind === v ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-slate-200 text-slate-700'}`}>{l}</button>
            ))}
          </div>
        )}
        <Toggle checked={newForSale} onChange={setNewForSale} label={newForSale ? 'Produto novo já entra à venda' : 'Produto novo fica só no estoque'} />
      </Card>
      <Button className="w-full" size="lg" disabled={!text.trim() || busy} onClick={preview}>👀 Ver a prévia</Button>
    </>
  );
}

function PastImports() {
  const list = useLiveQuery(() => db.imports.orderBy('createdAt').reverse().toArray(), []);
  const [openId, setOpenId] = useState<string | null>(null);
  if (!list) return <p className="text-center text-slate-400 py-8">Carregando…</p>;
  if (!list.length) return <p className="text-center text-slate-500 py-8">Nenhuma importação ainda.</p>;
  return (
    <div className="space-y-2">
      {list.map((r) => <PastImport key={r.id} r={r} open={openId === r.id} onToggle={() => setOpenId(openId === r.id ? null : r.id)} />)}
    </div>
  );
}

function PastImport({ r, open, onToggle }: { r: ImportRecord; open: boolean; onToggle: () => void }) {
  const { run, confirm } = useUi();
  const [undo, setUndo] = useState<UndoLine[] | null>(null);
  const units = r.lines.reduce((n, l) => n + l.delta, 0);
  const statusLabel = r.status === 'aplicada' ? '✅ aplicada' : r.status === 'desfeita' ? '↩️ desfeita' : '⚠️ desfeita em parte';
  const askUndo = async () => { const p = await undoImportPreview(r.id); setUndo(p.lines); };
  const doUndo = async () => {
    const ok = (undo ?? []).filter((l) => l.ok).length;
    if (!(await confirm({ title: 'Desfazer a importação?', confirm: 'Desfazer', tone: 'warning',
      message: `${ok} produto(s) voltam como estavam. O que saiu depois (vendas, saídas) não é mexido. A importação original continua guardada.` }))) return;
    const res = await run(() => undoImport(r.id), 'Importação desfeita');
    if (res) setUndo(null);
  };
  return (
    <Card className="p-3">
      <button className="w-full text-left" onClick={onToggle} aria-expanded={open}>
        <div className="flex items-center gap-2">
          <span className="flex-1 font-bold text-slate-800">{fmtDate(r.date, false)} · {new Date(r.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
          <span className="text-[12px] font-semibold">{statusLabel}</span>
        </div>
        <div className="text-[12px] text-slate-500">{r.lines.length} produto(s) · {signed(units)} peças · {r.lines.filter((l) => l.created).length} novo(s){r.by ? ` · por ${r.by}` : ''}</div>
      </button>
      {open && (
        <div className="mt-2 pt-2 border-t border-slate-100">
          <table className="w-full text-[13px] mb-2" aria-label="O que a importação mudou">
            <thead><tr className="text-left text-slate-500 text-[12px]"><th>Produto</th><th className="text-right">Antes</th><th className="text-right">Mudou</th><th className="text-right">Depois</th></tr></thead>
            <tbody>{r.lines.map((l, i) => (
              <tr key={i} className="border-t border-slate-100"><td className="py-1">{l.groupName} › {l.name}{l.size ? ` · ${l.size}` : ''}{l.created ? ' 🆕' : ''}</td>
                <td className="text-right tabular-nums">{l.before}</td><td className="text-right tabular-nums font-bold">{signed(l.delta)}</td><td className="text-right tabular-nums">{l.after}</td></tr>
            ))}</tbody>
          </table>
          {r.undoSkipped?.length ? <div className="text-[12px] text-amber-800 mb-2">Não deu para desfazer: {r.undoSkipped.map((s) => s.reason).join(' · ')}</div> : null}
          <div className="text-[12px] font-semibold text-slate-600 mb-1">Texto colado (original)</div>
          <pre className="text-[12px] bg-slate-50 border border-slate-200 rounded-xl p-2 mb-2 whitespace-pre-wrap break-words">{r.text}</pre>
          {r.status === 'aplicada' && !undo && <Button variant="soft" size="sm" onClick={askUndo}>↩️ Desfazer esta importação</Button>}
          {undo && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-2">
              <div className="text-[13px] font-bold text-amber-900 mb-1">Se desfizer agora:</div>
              {undo.map((l, i) => (
                <div key={i} className="text-[12px] text-slate-700">{l.ok ? '✅' : '⛔'} {l.label}: {l.ok ? `${l.now} → ${l.after}` : l.reason}</div>
              ))}
              <div className="grid grid-cols-2 gap-2 mt-2">
                <Button variant="outline" size="sm" onClick={() => setUndo(null)}>Cancelar</Button>
                <Button size="sm" disabled={!undo.some((l) => l.ok)} onClick={doUndo}>Desfazer o que dá</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
