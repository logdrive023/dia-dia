/**
 * Rolagem no celular: overflow em html/body (mesmo só o "x") transforma o body numa segunda área de rolagem
 * e o Chrome do Android (Redmi/Xiaomi) deixa a tela grudada. Este teste impede que isso volte.
 */
import { describe, expect, it } from 'vitest';
// o projeto não tem os tipos do Node (só o teste lê arquivo)
// @ts-expect-error módulo do Node sem tipos
import { readFileSync } from 'node:fs';

const raw: string = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
if (!raw.includes('#root')) throw new Error('index.css não foi lido');
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');

describe('rolagem da página no celular', () => {
  it('html e body não recebem overflow (a página rola sozinha)', () => {
    const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)];
    const bad = rules.filter(([, sel, body]) =>
      sel.split(',').some((s: string) => /^\s*(html|body)\s*$/.test(s)) && /(^|;|\s)overflow(-x|-y)?\s*:/.test(body));
    expect(bad.map(([r]) => r.trim())).toEqual([]);
  });
  it('janelas têm altura limitada à tela, com reserva para Android sem dvh', () => {
    expect(css).toMatch(/\.sheet-max\s*\{\s*max-height:\s*92vh;\s*max-height:\s*92dvh;/);
    expect(css).toMatch(/\.sheet-tall\s*\{\s*height:\s*92vh;\s*height:\s*92dvh;/);
  });
});
