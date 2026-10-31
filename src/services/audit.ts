import { db } from '../db/db';
import { nowIso, uid } from '../lib/util';

export function audit(entityType: string, entityId: string, action: string, oldValue?: unknown, newValue?: unknown) {
  return db.auditLogs.add({ id: uid(), entityType, entityId, action, oldValue, newValue, createdAt: nowIso() });
}
