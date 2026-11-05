import { useEffect, useState } from 'react';
import { runDiagnostics, type Finding } from '../services/diagnostics';
import { money, PAYMENT_EMOJI, PAYMENT_LABEL, PAYMENTS, toCents } from '../lib/util';
import type { PaymentMethod } from '../db/types';
import { setSetting } from '../services/settings';
import { resetToInitialData, resetToZero } from '../services/backup';
import { BUSY_MESSAGE, dbResponds, requestPersist, storageStatus } from '../services/storage';
import { useApp } from '../state';
import { Button, Card, InfoTip, Input, Sheet, Toggle, useUi } from '../components/ui';

/** Seção em cartão: título, ⓘ com exemplo e conteúdo. */
function Section({ icon, title, tip, children }: { icon: string; title: string; tip: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-1.5 px-1">
        <span className="text-lg">{icon}</span>
        <span className="flex-1 text-[15px] font-bold text-slate-800">{title}</span>
        {tip}
      </div>
      <Card className="p-3.5">{children}</Card>
    </div>
  );
}

/** Lista que a usuária edita (tipos, tamanhos, ícones): toca no × para tirar, escreve e “Acrescentar”. */
function ListEditor({ items, onChange, placeholder, label, upper }: { items: string[]; onChange: (l: string[]) => void; placeholder: string; label: string; upper?: boolean }) {
  const [t, setT] = useState('');
  const add = () => {
    const v = (upper ? t.toUpperCase() : t).trim().slice(0, 20);
    if (!v || items.some((x) => x.toLowerCase() === v.toLowerCase())) { setT(''); return; }
    onChange([...items, v]); setT('');
  };
  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-2" aria-label={label}>
        {items.map((x) => (
          <span key={x} className="inline-flex items-center gap-1 rounded-full bg-slate-100 border border-slate-200 pl-2.5 pr-1 h-8 text-[14px] font-semibold text-slate-700">
            {x}<button onClick={() => onChange(items.filter((y) => y !== x))} aria-label={`Tirar ${x}`} className="w-6 h-6 rounded-full text-slate-500 active:bg-slate-200">×</button>
          </span>
        ))}
        {!items.length && <span className="text-[13px] text-slate-400">Nenhum ainda.</span>}
      </div>
      <div className="flex gap-2">
        <Input value={t} onChange={(e) => setT(e.target.value)} placeholder={placeholder} aria-label={`Novo: ${label}`} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <Button variant="outline" disabled={!t.trim()} onClick={add}>Acrescentar</Button>
      </div>
    </div>
  );
}

/** Cores da usuária: escolhe a cor e dá um nome (aparece em “Minhas cores” no cadastro). */
function CustomColors({ list, onChange }: { list: [string, string][]; onChange: (l: [string, string][]) => void }) {
  const [hex, setHex] = useState('#7c3aed');
  const [name, setName] = useState('');
  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {list.map(([c, n]) => (
          <span key={c} className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 border border-slate-200 pl-1 pr-1 h-8 text-[14px] font-semibold text-slate-700">
            <span className="w-6 h-6 rounded-full border border-slate-300" style={{ background: c }} />{n}
            <button onClick={() => onChange(list.filter(([x]) => x !== c))} aria-label={`Tirar ${n}`} className="w-6 h-6 rounded-full text-slate-500 active:bg-slate-200">×</button>
          </span>
        ))}
        {!list.length && <span className="text-[13px] text-slate-400">Nenhuma ainda.</span>}
      </div>
      <div className="flex gap-2 items-center">
        <input type="color" value={hex} onChange={(e) => setHex(e.target.value)} aria-label="Escolher a cor" className="w-12 h-11 rounded-lg border border-slate-200 bg-white p-1" />
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome (ex.: Verde água)" aria-label="Nome da cor" />
        <Button variant="outline" disabled={!name.trim()} onClick={() => { onChange([...list.filter(([x]) => x.toLowerCase() !== hex.toLowerCase()), [hex, name.trim().slice(0, 24)]]); setName(''); }}>Acrescentar</Button>
      </div>
    </div>
  );
}

/** Configurações: tudo salva na hora (igual ao resto do app), com explicação e exemplo em cada parte. */
export default function SettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings, openHistory } = useApp();
  const { run, toast } = useUi();
  const [symbol, setSymbol] = useState(settings.currencySymbol);
  const [title, setTitle] = useState(settings.reportTitle);
  const [userName, setUserName] = useState(settings.userName);
  if (!open) return null;
  const saved = () => toast('Salvo');
  const [pay, setPay] = useState(money(settings.dailyPayInCents));
  const savePay = () => {
    const c = toCents(pay);
    if (c === null || c <= 0) { setPay(money(settings.dailyPayInCents)); return; }
    if (c !== settings.dailyPayInCents) run(() => setSetting('dailyPayInCents', c)).then(saved);
  };
  const saveSymbol = () => { if (symbol.trim() !== settings.currencySymbol) run(() => setSetting('currencySymbol', symbol.trim().slice(0, 4))).then(saved); };
  const saveUser = () => { const t = userName.trim().slice(0, 40); if (t !== settings.userName) run(() => setSetting('userName', t)).then(saved); };
  const saveTitle = () => { const t = title.trim().slice(0, 30) || 'Check List'; if (t !== settings.reportTitle) run(() => setSetting('reportTitle', t)).then(saved); };
  const toggleMethod = (p: PaymentMethod, on: boolean) => {
    const list = on ? PAYMENTS.filter((x) => x === p || settings.paymentMethods.includes(x)) : settings.paymentMethods.filter((x) => x !== p);
    if (!list.length) { toast('Deixe pelo menos uma forma de pagamento ligada.', 'err'); return; }
    run(async () => {
      await setSetting('paymentMethods', list);
      if (!on && settings.defaultPayment === p) await setSetting('defaultPayment', list[0]);
    });
  };

  return (
    <Sheet open onClose={() => { saveSymbol(); saveTitle(); saveUser(); onClose(); }} title="⚙️ Configurações" tall>
      <div className="flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 mb-4 text-[13px] text-emerald-800">
        <span>✓</span><span className="flex-1">Tudo aqui <b>salva sozinho</b> assim que você muda.</span>
      </div>

      <Section icon="📜" title="Histórico de movimentações" tip={
        <InfoTip title="Histórico de movimentações" example={[
          ['🌅', 'Azul Celeste: começou com 7'],
          ['✏️', 'Ajuste manual −3 · por Ana'],
          ['🌙', 'Terminou com 4'],
          ['⚠️', 'Se a conta não fecha e não há registro: “Divergência não explicada”'],
        ]}>A vida de cada peça desde o cadastro, com filtros por data, grupo, peça, tipo e quem fez.</InfoTip>}>
        <Button className="w-full" variant="outline" onClick={() => openHistory(null)}>📜 Abrir o histórico</Button>
      </Section>

      <Section icon="🙋" title="Seu nome" tip={
        <InfoTip title="Seu nome" example={[
          ['✏️', <>Escreva <b>“Ana”</b></>],
          ['📜', <>No Histórico de movimentações: “Ajuste manual · <b>Ana</b>”, “Entrada · <b>Ana</b>”</>],
          ['🤖', 'O que o app faz sozinho (saída de uma venda, reserva) aparece como “Sistema”'],
        ]}>Aparece em cada registro feito por você. Registros antigos ficam como “registro antigo”.</InfoTip>}>
        <Input value={userName} onChange={(e) => setUserName(e.target.value)} onBlur={saveUser} placeholder="Ex.: Ana" aria-label="Seu nome" />
      </Section>

      <Section icon="📥" title="Entrada de estoque" tip={
        <InfoTip title="Mercadoria nova × reposição" example={[
          ['📦', <><b>Mercadoria nova:</b> peça que a loja ainda não tinha</>],
          ['🔁', <><b>Reposição:</b> mais peças de algo que já vende</>],
          ['👆', 'Aqui é só o padrão: em cada entrada dá para escolher o outro'],
        ]}>Define o que vem marcado no “+” e na “Entrada” do Estoque.</InfoTip>}>
        <Toggle checked={settings.entryNewByDefault} onChange={(v) => run(() => setSetting('entryNewByDefault', v)).then(saved)}
          label={settings.entryNewByDefault ? 'Entrada é mercadoria nova (padrão)' : 'Entrada é reposição (padrão)'} />
      </Section>

      <Section icon="👗" title="Tipos de produto" tip={
        <InfoTip title="Tipos de produto" example={[
          ['👗', 'Vestido, Macacão, Blusa, Calça, Saia… (você acrescenta e tira)'],
          ['🏷️', 'No cadastro de cada produto dá para escolher o tipo (opcional)'],
          ['🧰', 'Serve para qualquer loja: ex.: Caneca, Camiseta, Bolsa'],
        ]}>Não é obrigatório: produto sem tipo continua normal.</InfoTip>}>
        <ListEditor label="Tipos de produto" items={settings.productTypes} placeholder="Ex.: Shorts" onChange={(l) => run(() => setSetting('productTypes', l)).then(saved)} />
      </Section>

      <Section icon="📏" title="Tamanhos" tip={
        <InfoTip title="Tamanhos" example={[
          ['📏', 'P, M, G, GG, XG… (você acrescenta e tira; ex.: 36, 38, Único)'],
          ['👕', 'Camiseta Azul: P 5 · M 10 · G 5 → cada tamanho tem o próprio estoque'],
          ['🧾', 'Aparece no estoque, nas vendas, nas reservas, na importação e no histórico'],
        ]}>Opcional: produto sem tamanho continua normal.</InfoTip>}>
        <ListEditor upper label="Tamanhos" items={settings.sizes} placeholder="Ex.: 38" onChange={(l) => run(() => setSetting('sizes', l)).then(saved)} />
      </Section>

      <Section icon="🎨" title="Minhas cores e ícones" tip={
        <InfoTip title="Cores e ícones" example={[
          ['🎨', 'Cores novas aparecem em “Minhas cores” no cadastro'],
          ['✨', 'Ícones novos aparecem na escolha do ícone do grupo'],
        ]}>As cores que já vêm no app ficam separadas em neutras, quentes e frias.</InfoTip>}>
        <div className="text-[13px] font-semibold text-slate-700 mb-1.5">Cores</div>
        <CustomColors list={settings.customColors} onChange={(l) => run(() => setSetting('customColors', l)).then(saved)} />
        <div className="text-[13px] font-semibold text-slate-700 mb-1.5 mt-3">Ícones (cole um emoji)</div>
        <ListEditor label="Ícones" items={settings.customIcons} placeholder="Ex.: 🧥" onChange={(l) => run(() => setSetting('customIcons', l)).then(saved)} />
      </Section>

      <Section icon="💳" title="Formas de pagamento" tip={
        <InfoTip title="Formas de pagamento" example={[
          ['🔛', <><b>Ligada:</b> aparece na hora de vender</>],
          ['⭐', <><b>Padrão:</b> já vem marcada (ex.: quase tudo é no Pix → deixe o Pix como padrão)</>],
          ['🔹', <>“Outro” serve para fiado, troca, vale…</>],
        ]}>Escolha como as clientes pagam. Desligar não apaga nada do que já foi vendido.</InfoTip>}>
        <div className="divide-y divide-slate-100 -my-1">
          {PAYMENTS.map((p) => {
            const on = settings.paymentMethods.includes(p);
            const isDefault = settings.defaultPayment === p;
            return (
              <div key={p} className="flex items-center gap-3 py-2">
                <span className="text-xl w-7 text-center">{PAYMENT_EMOJI[p]}</span>
                <span className={`flex-1 font-semibold ${on ? 'text-slate-800' : 'text-slate-400'}`}>{PAYMENT_LABEL[p]}</span>
                {on && (
                  <button onClick={() => run(() => setSetting('defaultPayment', p))} aria-pressed={isDefault}
                    className={`h-9 px-3 rounded-full text-[12px] font-bold ${isDefault ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-500'}`}>
                    {isDefault ? '⭐ padrão' : 'tornar padrão'}
                  </button>
                )}
                <button type="button" role="switch" aria-checked={on} aria-label={`${PAYMENT_LABEL[p]} ${on ? 'ligado' : 'desligado'}`}
                  onClick={() => toggleMethod(p, !on)} className="min-h-11 flex items-center">
                  <span className={`w-12 h-7 rounded-full p-0.5 transition ${on ? 'bg-blue-600' : 'bg-slate-300'}`}>
                    <span className={`block w-6 h-6 rounded-full bg-white shadow transition ${on ? 'translate-x-5' : ''}`} />
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      </Section>

      <Section icon="💼" title="Sua diária" tip={
        <InfoTip title="Diária" example={[
          ['🌅', <>Ligado: ao <b>iniciar o dia</b>, já entra “Pagamento da diária de 01/11: 150”</>],
          ['✖️', 'Não recebeu nesse dia? Tire no ✕ em Caixa › Movimentado hoje'],
          ['💼', <>Pagou dias atrasados? Caixa › <b>Pagamento</b> › “2 dias” (2 diárias de 150)</>],
          ['🧮', 'O pagamento sai do saldo depois do “Ontem + hoje”, como no caderno'],
          ['💬', 'Cada dia vira uma linha no WhatsApp: “➖ 💼 Pagamento da diária de 31/10: 150”'],
        ]}>Quanto você recebe por dia. Só preenche a sugestão; dá para mudar o valor na hora de lançar.</InfoTip>}>
        <Toggle checked={settings.autoDailyPay} onChange={(v) => run(() => setSetting('autoDailyPay', v)).then(saved)} label="Lançar a diária sozinha ao iniciar o dia" />
        <div className="flex items-center gap-3">
          <Input inputMode="decimal" value={pay} onChange={(e) => setPay(e.target.value)} onBlur={savePay} placeholder="150" className="!w-32" />
          <span className="flex-1 text-right text-slate-500 text-sm">2 dias = <b className="text-slate-800 text-base">{money((toCents(pay) ?? settings.dailyPayInCents) * 2)}</b></span>
        </div>
      </Section>

      <Section icon="💲" title="Moeda" tip={
        <InfoTip title="Símbolo da moeda" example={[
          ['✍️', <>Digite <b>R$</b> → aparece “R$ 70”</>],
          ['🫥', <>Deixe vazio → aparece só “70”, como no caderno</>],
        ]}>Só muda como o valor aparece na tela e no relatório. Os valores não mudam.</InfoTip>}>
        <div className="flex items-center gap-3">
          <Input value={symbol} onChange={(e) => setSymbol(e.target.value)} onBlur={saveSymbol} placeholder="vazio = só números" className="!w-40" />
          <span className="flex-1 text-right text-slate-500 text-sm">Fica: <b className="text-slate-800 text-base">{money(7000, symbol.trim())}</b></span>
        </div>
      </Section>

      <Section icon="💾" title="Lembrete de backup" tip={
        <InfoTip title="Lembrete de backup" example={[
          ['📅', <>Escolheu <b>7 dias</b>: uma semana sem backup → aparece o aviso no Início</>],
          ['🛡️', 'Quanto menor, mais seguro (vende muito? use 3 dias)'],
        ]}>O Início avisa quando passar esse tempo sem fazer cópia dos dados.</InfoTip>}>
        <div className="grid grid-cols-4 gap-2">
          {[3, 7, 15, 30].map((d) => (
            <button key={d} onClick={() => run(() => setSetting('backupReminderDays', d))}
              className={`h-11 rounded-xl text-sm font-bold border ${settings.backupReminderDays === d ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-slate-200 text-slate-600'}`}>
              {d} dias
            </button>
          ))}
        </div>
      </Section>

      <Section icon="📒" title="Relatório do caderno" tip={
        <InfoTip title="Título do relatório" example={[
          ['📝', <>Título <b>“Check List”</b> → o relatório no formato caderno começa com “Check List”</>],
          ['💬', 'O relatório do WhatsApp não muda'],
        ]}>É o nome que aparece no topo do relatório em formato de caderno.</InfoTip>}>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={saveTitle} placeholder="Check List" />
      </Section>

      <Section icon="🛡️" title="Dados guardados neste celular" tip={
        <InfoTip title="Dados guardados" example={[
          ['🛡️', <><b>Protegido</b>: o navegador não apaga os dados, nem com o celular cheio</>],
          ['📲', 'Instale o app na tela inicial: o Android (Samsung e Chrome) protege na hora'],
          ['⚠️', 'Abra sempre pelo mesmo ícone: Chrome e Samsung Internet guardam dados separados'],
          ['🕵️', 'Não use aba anônima/secreta: ao fechar, apaga tudo'],
        ]}>Os dados ficam só neste celular. Faça backup de vez em quando.</InfoTip>}>
        <StorageBox />
      </Section>

      <Section icon="🩺" title="Verificar dados" tip={
        <InfoTip title="Verificar dados" example={[
          ['✅', '“Tudo certo” = estoque, vendas e caixa batem entre si'],
          ['⚠️', 'Aviso amarelo = algo para olhar (ex.: dia antigo ainda aberto)'],
          ['⛔', 'Erro vermelho = algo não bate; faça um backup e chame ajuda'],
        ]}>Confere se tudo está coerente. Só lê, não muda nada.</InfoTip>}>
        <Diagnostics />
      </Section>

      <Section icon="🔄" title="Recomeçar" tip={
        <InfoTip title="Recomeçar" example={[
          ['📒', <><b>Voltar aos dados iniciais:</b> estoque da lista oficial (238 peças) e os cadernos de 30/10 e 31/10</>],
          ['🧹', <><b>Reiniciar tudo do 0:</b> app vazio, sem grupos, sem peças, sem dias, caixa em 0</>],
          ['↩️', 'Nos dois, o app guarda uma cópia antes (Menu › Backup › Voltar como estava)'],
        ]}>Escolha uma das duas. Tudo o que foi lançado neste celular é apagado.</InfoTip>}>
        <ResetButtons />
      </Section>

      <p className="text-xs text-slate-400 text-center mt-2">Dia a Dia · funciona offline · dados só neste aparelho</p>
    </Sheet>
  );
}

function Diagnostics() {
  const [res, setRes] = useState<{ findings: Finding[]; checked: Record<string, number> } | null>(null);
  const [busy, setBusy] = useState(false);
  const errors = res?.findings.filter((f) => f.level === 'erro').length ?? 0;
  return (
    <div>
      <Button variant="outline" className="w-full" disabled={busy} onClick={async () => {
        setBusy(true);
        try { setRes(await runDiagnostics()); } finally { setBusy(false); }
      }}>🩺 {busy ? 'Verificando…' : 'Verificar agora'}</Button>
      {res && (
        <div className="mt-3">
          <div className={`font-bold ${errors ? 'text-red-600' : 'text-emerald-600'}`}>
            {errors ? `⚠ ${errors} problema(s) encontrado(s)` : '✅ Tudo certo com os dados'}
          </div>
          <div className="text-xs text-slate-500 mb-2">
            Conferidos: {Object.entries(res.checked).map(([k, v]) => `${v} ${k}`).join(' · ')}
          </div>
          {res.findings.map((f, i) => (
            <div key={i} className={`rounded-lg px-3 py-2 mb-1.5 text-sm ${f.level === 'erro' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-900'}`}>
              <div className="font-semibold">{f.level === 'erro' ? '⛔' : '⚠'} {f.title}</div>
              {f.detail && <div className="text-xs mt-0.5">{f.detail}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Segundos que o botão de apagar fica travado (dá tempo de ler o aviso). Os testes de tela usam 0. */
export const RESET_WAIT = { seconds: 10 };

/**
 * Aviso antes de apagar tudo: bem vermelho, diz o que some e trava o botão por alguns segundos
 * (evita apagar com um toque sem querer). Voltar ou tocar fora = não apaga nada.
 */
function DangerConfirm({ zero, onCancel, onConfirm }: { zero: boolean; onCancel: () => void; onConfirm: () => void }) {
  const [left, setLeft] = useState(RESET_WAIT.seconds);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-5">
      <div className="absolute inset-0 bg-slate-900/60" onClick={onCancel} />
      <div role="alertdialog" aria-label={zero ? 'Reiniciar tudo do 0?' : 'Voltar aos dados iniciais?'}
        className="relative bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden border-2 border-red-500">
        <div className="bg-red-600 text-white px-5 py-3 text-center">
          <div className="text-3xl">⚠️</div>
          <div className="text-lg font-extrabold">ATENÇÃO: VAI APAGAR TUDO</div>
        </div>
        <div className="p-5 text-[15px] text-slate-700 space-y-2">
          <p className="font-bold text-slate-900">{zero ? 'Reiniciar tudo do 0?' : 'Voltar aos dados iniciais?'}</p>
          <p>Isso <b className="text-red-700">APAGA deste celular</b>:</p>
          <ul className="list-disc pl-5 space-y-0.5">
            <li>todas as <b>vendas</b> e o <b>caixa</b></li>
            <li>todos os <b>dias</b> e o <b>histórico</b></li>
            <li>{zero ? <>todos os <b>grupos e peças</b> (o app fica vazio)</> : <>o <b>estoque</b> volta para a lista oficial de 30/10</>}</li>
          </ul>
          <p className="text-[13px] text-slate-500">O app guarda uma cópia antes (Backup › voltar como estava), mas faça um backup se não tiver certeza.</p>
        </div>
        <div className="flex gap-2 px-5 pb-5">
          <Button variant="soft" className="flex-1" onClick={onCancel}>Voltar</Button>
          <Button variant="danger" className="flex-1" disabled={left > 0} onClick={onConfirm}>
            {left > 0 ? `Aguarde ${left}s…` : zero ? 'Sim, apagar tudo' : 'Sim, voltar aos iniciais'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Tela de carregamento enquanto apaga: deixa claro que está apagando e que não deve fechar o app. */
function Deleting() {
  return (
    <div role="status" className="fixed inset-0 z-[80] bg-white/95 flex flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="w-14 h-14 rounded-full border-4 border-red-200 border-t-red-600 animate-spin" />
      <div className="text-lg font-bold text-red-700">Apagando os dados…</div>
      <div className="text-sm text-slate-600">Não feche o app. Ele abre de novo sozinho quando terminar.</div>
    </div>
  );
}

/** Duas formas de recomeçar: com os dados iniciais oficiais ou do zero (app vazio). */
function ResetButtons() {
  const { run, confirm } = useUi();
  const { resetCart } = useApp();
  const [asking, setAsking] = useState<null | ((ok: boolean) => void)>(null);
  const [askZero, setAskZero] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const ask = (zero: boolean) => new Promise<boolean>((resolve) => { setAskZero(zero); setAsking(() => resolve); });
  const answer = (ok: boolean) => { asking?.(ok); setAsking(null); };
  const go = async (kind: 'inicial' | 'zero') => {
    const zero = kind === 'zero';
    if (!(await ask(zero))) return;
    // Antes de apagar, confere se o banco responde. Se outra janela do app estiver segurando os dados, o apagar
    // ficaria esperando e poderia acontecer sozinho mais tarde. Então não apaga nada e explica o que fazer.
    if ((await dbResponds()) === 'busy') {
      await confirm({ title: 'Não foi possível apagar agora', message: BUSY_MESSAGE, confirm: 'Entendi' });
      return;
    }
    // as funções não devolvem nada: devolve true para saber que deu certo (antes não recarregava e o carrinho ficava na tela)
    setDeleting(true);
    const ok = await run(async () => { await (zero ? resetToZero() : resetToInitialData()); return true; }, zero ? 'Pronto! App zerado.' : 'Pronto! Dados iniciais carregados.');
    if (ok) { resetCart(); setTimeout(() => location.reload(), 600); } else setDeleting(false);
  };
  return (
    <div className="space-y-2">
      {asking && <DangerConfirm zero={askZero} onCancel={() => answer(false)} onConfirm={() => answer(true)} />}
      {deleting && <Deleting />}
      <button onClick={() => go('inicial')} className="w-full flex items-center gap-3 rounded-xl border-2 border-blue-200 bg-blue-50 px-3 py-3 text-left active:bg-blue-100">
        <span className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center text-xl shrink-0">📒</span>
        <span className="flex-1 min-w-0">
          <span className="block text-[15px] font-bold text-blue-900">Voltar aos dados iniciais</span>
          <span className="block text-[12px] text-slate-600 break-words">Estoque da lista oficial + cadernos de 30/10 e 31/10</span>
        </span>
      </button>
      <button onClick={() => go('zero')} className="w-full flex items-center gap-3 rounded-xl border-2 border-red-200 bg-red-50 px-3 py-3 text-left active:bg-red-100">
        <span className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center text-xl shrink-0">🧹</span>
        <span className="flex-1 min-w-0">
          <span className="block text-[15px] font-bold text-red-700">Reiniciar tudo do 0</span>
          <span className="block text-[12px] text-slate-600 break-words">App vazio: sem grupos, sem peças, sem dias, caixa em 0</span>
        </span>
      </button>
    </div>
  );
}

function StorageBox() {
  const { run } = useUi();
  const [tick, setTick] = useState(0);
  const [st, setSt] = useState<Awaited<ReturnType<typeof storageStatus>> | null>(null);
  // o teste de gravação escreve no banco: roda fora do useLiveQuery (que só pode ler)
  useEffect(() => { let on = true; storageStatus().then((x) => { if (on) setSt(x); }); return () => { on = false; }; }, [tick]);
  if (!st) return <p className="text-sm text-slate-500">Conferindo…</p>;
  const mb = (n: number | null) => (n === null ? '—' : `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`);
  return (
    <div className="space-y-2">
      <div className={`rounded-xl px-3 py-2.5 text-[14px] font-semibold ${st.persisted ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>
        {st.persisted ? '🛡️ Protegido: o navegador não apaga os dados' : st.supported ? '⚠️ Ainda não protegido: o navegador pode apagar se faltar espaço' : '⚠️ Este navegador não permite proteger: faça backup com frequência'}
      </div>
      <div className={`rounded-xl px-3 py-2 text-[13px] ${st.writeOk ? 'bg-slate-50 text-slate-700' : 'bg-red-50 text-red-700 font-semibold'}`}>
        {st.writeOk ? '✅ Teste de gravação: salvando normalmente'
          : st.busy ? `⏳ A gravação ficou esperando. ${BUSY_MESSAGE}`
          : '❌ Teste de gravação falhou: o celular não está salvando (saia da aba anônima / libere espaço)'}
      </div>
      {st.busy && <Button variant="outline" className="w-full" onClick={() => setTick((t) => t + 1)}>Conferir de novo</Button>}
      <div className="text-[12px] text-slate-500">Usando {mb(st.usage)}{st.quota ? ` de ${mb(st.quota)} disponíveis` : ''}</div>
      {!st.persisted && st.supported && (
        <Button variant="outline" className="w-full" onClick={() => run(async () => { await requestPersist(); setTick((t) => t + 1); })}>🛡️ Proteger agora</Button>
      )}
    </div>
  );
}
