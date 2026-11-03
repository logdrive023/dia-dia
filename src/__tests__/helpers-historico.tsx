// abre o Histórico de movimentações já numa peça (como o atalho 📜 do Estoque/Vender)
import { fireEvent, screen, within } from '@testing-library/react';

export async function openHistoryForTest(variantId: string) {
  fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: /Vender/ }));
  fireEvent.click(await screen.findByRole('button', { name: /Todos os grupos/ }));
  const btns = await screen.findAllByRole('button', { name: /^Histórico de / });
  const target = btns.find((b) => b.closest('[data-variant]')?.getAttribute('data-variant') === variantId) ?? btns.find((b) => /Lilás/.test(b.getAttribute('aria-label') ?? ''));
  fireEvent.click(target!);
}
