import Dexie, { type Table } from 'dexie';
import type {
  AuditLog, CashMovement, CashRecord, Category, Credit, DailyRecord, DailyStockItem, Group,
  ImportRecord, Order, Reservation, Sale, Setting, StockMovement, Variant,
} from './types';

export class AppDB extends Dexie {
  groups!: Table<Group, string>;
  variants!: Table<Variant, string>;
  categories!: Table<Category, string>;
  dailyRecords!: Table<DailyRecord, string>;
  dailyStockItems!: Table<DailyStockItem, string>;
  stockMovements!: Table<StockMovement, string>;
  orders!: Table<Order, string>;
  sales!: Table<Sale, string>;
  reservations!: Table<Reservation, string>;
  cashRecords!: Table<CashRecord, string>;
  cashMovements!: Table<CashMovement, string>;
  settings!: Table<Setting, string>;
  auditLogs!: Table<AuditLog, string>;
  /** importações em quantidade (texto colado + o que mudou) */
  imports!: Table<ImportRecord, string>;
  /** vales das clientes (crédito na loja) */
  credits!: Table<Credit, string>;
  /** Cópia automática dos dados de antes de receber/restaurar (para "voltar como estava"). Fica fora do backup. */
  safety!: Table<{ id: string; createdAt: string; json: string; summary: string }, string>;

  constructor(name = 'dia-dia') {
    super(name);
    this.version(1).stores({
      groups: 'id, displayOrder, active',
      variants: 'id, groupId, displayOrder, active',
      categories: 'id, displayOrder',
      dailyRecords: 'id, &date, status',
      dailyStockItems: 'id, dailyRecordId, variantId, &[dailyRecordId+variantId]',
      stockMovements: 'id, dailyRecordId, variantId, type, createdAt, orderId',
      orders: 'id, dailyRecordId, createdAt',
      sales: 'id, orderId, dailyRecordId, variantId, createdAt',
      reservations: 'id, dailyRecordId, variantId, status',
      cashRecords: 'id, &dailyRecordId',
      cashMovements: 'id, dailyRecordId, type, relatedOrderId, createdAt',
      settings: 'id, &key',
      auditLogs: 'id, entityType, entityId, createdAt',
    });
    // v2: só acrescenta a tabela da cópia de segurança (dados existentes não mudam)
    this.version(2).stores({ safety: 'id' });
    // v3: só acrescenta a tabela das importações (nada existente muda; campos novos são opcionais)
    this.version(3).stores({ imports: 'id, createdAt' });
    // v4: só acrescenta a tabela dos vales (nada existente muda)
    this.version(4).stores({ credits: 'id, customerKey, orderId, dailyRecordId' });
  }

  get allTables() {
    return [
      this.groups, this.variants, this.categories, this.dailyRecords, this.dailyStockItems,
      this.stockMovements, this.orders, this.sales, this.reservations, this.cashRecords,
      this.cashMovements, this.settings, this.auditLogs, this.imports, this.credits,
    ];
  }
}

export let db = new AppDB();

// Outra aba/versão do app precisa atualizar o banco: fecha esta conexão em vez de travar as duas.
if (typeof window !== 'undefined') {
  db.on('versionchange', () => { db.close(); window.location.reload(); return false; });
}

/** Usado nos testes para trocar por um banco limpo. */
export function useDatabase(instance: AppDB) {
  db = instance;
}
