export type ID = string;

/** cartao = cartão de crédito (nome antigo mantido para os dados já salvos) */
export type PaymentMethod = 'dinheiro' | 'pix' | 'cartao' | 'debito' | 'outro';

export interface Group {
  id: ID;
  name: string;
  description?: string;
  icon?: string;
  color: string;
  displayOrder: number;
  active: boolean;
  archivedAt?: string | null;
  categoryIds?: ID[];
  createdAt: string;
  updatedAt: string;
}

export interface Variant {
  id: ID;
  groupId: ID;
  name: string;
  description?: string;
  color?: string;
  displayOrder: number;
  active: boolean;
  archivedAt?: string | null;
  /** Excluída: tinha vendas, então não some do histórico, mas não aparece em mais nada. */
  deletedAt?: string | null;
  /** Estoque mínimo: com valor, só aparece para repor quando chega nele (ou abaixo). null = sem mínimo. */
  minimumStock: number | null;
  /** true = esta cor não precisa de repor (nunca aparece em “repor”). */
  restockOff?: boolean;
  /**
   * Estoque ideal: quantas peças você quer ter. "Repor" = ideal - quantidade atual.
   * null = usa a quantidade do cadastro (startQuantity). Ex.: cadastrou 15, vendeu 1 → repor 1.
   */
  idealStock?: number | null;
  /** false = peça guardada: fica no estoque, mas não aparece em Vender e não pode ser vendida/reservada. */
  forSale?: boolean;
  /** Quantidade usada quando a variação entra num dia sem histórico anterior. */
  startQuantity: number;
  optionalPriceInCents?: number | null;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  /** de onde veio o cadastro (antigos: sem) */
  origin?: 'cadastro' | 'vender' | 'importacao' | null;
  /** quem cadastrou */
  createdBy?: string | null;
  /** tamanho (opcional): P, M, G… Cada tamanho é uma linha própria no estoque (Azul · P, Azul · M) */
  size?: string | null;
  /** tipo de produto (opcional): Vestido, Blusa… (lista em Configurações) */
  productType?: string | null;
}

export interface Category {
  id: ID;
  name: string;
  color: string;
  displayOrder: number;
}

export type DayStatus = 'open' | 'closed';

export interface DailyRecord {
  id: ID;
  date: string; // YYYY-MM-DD
  sourceDate?: string | null;
  status: DayStatus;
  notes?: string;
  closedAt?: string | null;
  /** encerrado sozinho quando virou a data */
  autoClosedAt?: string | null;
  /** reaberto de propósito: não fecha sozinho de novo */
  reopenedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DailyStockItem {
  id: ID;
  dailyRecordId: ID;
  variantId: ID;
  initialQuantity: number;
  currentQuantity: number;
}

export type MovementType =
  | 'venda'
  | 'entrada'
  | 'saida'
  | 'perda'
  | 'ajuste'
  | 'correcao'
  | 'reserva'
  | 'cancelamento';

export interface StockMovement {
  id: ID;
  dailyRecordId: ID;
  variantId: ID;
  type: MovementType;
  /** Delta aplicado ao estoque físico (negativo = saiu). Reservas usam 0. */
  quantity: number;
  previousBalance: number;
  newBalance: number;
  createdAt: string;
  description?: string;
  reversedMovementId?: ID | null;
  orderId?: ID | null;
  /** entrada: mercadoria nova ou reposição (antigos: sem) */
  entryKind?: EntryKind | null;
  /** quem fez (Configurações › Seu nome); antigos: sem */
  by?: string | null;
  /** entrada que veio de uma importação em quantidade */
  importId?: ID | null;
}

/** Entrada de estoque: peça que a loja ainda não tinha (nova) ou mais peças de algo que já vende (reposição). */
export type EntryKind = 'nova' | 'reposicao';

/** Uma venda para uma pessoa (pode ter várias peças/linhas). */
export interface Order {
  id: ID;
  dailyRecordId: ID;
  customer?: string;
  paymentMethod: PaymentMethod;
  totalInCents: number;
  itemCount: number;
  status: 'ok' | 'cancelled';
  cashMovementId?: ID | null;
  /** Pagamento dividido (ex.: 100 Pix + 55 Dinheiro). Vazio = tudo em paymentMethod. */
  payments?: Payment[];
  /** Cada peça tem a sua forma de pagamento (Sale.paymentMethod); `payments` é a soma por forma. */
  payByLine?: boolean;
  /** Quando a usuária conferiu que o Pix caiu na conta. */
  pixConfirmedAt?: string | null;
  /** Valor do Pix que foi conferido (se o valor mudar depois, precisa conferir de novo). */
  pixConfirmedCents?: number | null;
  createdAt: string;
  notes?: string;
  /** quem fez (Configurações › Seu nome); antigos: sem */
  by?: string | null;
}

export interface Payment {
  method: PaymentMethod;
  amountInCents: number;
}

export interface Sale {
  id: ID;
  orderId: ID;
  dailyRecordId: ID;
  variantId: ID;
  quantity: number;
  unitPriceInCents: number | null;
  totalInCents: number;
  paymentMethod: PaymentMethod;
  createdAt: string;
  notes?: string;
  cashMovementId?: ID | null;
  status: 'ok' | 'cancelled';
}

export type ReservationStatus = 'active' | 'cancelled' | 'converted';

export interface Reservation {
  id: ID;
  dailyRecordId: ID;
  /** Data de criação; reservas ativas reduzem a disponibilidade deste dia em diante. */
  date: string;
  variantId: ID;
  quantity: number;
  customer?: string;
  notes?: string;
  status: ReservationStatus;
  /** Venda gerada quando a reserva foi convertida. */
  orderId?: ID | null;
  createdAt: string;
  updatedAt: string;
  /** quem fez (Configurações › Seu nome); antigos: sem */
  by?: string | null;
}

export interface CashRecord {
  id: ID;
  dailyRecordId: ID;
  /** "Ontem" digitado à mão; só vale quando openingManual = true (senão vem do dia anterior). */
  openingBalanceInCents: number;
  openingManual?: boolean;
  /** Quanto do "Ontem" manual é dinheiro vivo (vazio = tudo). */
  openingCashInCents?: number | null;
  countedBalanceInCents?: number | null;
  status: DayStatus;
  /** A diária automática já foi conferida neste dia (se for tirada no ✕, não volta). */
  dailyPayDone?: boolean;
}

/**
 * venda: recebimento de venda | entrada: outro dinheiro que entrou
 * dar: dinheiro dado a alguém (ex.: "Chico 50 — eu dei") | despesa: gasto do dia
 * retirada: tirado do acumulado (ex.: "- 300" depois do "Ontem + hoje")
 * pagamento: diária de quem vende (150 por dia; um lançamento por dia, ex.: "diária de 30/10")
 */
export type CashType = 'venda' | 'entrada' | 'dar' | 'despesa' | 'retirada' | 'pagamento' | 'estorno';

export interface CashMovement {
  id: ID;
  dailyRecordId: ID;
  type: CashType;
  description?: string;
  person?: string;
  amountInCents: number; // sempre positivo; o tipo define o sinal
  paymentMethod: PaymentMethod;
  relatedOrderId?: ID | null;
  /** Venda copiada do caderno (sem peça escolhida): quantas peças foram. Pagamento: quantas diárias. */
  quantity?: number;
  /** Lançado sozinho pelo app (diária ao iniciar o dia): não conta como “dia com lançamento” para desfazer o início. */
  auto?: boolean;
  createdAt: string;
}

export interface Setting {
  id: ID;
  key: string;
  value: unknown;
}

export interface AuditLog {
  id: ID;
  entityType: string;
  entityId: ID;
  action: string;
  oldValue?: unknown;
  newValue?: unknown;
  createdAt: string;
  /** quem fez (antigos: sem) */
  by?: string | null;
}

/** Uma linha de uma importação em quantidade (o que aconteceu com cada produto). */
export interface ImportLine {
  variantId: ID;
  groupName: string;
  name: string;
  size?: string | null;
  /** produto criado por esta importação */
  created: boolean;
  createdGroup: boolean;
  before: number;
  delta: number;
  after: number;
  movementId?: ID | null;
  forSale?: boolean;
}

/** Importação em quantidade: guarda o texto colado e o que mudou (para consultar e desfazer). */
export interface ImportRecord {
  id: ID;
  createdAt: string;
  dailyRecordId: ID;
  date: string;
  by?: string | null;
  /** texto original, exatamente como foi colado */
  text: string;
  op: 'somar' | 'definir';
  lines: ImportLine[];
  status: 'aplicada' | 'desfeita' | 'parcial';
  undoneAt?: string | null;
  /** linhas que não deu para desfazer, com o motivo */
  undoSkipped?: { variantId: ID; reason: string }[];
}
