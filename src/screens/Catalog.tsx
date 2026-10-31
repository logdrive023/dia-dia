import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Group, Variant } from '../db/types';
import { colorName, COLORS, money, NAMED_COLORS, normalize, toCents } from '../lib/util';
import {
  archiveGroup, archiveVariant, createCategory, createGroup, createVariant, deleteCategory, deleteGroup, deleteVariant,
  groupHasHistory, moveVariant, reorderGroups, reorderVariants, setGroupActive, setVariantActive, transferVariants,
  updateGroup, updateVariant, variantHasHistory,
} from '../services/catalog';
import { useApp } from '../state';
import { Badge, Button, Card, ColorField, Field, InfoTip, Input, Sheet, Swatch, Toggle, useBusy, useUi } from '../components/ui';

const ICONS = ['📦', '🎀', '💜', '📌', '📍', '👕', '🧡', '✨', '💙', '👑', '💎', '🌸', '⭐', '🔥', '🆕', '🎁', '👜', '🧢', '🧦', '💍', '🌈', '🍀', '❤️', '🖤'];

export default function CatalogSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { run } = useUi();
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<string | null>(null);
  const [quick, setQuick] = useState<'group' | 'variant' | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const data = useLiveQuery(async () => {
    const [groups, variants, categories] = await Promise.all([db.groups.orderBy('displayOrder').toArray(), db.variants.toArray(), db.categories.orderBy('displayOrder').toArray()]);
    return { groups, variants, categories };
  }, []);
  if (!open) return null;
  const nq = normalize(q);
  const list = (data?.groups ?? []).filter((g) => !g.archivedAt);
  const archived = (data?.groups ?? []).filter((g) => g.archivedAt);
  const matches = (g: Group) => !nq || normalize(g.name).includes(nq) ||
    data!.variants.some((v) => v.groupId === g.id && normalize(v.name).includes(nq));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    const ids = list.map((g) => g.id); [ids[i], ids[j]] = [ids[j], ids[i]];
    run(() => reorderGroups([...ids, ...archived.map((g) => g.id)]));
  };

  return (
    <Sheet open onClose={onClose} title="✏️ Cadastro" tall>
      <div className="grid grid-cols-2 gap-2 mb-3">
        <Button onClick={() => setQuick('group')}>＋ Grupo</Button>
        <Button variant="outline" onClick={() => setQuick('variant')}>＋ Variação</Button>
      </div>
      <Input placeholder="🔍 Buscar grupo ou cor..." value={q} onChange={(e) => setQ(e.target.value)} />
      {!nq && (
        <div className="flex items-center gap-2 mt-4 mb-1 px-1">
          <span className="flex-1 text-[13px] font-bold text-slate-600">📋 Ordem dos grupos nas telas</span>
          <InfoTip title="Ordem dos grupos" example={[
            ['1️⃣', <><b>Plomo</b> está em 1º → aparece primeiro no Início, no Estoque e no Vender</>],
            ['⬇️', <>Toque em <b>Descer</b> no Plomo → ele vira o 2º e o Lila sobe para 1º</>],
            ['⬆️', <>Vende muito Azul? Toque em <b>Subir</b> até ele chegar em 1º</>],
          ]}>As setas só mudam a posição na fila (quem aparece antes). Não mexem em quantidades nem vendas.</InfoTip>
        </div>
      )}
      <div className="space-y-1.5 mt-1">
        {list.map((g, i) => matches(g) && (
          <Card key={g.id} className={`flex items-center gap-2 p-2 pl-2 ${g.active ? '' : 'opacity-60'}`}>
            {!nq && <span className="w-7 h-7 shrink-0 rounded-full bg-slate-800 text-white text-[12px] font-bold flex items-center justify-center tabular-nums" title="Posição na fila">{i + 1}º</span>}
            <button className="flex-1 flex items-center gap-2.5 text-left min-w-0" onClick={() => setEdit(g.id)}>
              <span className="w-9 h-9 rounded-lg flex items-center justify-center text-lg" style={{ background: g.color + '22' }}>{g.icon}</span>
              <span className="min-w-0">
                <span className="block font-bold text-slate-800 break-words">{g.name}</span>
                <span className="block text-xs text-slate-500">
                  {(() => { const n = data!.variants.filter((v) => v.groupId === g.id && !v.archivedAt).length; return `🎨 ${n} ${n === 1 ? 'cor' : 'cores'} · toque para editar`; })()}
                  {!g.active && ' · desativado'}
                  {g.categoryIds?.map((c) => { const cat = data!.categories.find((x) => x.id === c); return cat ? <span key={c} className="ml-1 font-semibold" style={{ color: cat.color }}>#{cat.name}</span> : null; })}
                </span>
              </span>
            </button>
            {!nq && <>
              <button disabled={i === 0} className="w-12 h-12 rounded-lg bg-slate-100 active:bg-slate-200 disabled:opacity-30 flex flex-col items-center justify-center leading-none" onClick={() => move(i, -1)} aria-label={`Subir ${g.name}`}>
                <span className="text-base">↑</span><span className="text-[9px] font-semibold text-slate-500 mt-0.5">subir</span>
              </button>
              <button disabled={i === list.length - 1} className="w-12 h-12 rounded-lg bg-slate-100 active:bg-slate-200 disabled:opacity-30 flex flex-col items-center justify-center leading-none" onClick={() => move(i, 1)} aria-label={`Descer ${g.name}`}>
                <span className="text-base">↓</span><span className="text-[9px] font-semibold text-slate-500 mt-0.5">descer</span>
              </button>
            </>}
          </Card>
        ))}
      </div>
      {archived.length > 0 && (
        <>
          <button className="mt-4 text-sm font-semibold text-slate-500" onClick={() => setShowArchived(!showArchived)}>
            {showArchived ? '▾' : '▸'} Arquivados ({archived.length})
          </button>
          {showArchived && archived.map((g) => (
            <Card key={g.id} className="flex items-center gap-2 p-2 pl-3 mt-1.5 opacity-70">
              <span className="text-lg">{g.icon}</span>
              <button className="flex-1 font-semibold text-left" onClick={() => setEdit(g.id)}>{g.name}</button>
              <Button size="sm" variant="soft" onClick={() => run(() => archiveGroup(g.id, false), 'Grupo reativado')}>Reativar</Button>
            </Card>
          ))}
        </>
      )}
      <Categories />
      <GroupEditor id={edit} onClose={() => setEdit(null)} />
      <QuickAdd kind={quick} onClose={() => setQuick(null)} groups={list} onCreatedGroup={(id) => setEdit(id)} />
    </Sheet>
  );
}

function QuickAdd({ kind, onClose, groups, onCreatedGroup }: { kind: 'group' | 'variant' | null; onClose: () => void; groups: Group[]; onCreatedGroup: (id: string) => void }) {
  const { day } = useApp();
  const { run } = useUi();
  const [busy, wrap] = useBusy();
  const [name, setName] = useState('');
  const [groupId, setGroupId] = useState('');
  const [qty, setQty] = useState(0);
  const [color, setColor] = useState<string | undefined>();
  if (!kind) return null;
  const gid = groupId || groups[0]?.id;
  const group = groups.find((g) => g.id === gid);
  const close = () => { setName(''); setQty(0); setColor(undefined); onClose(); };
  const save = () => wrap(async () => {
    if (kind === 'group') {
      const g = await run(() => createGroup({ name }), 'Grupo criado');
      if (g) { setName(''); onClose(); onCreatedGroup(g.id); }
    } else {
      const v = await run(() => createVariant({ groupId: gid, name, color, startQuantity: qty, dailyRecordId: day?.status === 'open' ? day.id : null }),
        `${name.trim()} cadastrada em ${group?.name ?? ''}`);
      if (v) { setName(''); setQty(0); setColor(undefined); } // continua aberto para cadastrar a próxima cor
    }
  });
  if (kind === 'group') return (
    <Sheet open onClose={close} title="📦 Novo grupo"
      footer={<Button size="lg" className="w-full" disabled={!name.trim() || busy} onClick={save}>Salvar grupo</Button>}>
      <p className="text-sm text-slate-500 mb-3">Grupo é o tipo de peça (ex.: Plomo, Broche). Depois você coloca as cores dentro dele.</p>
      <Field label="Nome do grupo"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Novidades" autoFocus
        onKeyDown={(e) => e.key === 'Enter' && name.trim() && save()} /></Field>
      <p className="text-xs text-slate-500">Ícone e cor você escolhe em seguida.</p>
    </Sheet>
  );
  return (
    <Sheet open onClose={close} title="🎨 Nova cor / variação" tall
      footer={<Button size="lg" className="w-full" disabled={!name.trim() || busy} onClick={save}>
        {name.trim() ? `Salvar ${name.trim()} em ${group?.name ?? ''}` : 'Salvar'}
      </Button>}>
      <div className="flex items-start gap-2 rounded-xl bg-blue-50 border border-blue-200 px-3 py-2.5 mb-4 text-[14px] text-blue-900">
        <span className="flex-1">Variação é a cor ou modelo dentro de um grupo (ex.: Plomo <b>Verde</b>).</span>
        <InfoTip title="Cadastrar uma cor" example={[
          ['📦', <>Escolha o grupo: <b>Plomo</b></>],
          ['✍️', <>Nome: <b>Verde</b> · bolinha verde</>],
          ['🔢', <>Quantidade: <b>15</b> → entra 15 no estoque de hoje</>],
          ['🔁', 'Esses 15 viram o estoque ideal: vendeu 1 → aparece “repor 1”'],
          ['➕', 'Depois de salvar, já dá para cadastrar a próxima cor'],
        ]}>A quantidade é opcional; dá para lançar depois na aba Estoque com o +.</InfoTip>
      </div>

      <div className="text-sm font-semibold text-slate-700 mb-1.5">1. Grupo</div>
      <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-5 px-5 pb-1 mb-4">
        {groups.map((g) => (
          <button key={g.id} onClick={() => setGroupId(g.id)}
            className={`shrink-0 h-11 px-3 rounded-xl border-2 flex items-center gap-1.5 text-[14px] font-semibold ${g.id === gid ? 'border-blue-600 bg-blue-50 text-blue-800' : 'border-slate-200 bg-white text-slate-600'}`}>
            <span>{g.icon}</span>{g.name}
          </button>
        ))}
      </div>

      <div className="text-sm font-semibold text-slate-700 mb-1.5">2. Nome e cor</div>
      <div className="flex items-center gap-2 mb-2">
        <Swatch color={color} size={44} />
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Verde" autoFocus onKeyDown={(e) => e.key === 'Enter' && name.trim() && save()} />
      </div>
      <ColorField value={color} onChange={(c) => { if (!name.trim() || name.trim() === colorName(color)) setName(colorName(c) === 'Poá' ? 'Poa' : colorName(c)); setColor(c); }} />

      <div className="text-sm font-semibold text-slate-700 mb-1.5">3. Quantidade agora <span className="font-normal text-slate-500">(opcional)</span></div>
      <div className="flex items-center justify-between bg-white rounded-xl border border-slate-200 px-3 py-2">
        <span className="text-[14px] text-slate-600">{qty === 0 ? 'Nenhuma peça ainda' : `${qty} ${qty === 1 ? 'peça' : 'peças'} · ideal ${qty}`}</span>
        <div className="flex items-center gap-1">
          <button onClick={() => setQty(Math.max(0, qty - 1))} className="w-11 h-11 rounded-lg bg-slate-100 text-xl font-bold" aria-label="Menos">−</button>
          <input inputMode="numeric" value={qty} onChange={(e) => setQty(Math.min(100000, Number(e.target.value.replace(/\D/g, '')) || 0))}
            className="w-14 h-11 text-center text-lg font-extrabold border border-slate-200 rounded-lg" aria-label="Quantidade" />
          <button onClick={() => setQty(qty + 1)} className="w-11 h-11 rounded-lg bg-blue-600 text-white text-xl font-bold" aria-label="Mais">+</button>
        </div>
      </div>
      <p className="text-xs text-slate-500 mt-1.5">{day?.status === 'open' ? 'Entra no estoque do dia selecionado.' : 'Entra quando o próximo dia for iniciado.'}</p>
    </Sheet>
  );
}

function GroupEditor({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { day } = useApp();
  const { run, confirm } = useUi();
  const [editVar, setEditVar] = useState<string | null>(null);
  const [newVar, setNewVar] = useState('');
  const [newQty, setNewQty] = useState('');
  const [transfer, setTransfer] = useState('');
  const data = useLiveQuery(async () => {
    if (!id) return null;
    const [g, variants, groups, categories] = await Promise.all([
      db.groups.get(id), db.variants.where('groupId').equals(id).sortBy('displayOrder'), db.groups.toArray(), db.categories.toArray(),
    ]);
    return { g, variants, groups: groups.filter((x) => x.id !== id && !x.archivedAt), categories };
  }, [id]);
  if (!id || !data?.g) return null;
  const g = data.g;
  const active = data.variants.filter((v) => !v.archivedAt);
  const archivedV = data.variants.filter((v) => v.archivedAt);
  const moveV = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= active.length) return;
    const ids = active.map((v) => v.id); [ids[i], ids[j]] = [ids[j], ids[i]];
    run(() => reorderVariants([...ids, ...archivedV.map((v) => v.id)]));
  };

  return (
    <Sheet open onClose={onClose} title={<span>{g.icon} {g.name}</span>} tall>
      <NameField key={g.id + g.name} value={g.name} onSave={(name) => run(() => updateGroup(g.id, { name }), 'Nome alterado')}
        hint="Renomear não perde histórico: vendas e estoques continuam ligados a este grupo." />
      <Field label="Ícone">
        <div className="flex flex-wrap gap-1.5">
          {ICONS.map((i) => (
            <button key={i} onClick={() => run(() => updateGroup(g.id, { icon: i }))} className={`w-10 h-10 rounded-lg text-xl ${g.icon === i ? 'bg-blue-100 ring-2 ring-blue-500' : 'bg-slate-100'}`}>{i}</button>
          ))}
        </div>
      </Field>
      <ColorField value={g.color} colors={NAMED_COLORS.map(([c]) => c).filter((c) => c !== 'poa')} onChange={(c) => run(() => updateGroup(g.id, { color: c }))} />
      <NameField key={'d' + g.id} label="Descrição (opcional)" value={g.description ?? ''} allowEmpty onSave={(description) => run(() => updateGroup(g.id, { description }), 'Salvo')} />
      {data.categories.length > 0 && (
        <Field label="Etiquetas">
          <div className="flex flex-wrap gap-1.5">
            {data.categories.map((c) => {
              const on = g.categoryIds?.includes(c.id);
              return (
                <button key={c.id} onClick={() => run(() => updateGroup(g.id, { categoryIds: on ? g.categoryIds!.filter((x) => x !== c.id) : [...(g.categoryIds ?? []), c.id] }))}
                  className="h-8 px-3 rounded-full text-sm font-semibold border" style={on ? { background: c.color, color: '#fff', borderColor: c.color } : { color: c.color, borderColor: c.color + '66' }}>
                  #{c.name}
                </button>
              );
            })}
          </div>
        </Field>
      )}
      <Toggle label="Ativo (aparece nas operações)" checked={g.active} onChange={(v) => run(() => setGroupActive(g.id, v))} />

      <h3 className="font-bold text-slate-700 mt-4 mb-2">Variações ({active.length})</h3>
      <div className="space-y-1.5">
        {active.map((v, i) => (
          <Card key={v.id} className={`flex items-center gap-2 p-2 pl-3 ${v.active ? '' : 'opacity-60'}`}>
            <button className="flex-1 flex items-center gap-2.5 text-left min-w-0" onClick={() => setEditVar(v.id)}>
              <Swatch color={v.color} />
              <span className="font-semibold break-words">{v.name}</span>
              {v.optionalPriceInCents ? <Badge tone="blue">{money(v.optionalPriceInCents)}</Badge> : null}
              <Badge>ideal {v.idealStock ?? v.startQuantity}</Badge>
              {!v.active && <Badge>desativada</Badge>}
            </button>
            <button className="w-11 h-11 rounded-lg bg-slate-100 active:bg-slate-200" onClick={() => moveV(i, -1)}>↑</button>
            <button className="w-11 h-11 rounded-lg bg-slate-100 active:bg-slate-200" onClick={() => moveV(i, 1)}>↓</button>
          </Card>
        ))}
        {archivedV.map((v) => (
          <Card key={v.id} className="flex items-center gap-2 p-2 pl-3 opacity-60">
            <Swatch color={v.color} />
            <button className="flex-1 text-left" onClick={() => setEditVar(v.id)}>{v.name} <Badge>arquivada</Badge></button>
            <Button size="sm" variant="soft" onClick={() => run(() => archiveVariant(v.id, false), 'Reativada')}>Reativar</Button>
          </Card>
        ))}
      </div>
      <div className="flex gap-2 mt-2">
        <Input placeholder="Nova variação (ex.: Verde)" value={newVar} onChange={(e) => setNewVar(e.target.value)} />
        <Input className="!w-20" inputMode="numeric" placeholder="Qtd" value={newQty} onChange={(e) => setNewQty(e.target.value.replace(/\D/g, ''))} />
        <Button className="h-12" disabled={!newVar.trim()} onClick={async () => {
          const v = await run(() => createVariant({ groupId: g.id, name: newVar, startQuantity: Number(newQty) || 0, dailyRecordId: day?.status === 'open' ? day.id : null }), 'Variação criada');
          if (v) { setNewVar(''); setNewQty(''); }
        }}>＋</Button>
      </div>

      <h3 className="font-bold text-slate-700 mt-6 mb-2">Mais ações</h3>
      {active.length > 0 && data.groups.length > 0 && (
        <div className="flex gap-2 mb-2">
          <select value={transfer} onChange={(e) => setTransfer(e.target.value)} className="flex-1 h-11 rounded-xl border border-slate-300 bg-white px-2">
            <option value="">Transferir variações para...</option>
            {data.groups.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
          <Button variant="outline" disabled={!transfer} onClick={async () => {
            const dest = data.groups.find((x) => x.id === transfer)!;
            if (await confirm({ title: 'Transferir variações?', message: <>De <b>{g.name}</b> para <b>{dest.name}</b>: {active.length + archivedV.length} variações mudam de grupo. Estoques e vendas passadas continuam iguais.</>, confirm: 'Transferir' })) {
              await run(() => transferVariants(g.id, transfer), 'Transferido'); setTransfer('');
            }
          }}>Mover</Button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="soft" onClick={async () => {
          if (g.archivedAt) return run(() => archiveGroup(g.id, false), 'Reativado');
          if (await confirm({ title: `Arquivar ${g.name}?`, message: 'Sai das listas, mas o histórico fica guardado e dá para reativar.', confirm: 'Arquivar', tone: 'warning' })) {
            await run(() => archiveGroup(g.id, true), 'Arquivado'); onClose();
          }
        }}>{g.archivedAt ? 'Reativar' : '🗄️ Arquivar'}</Button>
        <Button variant="soft" className="!text-red-600" onClick={async () => {
          if (await groupHasHistory(g.id)) {
            if (await confirm({ title: 'Não dá para excluir', message: 'Este grupo tem histórico (estoque, vendas ou movimentos). Quer arquivar em vez disso?', confirm: 'Arquivar', tone: 'warning' })) {
              await run(() => archiveGroup(g.id, true), 'Arquivado'); onClose();
            }
            return;
          }
          if (await confirm({ title: `Excluir ${g.name}?`, message: 'Sem histórico — será excluído de vez.', confirm: 'Excluir', tone: 'danger' })) {
            const r = await run(() => deleteGroup(g.id), 'Excluído'); if (r !== undefined) onClose();
          }
        }}>🗑️ Excluir</Button>
      </div>
      <VariantEditor id={editVar} onClose={() => setEditVar(null)} />
    </Sheet>
  );
}

function VariantEditor({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { run, confirm } = useUi();
  const [dest, setDest] = useState('');
  const data = useLiveQuery(async () => {
    if (!id) return null;
    const v = await db.variants.get(id);
    const groups = await db.groups.toArray();
    return { v, groups };
  }, [id]);
  if (!id || !data?.v) return null;
  const v: Variant = data.v;
  const group = data.groups.find((g) => g.id === v.groupId);
  const others = data.groups.filter((g) => g.id !== v.groupId && !g.archivedAt);
  return (
    <Sheet open onClose={onClose} title={<span className="flex items-center gap-2"><Swatch color={v.color} />{group?.name} · {v.name}</span>} tall>
      <NameField key={v.id + v.name} value={v.name} onSave={(name) => run(() => updateVariant(v.id, { name }), 'Nome alterado')} />
      <ColorField value={v.color} onChange={(c) => run(() => updateVariant(v.id, { color: c }))} />
      <NumberField key={'i' + v.id + v.idealStock} label="Estoque ideal"
        hint={`Quantas peças você quer ter. “Repor” = ideal − o que tem. Ex.: ideal 15, vendeu 1 → repor 1. Vazio = usa a quantidade do cadastro (${v.startQuantity}).`}
        value={v.idealStock === null || v.idealStock === undefined ? '' : String(v.idealStock)}
        onSave={(t) => run(() => updateVariant(v.id, { idealStock: t === '' ? null : Number(t) }), 'Salvo')} />
      <NumberField key={'p' + v.id + v.optionalPriceInCents} label="Preço de venda (opcional)" hint="Já vem preenchido na venda. Vazio = digitar na hora." decimal
        value={v.optionalPriceInCents ? money(v.optionalPriceInCents) : ''}
        onSave={(t) => run(() => updateVariant(v.id, { optionalPriceInCents: t === '' ? null : toCents(t) }), 'Salvo')} />
      <NameField key={'d' + v.id} label="Descrição (opcional)" value={v.description ?? ''} allowEmpty onSave={(description) => run(() => updateVariant(v.id, { description }), 'Salvo')} />
      <NameField key={'n' + v.id} label="Observações (opcional)" value={v.notes ?? ''} allowEmpty onSave={(notes) => run(() => updateVariant(v.id, { notes }), 'Salvo')} />
      <Toggle label="Ativa (aparece nas operações)" checked={v.active} onChange={(a) => run(() => setVariantActive(v.id, a))} />

      <h3 className="font-bold text-slate-700 mt-4 mb-2">Mover para outro grupo</h3>
      <div className="flex gap-2">
        <select value={dest} onChange={(e) => setDest(e.target.value)} className="flex-1 h-11 rounded-xl border border-slate-300 bg-white px-2">
          <option value="">Escolha o grupo...</option>
          {others.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <Button variant="outline" disabled={!dest} onClick={async () => {
          const to = others.find((g) => g.id === dest)!;
          if (await confirm({ title: 'Mover variação?', message: <>Atual: <b>{group?.name}</b><br />Destino: <b>{to.name}</b><br /><br />A variação “{v.name}” passa a aparecer em {to.name}. Estoques dos dias anteriores não mudam e o histórico continua ligado a ela.</>, confirm: 'Mover' })) {
            const r = await run(() => moveVariant(v.id, dest), 'Movida'); if (r !== undefined) { setDest(''); onClose(); }
          }
        }}>Mover</Button>
      </div>

      <div className="grid grid-cols-2 gap-2 mt-5">
        <Button variant="soft" onClick={async () => {
          await run(() => archiveVariant(v.id, !v.archivedAt), v.archivedAt ? 'Reativada' : 'Arquivada'); onClose();
        }}>{v.archivedAt ? 'Reativar' : '🗄️ Arquivar'}</Button>
        <Button variant="soft" className="!text-red-600" onClick={async () => {
          if (await variantHasHistory(v.id)) {
            if (await confirm({ title: 'Não dá para excluir', message: 'Esta variação tem histórico. Quer arquivar em vez disso?', confirm: 'Arquivar', tone: 'warning' })) {
              await run(() => archiveVariant(v.id, true), 'Arquivada'); onClose();
            }
            return;
          }
          if (await confirm({ title: `Excluir ${v.name}?`, confirm: 'Excluir', tone: 'danger' })) {
            const r = await run(() => deleteVariant(v.id), 'Excluída'); if (r !== undefined) onClose();
          }
        }}>🗑️ Excluir</Button>
      </div>
    </Sheet>
  );
}

function NameField({ value, onSave, label = 'Nome', hint, allowEmpty }: { value: string; onSave: (v: string) => void; label?: string; hint?: string; allowEmpty?: boolean }) {
  const [v, setV] = useState(value);
  const dirty = v !== value && (allowEmpty || v.trim());
  return (
    <Field label={label} hint={hint}>
      <div className="flex gap-2">
        <Input value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && dirty && onSave(v)} />
        {dirty && <Button className="h-12" onClick={() => onSave(v)}>Salvar</Button>}
      </div>
    </Field>
  );
}

function NumberField({ value, onSave, label, hint, decimal }: { value: string; onSave: (v: string) => void; label: string; hint?: string; decimal?: boolean }) {
  const [v, setV] = useState(value);
  return (
    <Field label={label} hint={hint}>
      <div className="flex gap-2">
        <Input inputMode={decimal ? 'decimal' : 'numeric'} value={v} onChange={(e) => setV(decimal ? e.target.value : e.target.value.replace(/\D/g, ''))} />
        {v !== value && <Button className="h-12" onClick={() => onSave(v)}>Salvar</Button>}
      </div>
    </Field>
  );
}

function Categories() {
  const { run, confirm } = useUi();
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[8]);
  const cats = useLiveQuery(() => db.categories.orderBy('displayOrder').toArray(), []);
  return (
    <>
      <h3 className="font-bold text-slate-700 mt-6 mb-1">Etiquetas (opcional)</h3>
      <p className="text-xs text-slate-500 mb-2">Ex.: Novidades, Mais vendidos, Promoção. Marque nos grupos.</p>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {cats?.map((c) => (
          <span key={c.id} className="h-8 pl-3 pr-1 rounded-full text-sm font-semibold text-white flex items-center gap-1" style={{ background: c.color }}>
            #{c.name}
            <button className="w-6 h-6 rounded-full bg-black/20" onClick={async () => {
              if (await confirm({ title: `Apagar #${c.name}?`, message: 'Os grupos não são afetados.', confirm: 'Apagar', tone: 'danger' })) run(() => deleteCategory(c.id));
            }}>✕</button>
          </span>
        ))}
      </div>
      <div className="flex gap-2 items-center">
        <Input placeholder="Nova etiqueta" value={name} onChange={(e) => setName(e.target.value)} />
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="w-12 h-12 rounded-xl border border-slate-300 shrink-0" />
        <Button className="h-12" disabled={!name.trim()} onClick={async () => { const c = await run(() => createCategory(name, color)); if (c) setName(''); }}>＋</Button>
      </div>
    </>
  );
}
