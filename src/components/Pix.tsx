import { useState } from 'react';
import { money, toCents } from '../lib/util';
import { detectPlatform, PIX, PIX_QR_PNG } from '../lib/pix';
import { copyText } from '../services/report';
import { Field, Input, Sheet, useUi } from './ui';

/** Onde conferir se o Pix caiu: no Android (Samsung) é o app Neon; o iPhone não tem o Neon. */
export function pixCheckHint() {
  const p = detectPlatform();
  if (p === 'android') return '📱 Confira no app Neon deste celular se o Pix caiu.';
  if (p === 'ios') return '📱 Este iPhone não tem o Neon: confira o Pix no Samsung (app Neon).';
  return '🏦 Confira no app Neon se o Pix caiu.';
}

/** QR code do Pix (imagem gerada do base64) + valor + copiar o código. */
export function PixQr({ amount, compact = false }: { amount?: number | null; compact?: boolean }) {
  const { toast } = useUi();
  return (
    <div className="rounded-2xl bg-white border-2 border-amber-300 p-3 text-center">
      <div className="text-[13px] font-bold text-amber-700">⚡ Pague no Pix</div>
      {amount ? <div className="text-[28px] font-extrabold tabular-nums text-slate-900 leading-tight">{money(amount)}</div> : null}
      <img src={PIX_QR_PNG} alt="QR code do Pix" width={compact ? 200 : 260} height={compact ? 200 : 260}
        className="mx-auto my-1 rounded-lg bg-white" style={{ imageRendering: 'pixelated' }} />
      <div className="text-[14px] font-bold text-slate-800">{PIX.name}</div>
      <div className="text-[12px] text-slate-500">{PIX.bank}</div>
      <button type="button" onClick={async () => toast((await copyText(PIX.payload)) ? '📋 Código Pix copiado' : 'Não foi possível copiar', 'ok')}
        className="mt-2 min-h-11 px-4 rounded-xl bg-amber-50 border border-amber-200 text-[14px] font-bold text-amber-800 active:bg-amber-100">
        📋 Copiar código Pix (copia e cola)
      </button>
      <div className="mt-2 text-[12px] text-slate-500">{pixCheckHint()}</div>
    </div>
  );
}

/** Mostrar o Pix na tela, sem precisar de venda (valor opcional, só para mostrar à cliente). */
export function PixSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [value, setValue] = useState('');
  if (!open) return null;
  const cents = value.trim() ? toCents(value) : null;
  return (
    <Sheet open onClose={() => { setValue(''); onClose(); }} title="⚡ Meu Pix" tall>
      <PixQr amount={cents} />
      <div className="mt-3">
        <Field label="Valor (opcional, só para mostrar)">
          <Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Ex.: 70" />
        </Field>
      </div>
    </Sheet>
  );
}
