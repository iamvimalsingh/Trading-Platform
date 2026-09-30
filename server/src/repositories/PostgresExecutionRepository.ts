/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * POSTGRESQL EXECUTION REPOSITORY
 * Persistent audit log for order fills, opening, and closing executions.
 */

import { IDatabaseClient } from '../db/DatabaseClient';
import { Execution, ExecutionType, OrderSide } from '../types/trading';

export interface IExecutionRepository {
  saveExecution(execution: Execution, tenantId?: string): Promise<void>;
  getExecution(id: string): Promise<Execution | undefined>;
  getExecutionsForAccount(accountId: string): Promise<Execution[]>;
  getExecutionsForOrder(orderId: string): Promise<Execution[]>;
  getExecutionsForPosition(positionId: string): Promise<Execution[]>;
}

export class PostgresExecutionRepository implements IExecutionRepository {
  constructor(private db: IDatabaseClient) {}

  private mapRow(row: any): Execution {
    return {
      id: row.id,
      orderId: row.order_id || undefined,
      positionId: row.position_id || undefined,
      accountId: row.account_id,
      symbol: row.symbol,
      side: row.side as OrderSide,
      type: row.type as ExecutionType,
      volume: Number(row.volume),
      executionPrice: Number(row.execution_price),
      commission: Number(row.commission),
      fee: Number(row.fee),
      realizedPnL: row.realized_pnl !== null ? Number(row.realized_pnl) : undefined,
      clientOrderId: row.client_order_id || undefined,
      timestamp: Number(row.timestamp),
    };
  }

  public async saveExecution(execution: Execution, tenantId: string = 'tenant_default'): Promise<void> {
    await this.db.query(
      `INSERT INTO trading_executions (
        id, order_id, position_id, account_id, tenant_id, symbol,
        side, type, volume, execution_price, commission, fee,
        realized_pnl, client_order_id, timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      ON CONFLICT (id) DO NOTHING;`,
      [
        execution.id,
        execution.orderId || null,
        execution.positionId || null,
        execution.accountId,
        tenantId,
        execution.symbol,
        execution.side,
        execution.type,
        execution.volume,
        execution.executionPrice,
        execution.commission || 0,
        execution.fee || 0,
        execution.realizedPnL ?? null,
        execution.clientOrderId || null,
        execution.timestamp,
      ]
    );
  }

  public async getExecution(id: string): Promise<Execution | undefined> {
    const res = await this.db.query(`SELECT * FROM trading_executions WHERE id = $1 LIMIT 1;`, [id]);
    if (res.rows.length === 0) return undefined;
    return this.mapRow(res.rows[0]);
  }

  public async getExecutionsForAccount(accountId: string): Promise<Execution[]> {
    const res = await this.db.query(
      `SELECT * FROM trading_executions WHERE account_id = $1 ORDER BY timestamp DESC;`,
      [accountId]
    );
    return res.rows.map((r) => this.mapRow(r));
  }

  public async getExecutionsForOrder(orderId: string): Promise<Execution[]> {
    const res = await this.db.query(
      `SELECT * FROM trading_executions WHERE order_id = $1 ORDER BY timestamp ASC;`,
      [orderId]
    );
    return res.rows.map((r) => this.mapRow(r));
  }

  public async getExecutionsForPosition(positionId: string): Promise<Execution[]> {
    const res = await this.db.query(
      `SELECT * FROM trading_executions WHERE position_id = $1 ORDER BY timestamp ASC;`,
      [positionId]
    );
    return res.rows.map((r) => this.mapRow(r));
  }
}
