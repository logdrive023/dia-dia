import { useState } from 'react';
import { runDiagnostics, type Finding } from '../services/diagnostics';
import { money, PAYMENT_EMOJI, PAYMENT_LABEL, PAYMENTS, toCents } from '../lib/util';
import type { PaymentMethod } from '../db/types';
import { setSetting } from '../services/settings';
import { resetToInitialData, resetToZero } from '../services/backup';
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

/** Configurações: tudo salva na hora (igual ao resto do app), com explicação e exemplo em cada parte. */
export default function SettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings } = useApp();
  const { run, toast } = useUi();
  const [symbol, setSymbol] = useState(settings.currencySymbol);
  const [title, setTitle] = useState(settings.reportTitle);
  if (!open) return null;
  const saved = () => toast('Salvo');
  const [pay, setPay] = useState(money(settings.dailyPayInCents));
  const savePay = () => {
    const c = toCents(pay);
    if (c === null || c <= 0) { setPay(money(settings.dailyPayInCents)); return; }
    if (c !== settings.dailyPayInCents) run(() => setSetting('dailyPayInCents', c)).then(saved);
  };
  const saveSymbol = () => { if (symbol.trim() !== settings.currencySymbol) run(() => setSetting('currencySymbol', symbol.trim().slice(0, 4))).then(saved); };
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
    <Sheet open onClose={() => { saveSymbol(); saveTitle(); onClose(); }} title="⚙️ Configurações" tall>
      <div className="flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 mb-4 text-[13px] text-emerald-800">
        <span>✓</span><span className="flex-1">Tudo aqui <b>salva sozinho</b> assim que você muda.</span>
      </div>

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

/** Duas formas de recomeçar: com os dados iniciais oficiais ou do zero (app vazio). */
function ResetButtons() {
  const { run, confirm } = useUi();
  const go = async (kind: 'inicial' | 'zero') => {
    const zero = kind === 'zero';
    if (!(await confirm({
      title: zero ? 'Reiniciar tudo do 0?' : 'Voltar aos dados iniciais?', tone: 'danger',
      confirm: zero ? 'Sim, apagar tudo' : 'Sim, voltar aos iniciais',
      message: zero
        ? 'O app fica vazio: sem grupos, sem peças, sem dias e caixa em 0. O app guarda uma cópia antes (dá para voltar em Backup).'
        : 'Volta o estoque da lista oficial e os cadernos de 30/10 e 31/10. Tudo o que foi lançado é apagado. O app guarda uma cópia antes (dá para voltar em Backup).',
    }))) return;
    const ok = await run(() => (zero ? resetToZero() : resetToInitialData()), zero ? 'Pronto! App zerado.' : 'Pronto! Dados iniciais carregados.');
    if (ok !== undefined) setTimeout(() => location.reload(), 600);
  };
  return (
    <div className="space-y-2">
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
