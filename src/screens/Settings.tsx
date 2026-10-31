import { useState } from 'react';
import { runDiagnostics, type Finding } from '../services/diagnostics';
import { PAYMENT_EMOJI, PAYMENT_LABEL, PAYMENTS } from '../lib/util';
import { setSetting } from '../services/settings';
import { useApp } from '../state';
import { Button, Card, Field, Input, SectionTitle, Sheet, Toggle, useUi } from '../components/ui';

export default function SettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings, setOverlay } = useApp();
  const { run } = useUi();
  const [symbol, setSymbol] = useState(settings.currencySymbol);
  const [low, setLow] = useState(String(settings.lowStockDefault));
  const [title, setTitle] = useState(settings.reportTitle);
  const [remind, setRemind] = useState(String(settings.backupReminderDays));
  if (!open) return null;
  const save = () => run(async () => {
    await setSetting('currencySymbol', symbol.trim());
    await setSetting('lowStockDefault', Math.max(0, Number(low) || 0));
    await setSetting('reportTitle', title.trim() || 'Check List');
    await setSetting('backupReminderDays', Math.max(1, Number(remind) || 7));
  }, 'Configurações salvas');

  return (
    <Sheet open onClose={onClose} title="⚙️ Configurações" tall footer={<Button size="lg" className="w-full" onClick={save}>Salvar</Button>}>
      <SectionTitle>Geral</SectionTitle>
      <Field label="Símbolo da moeda (opcional)" hint="Ex.: R$, Bs, $. Vazio = só números, como no caderno.">
        <Input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="" />
      </Field>
      <Field label="Estoque baixo (padrão)" hint="Variações com essa quantidade ou menos entram em “precisa repor”. Cada variação pode ter o seu mínimo.">
        <Input inputMode="numeric" value={low} onChange={(e) => setLow(e.target.value.replace(/\D/g, ''))} />
      </Field>
      <Field label="Título do relatório do caderno"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field label="Lembrar de fazer backup a cada (dias)"><Input inputMode="numeric" value={remind} onChange={(e) => setRemind(e.target.value.replace(/\D/g, ''))} /></Field>

      <SectionTitle>Formas de pagamento</SectionTitle>
      <Card className="px-3">
        {PAYMENTS.map((p) => (
          <Toggle key={p} label={`${PAYMENT_EMOJI[p]} ${PAYMENT_LABEL[p]}`} checked={settings.paymentMethods.includes(p)}
            onChange={(on) => {
              const list = on ? PAYMENTS.filter((x) => x === p || settings.paymentMethods.includes(x)) : settings.paymentMethods.filter((x) => x !== p);
              if (!list.length) return;
              run(() => setSetting('paymentMethods', list));
              if (!on && settings.defaultPayment === p) run(() => setSetting('defaultPayment', list[0]));
            }} />
        ))}
      </Card>
      <div className="mt-2 text-sm font-semibold text-slate-700">Forma de pagamento padrão</div>
      <div className="grid grid-cols-4 gap-1.5 mt-1">
        {settings.paymentMethods.map((p) => (
          <button key={p} onClick={() => run(() => setSetting('defaultPayment', p))}
            className={`h-11 rounded-xl text-xs font-semibold border ${settings.defaultPayment === p ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-slate-200'}`}>
            {PAYMENT_EMOJI[p]} {PAYMENT_LABEL[p]}
          </button>
        ))}
      </div>

      <SectionTitle>Verificar dados</SectionTitle>
      <Diagnostics />

      <SectionTitle>Atalhos</SectionTitle>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="soft" onClick={() => setOverlay('cadastro')}>✏️ Grupos e produtos</Button>
        <Button variant="soft" onClick={() => setOverlay('backup')}>💾 Backup</Button>
      </div>
      <p className="text-xs text-slate-400 text-center mt-6">Dia a Dia · funciona offline · dados só neste aparelho</p>
    </Sheet>
  );
}

function Diagnostics() {
  const [res, setRes] = useState<{ findings: Finding[]; checked: Record<string, number> } | null>(null);
  const [busy, setBusy] = useState(false);
  const errors = res?.findings.filter((f) => f.level === 'erro').length ?? 0;
  return (
    <Card className="p-3">
      <p className="text-sm text-slate-600 mb-2">Confere se estoque, movimentos, vendas e caixa batem entre si. Só lê, não altera nada.</p>
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
    </Card>
  );
}
