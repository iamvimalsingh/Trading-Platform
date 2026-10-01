/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * POSTGRESQL AUDIT REPOSITORY
 * Immutable append-only audit trail for administrative risk, symbol, spread, and account operations.
 */

import { IDatabaseClient } from '../db/DatabaseClient';
import { AdminAuditEntry } from '../types/admin';

export class PostgresAuditRepository {
  constructor(private db: IDatabaseClient) {}

  public async saveAuditEntry(entry: AdminAuditEntry): Promise<void> {
    await this.db.query(
      `INSERT INTO trading_audit_log (
        id, tenant_id, admin_id, action, resource_type,
        resource_id, prev_state, new_state, reason, timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);`,
      [
        entry.id,
        entry.tenantId,
        entry.adminId,
        entry.action,
        entry.resourceType,
        entry.resourceId,
        entry.prevState ? JSON.stringify(entry.prevState) : null,
        entry.newState ? JSON.stringify(entry.newState) : null,
        entry.reason || null,
        entry.timestamp,
      ]
    );
  }

  public async getAuditEntries(
    tenantId: string,
    filter?: { resourceType?: string; resourceId?: string; adminId?: string; limit?: number }
  ): Promise<AdminAuditEntry[]> {
    let query = `SELECT * FROM trading_audit_log WHERE tenant_id = $1`;
    const params: any[] = [tenantId];
    let idx = 2;

    if (filter?.resourceType) {
      query += ` AND resource_type = $${idx++}`;
      params.push(filter.resourceType);
    }
    if (filter?.resourceId) {
      query += ` AND resource_id = $${idx++}`;
      params.push(filter.resourceId);
    }
    if (filter?.adminId) {
      query += ` AND admin_id = $${idx++}`;
      params.push(filter.adminId);
    }

    query += ` ORDER BY timestamp DESC LIMIT $${idx}`;
    params.push(filter?.limit || 100);

    const res = await this.db.query(query, params);
    return res.rows.map((r: any) => ({
      id: r.id,
      tenantId: r.tenant_id,
      adminId: r.admin_id,
      action: r.action,
      resourceType: r.resource_type,
      resourceId: r.resource_id,
      prevState: r.prev_state ? (typeof r.prev_state === 'string' ? JSON.parse(r.prev_state) : r.prev_state) : undefined,
      newState: r.new_state ? (typeof r.new_state === 'string' ? JSON.parse(r.new_state) : r.new_state) : undefined,
      reason: r.reason || undefined,
      timestamp: Number(r.timestamp),
    }));
  }
}
