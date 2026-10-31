import { db } from '../db/db';
import { money, PAYMENT_LABEL } from '../lib/util';
import { CASH_LABEL } from './cash';
import { computeCash } from './summary';

const esc = (v: unknown) => {
  let s = v === null || v === undefined ? '' : String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (rows: unknown[][]) => '﻿' + rows.map((r) => r.map(esc).join(';')).join('\n');

async function maps() {
  const [groups, variants, days] = await Promise.all([db.groups.toArray(), db.variants.toArray(), db.dailyRecords.toArray()]);
  const g = new Map(groups.map((x) => [x.id, x]));
  const v = new Map(variants.map((x) => [x.id, x]));
  const d = new Map(days.map((x) => [x.id, x]));
  const vname = (id: string) => {
    const vv = v.get(id);
    return [vv ? g.get(vv.groupId)?.name ?? '' : '', vv?.name ?? ''];
  };
  return { g, v, d, vname };
}

export type CsvKind = 'estoque' | 'vendas' | 'movimentacoes' | 'caixa' | 'historico';

export async function buildCsv(kind: CsvKind, dailyRecordId?: string): Promise<string> {
  const { d, vname } = await maps();
  const date = (id: string) => d.get(id)?.date ?? '';
  if (kind === 'estoque') {
    const items = dailyRecordId
      ? await db.dailyStockItems.where('dailyRecordId').equals(dailyRecordId).toArray()
      : await db.dailyStockItems.toArray();
    return toCsv([['Data', 'Grupo', 'Variação', 'Inicial', 'Atual'],
      ...items.map((i) => [date(i.dailyRecordId), ...vname(i.variantId), i.initialQuantity, i.currentQuantity])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])))]);
  }
  if (kind === 'vendas') {
    const sales = await db.sales.orderBy('createdAt').toArray();
    const orders = new Map((await db.orders.toArray()).map((o) => [o.id, o]));
    return toCsv([['Data', 'Hora', 'Venda', 'Cliente', 'Grupo', 'Variação', 'Qtd', 'Preço unit.', 'Total', 'Pagamento', 'Status'],
      ...sales.map((s) => [date(s.dailyRecordId), s.createdAt.slice(11, 16), s.orderId.slice(0, 8), orders.get(s.orderId)?.customer ?? '',
        ...vname(s.variantId), s.quantity, s.unitPriceInCents === null ? '' : money(s.unitPriceInCents), money(s.totalInCents),
        PAYMENT_LABEL[s.paymentMethod], s.status === 'ok' ? 'OK' : 'Cancelada'])]);
  }
  if (kind === 'movimentacoes') {
    const ms = await db.stockMovements.orderBy('createdAt').toArray();
    return toCsv([['Data', 'Hora', 'Grupo', 'Variação', 'Tipo', 'Qtd', 'Saldo anterior', 'Saldo posterior', 'Obs'],
      ...ms.map((m) => [date(m.dailyRecordId), new Date(m.createdAt).toLocaleTimeString('pt-BR'), ...vname(m.variantId), m.type,
        m.quantity, m.previousBalance, m.newBalance, m.description ?? ''])]);
  }
  if (kind === 'caixa') {
    const ms = await db.cashMovements.orderBy('createdAt').toArray();
    return toCsv([['Data', 'Hora', 'Tipo', 'Pessoa/Descrição', 'Valor', 'Pagamento'],
      ...ms.map((m) => [date(m.dailyRecordId), new Date(m.createdAt).toLocaleTimeString('pt-BR'), CASH_LABEL[m.type],
        m.person || m.description || '', money(['venda', 'entrada'].includes(m.type) ? m.amountInCents : -m.amountInCents),
        PAYMENT_LABEL[m.paymentMethod]])]);
  }
  const days = await db.dailyRecords.orderBy('date').toArray();
  const rows: unknown[][] = [['Data', 'Status', 'Peças início', 'Peças fim', 'Peças vendidas', 'Vendas', 'Dinheiro', 'Pix', 'Crédito', 'Débito', 'Outro', 'Dei', 'Despesas', 'Retiradas', 'Ontem', 'Saldo']];
  for (const day of days) {
    const [items, sales, c] = await Promise.all([
      db.dailyStockItems.where('dailyRecordId').equals(day.id).toArray(),
      db.sales.where('dailyRecordId').equals(day.id).toArray(),
      computeCash(day.id),
    ]);
    rows.push([day.date, day.status === 'closed' ? 'Encerrado' : 'Aberto',
      items.reduce((s, i) => s + i.initialQuantity, 0), items.reduce((s, i) => s + i.currentQuantity, 0),
      sales.filter((s) => s.status === 'ok').reduce((s, x) => s + x.quantity, 0),
      money(c.salesTotal), money(c.salesByMethod.dinheiro), money(c.salesByMethod.pix), money(c.salesByMethod.cartao), money(c.salesByMethod.debito),
      money(c.salesByMethod.outro), money(c.darTotal), money(c.despesas), money(c.retiradas), money(c.opening), money(c.accumulated)]);
  }
  return toCsv(rows);
}
