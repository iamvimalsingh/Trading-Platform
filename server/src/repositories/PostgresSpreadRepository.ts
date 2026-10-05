/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * POSTGRESQL SPREAD REPOSITORY
 * Persistent store for pair-wise spread configurations with effective-dating and tenant isolation.
 */

import { IDatabaseClient } from '../db/DatabaseClient';
import { SpreadConfigRecord } from '../types/admin';
import { parseDbTimestamp, toDbTimestamp } from '../db/timestampUtils';

export class PostgresSpreadRepository {
  constructor(private db: IDatabaseClient) {}

  private mapRow(r: any): SpreadConfigRecord {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      symbol: r.symbol,
      spreadPoints: Number(r.spread_points),
      spreadUnit: r.spread_unit,
      isActive: Boolean(r.is_active),
      effectiveFrom: parseDbTimestamp(r.effective_from),
      createdBy: r.created_by,
      createdAt: parseDbTimestamp(r.created_at),
      updatedAt: parseDbTimestamp(r.updated_at),
    };
  }

  public async createSpreadConfig(config: SpreadConfigRecord): Promise<void> {
    const ts = toDbTimestamp();
    await this.db.query(
      `INSERT INTO trading_spread_configs (
        id, tenant_id, symbol, spread_points, spread_unit,
        is_active, effective_from, created_by, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);`,
      [
        config.id,
        config.tenantId,
        config.symbol.toUpperCase(),
        config.spreadPoints,
        config.spreadUnit || 'POINTS',
        config.isActive,
        toDbTimestamp(config.effectiveFrom),
        config.createdBy,
        config.createdAt ? toDbTimestamp(config.createdAt) : ts,
        ts,
      ]
    );
  }

  public async getSpreadConfig(id: string): Promise<SpreadConfigRecord | undefined> {
    const res = await this.db.query(
      `SELECT * FROM trading_spread_configs WHERE id = $1 LIMIT 1;`,
      [id]
    );
    if (res.rows.length === 0) return undefined;
    return this.mapRow(res.rows[0]);
  }

  public async getSpreadConfigsByTenant(tenantId: string, symbol?: string): Promise<SpreadConfigRecord[]> {
    try {
      let query = `SELECT * FROM trading_spread_configs WHERE tenant_id = $1`;
      const params: any[] = [tenantId];
      if (symbol) {
        query += ` AND symbol = $2`;
        params.push(symbol.toUpperCase());
      }
      query += ` ORDER BY effective_from DESC, created_at DESC;`;

      const res = await this.db.query(query, params);
      return res.rows.map((r: any) => this.mapRow(r));
    } catch (err: any) {
      if (err?.message?.includes('does not exist')) {
        return [];
      }
      throw err;
    }
  }

  public async updateSpreadConfig(
    id: string,
    tenantId: string,
    updates: Partial<SpreadConfigRecord>
  ): Promise<SpreadConfigRecord | undefined> {
    const existing = await this.getSpreadConfig(id);
    if (!existing || existing.tenantId !== tenantId) {
      return undefined;
    }

    const now = Date.now();
    const updated: SpreadConfigRecord = {
      ...existing,
      ...updates,
      id: existing.id,
      tenantId: existing.tenantId,
      symbol: existing.symbol,
      updatedAt: now,
    };

    await this.db.query(
      `UPDATE trading_spread_configs SET
        spread_points = $1,
        spread_unit = $2,
        is_active = $3,
        effective_from = $4,
        updated_at = $5
      WHERE id = $6 AND tenant_id = $7;`,
      [
        updated.spreadPoints,
        updated.spreadUnit,
        updated.isActive,
        toDbTimestamp(updated.effectiveFrom),
        toDbTimestamp(now),
        id,
        tenantId,
      ]
    );

    return updated;
  }
}
