/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * POSTGRESQL SYMBOL REPOSITORY
 * Persistent store for administrative and tenant-specific instrument overrides.
 */

import { IDatabaseClient } from '../db/DatabaseClient';
import { InstrumentDefinition } from '../market/InstrumentRegistry';
import { toDbTimestamp } from '../db/timestampUtils';

export class PostgresSymbolRepository {
  constructor(private db: IDatabaseClient) {}

  public async upsertSymbolOverride(
    tenantId: string,
    symbol: string,
    updates: Partial<InstrumentDefinition>,
    updatedBy: string = 'admin'
  ): Promise<void> {
    const id = `sym_cfg_${tenantId}_${symbol.toLowerCase()}`;

    await this.db.query(
      `INSERT INTO trading_symbol_configs (
        id, tenant_id, symbol, is_enabled, trading_status,
        min_volume, max_volume, volume_step, digits, tick_size,
        contract_size, updated_by, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (tenant_id, symbol) DO UPDATE SET
        is_enabled = COALESCE(EXCLUDED.is_enabled, trading_symbol_configs.is_enabled),
        trading_status = COALESCE(EXCLUDED.trading_status, trading_symbol_configs.trading_status),
        min_volume = COALESCE(EXCLUDED.min_volume, trading_symbol_configs.min_volume),
        max_volume = COALESCE(EXCLUDED.max_volume, trading_symbol_configs.max_volume),
        volume_step = COALESCE(EXCLUDED.volume_step, trading_symbol_configs.volume_step),
        digits = COALESCE(EXCLUDED.digits, trading_symbol_configs.digits),
        tick_size = COALESCE(EXCLUDED.tick_size, trading_symbol_configs.tick_size),
        contract_size = COALESCE(EXCLUDED.contract_size, trading_symbol_configs.contract_size),
        updated_by = EXCLUDED.updated_by,
        updated_at = EXCLUDED.updated_at;`,
      [
        id,
        tenantId,
        symbol.toUpperCase(),
        updates.enabled ?? true,
        updates.tradingStatus ?? 'TRADING',
        updates.minVolume ?? null,
        updates.maxVolume ?? null,
        updates.volumeStep ?? null,
        updates.digits ?? null,
        updates.tickSize ?? null,
        updates.contractSize ?? null,
        updatedBy,
        toDbTimestamp(),
      ]
    );
  }

  public async getSymbolOverrides(tenantId: string): Promise<Record<string, Partial<InstrumentDefinition>>> {
    try {
      const res = await this.db.query(
        `SELECT * FROM trading_symbol_configs WHERE tenant_id = $1;`,
        [tenantId]
      );

      const result: Record<string, Partial<InstrumentDefinition>> = {};
      for (const r of res.rows) {
        result[r.symbol] = {
          enabled: Boolean(r.is_enabled),
          tradingStatus: r.trading_status,
          minVolume: r.min_volume ? Number(r.min_volume) : undefined,
          maxVolume: r.max_volume ? Number(r.max_volume) : undefined,
          volumeStep: r.volume_step ? Number(r.volume_step) : undefined,
          digits: r.digits !== null ? Number(r.digits) : undefined,
          tickSize: r.tick_size ? Number(r.tick_size) : undefined,
          contractSize: r.contract_size ? Number(r.contract_size) : undefined,
        };
      }
      return result;
    } catch (err: any) {
      if (err?.message?.includes('does not exist')) {
        return {};
      }
      throw err;
    }
  }
}
