import Dexie, { type Table } from 'dexie';
import type {
  AuditLog, CashMovement, CashRecord, Category, DailyRecord, DailyStockItem, Group,
  Order, Reservation, Sale, Setting, StockMovement, Variant,
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
  }

  get allTables() {
    return [
      this.groups, this.variants, this.categories, this.dailyRecords, this.dailyStockItems,
      this.stockMovements, this.orders, this.sales, this.reservations, this.cashRecords,
      this.cashMovements, this.settings, this.auditLogs,
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
