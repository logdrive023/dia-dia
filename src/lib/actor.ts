/**
 * Quem está usando o app (Configurações › Seu nome). Vai em cada registro feito no app
 * (movimento de estoque, venda, reserva, cadastro, importação) para o histórico dizer quem fez.
 * Registros antigos não têm: aparecem como “registro antigo”.
 */
let current: string | null = null;
export function setActor(name: string | null | undefined) { current = name?.trim() || null; }
export function actor() { return current; }
