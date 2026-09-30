/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * POSTGRESQL ORDER REPOSITORY
 * Persistent store for trading orders (Market, Limit, Stop, Working, Filled, Cancelled).
 */

import { IDatabaseClient } from '../db/DatabaseClient';
import { Order, OrderStatus } from '../types/trading';

export interface IOrderRepository {
  saveOrder(order: Order, tenantId?: string): Promise<void>;
  getOrder(id: string): Promise<Order | undefined>;
  getOrdersForAccount(accountId: string): Promise<Order[]>;
  getActiveOrdersForAccount(accountId: string): Promise<Order[]>;
  updateOrderStatus(orderId: string, status: OrderStatus, executionPrice?: number, rejectReason?: string): Promise<void>;
}

export class PostgresOrderRepository implements IOrderRepository {
  constructor(private db: IDatabaseClient) {}

  private mapRow(row: any): Order {
    return {
      id: row.id,
      clientOrderId: row.client_order_id,
      accountId: row.account_id,
      symbol: row.symbol,
      side: row.side,
      type: row.type,
      volume: Number(row.volume),
      requestedPrice: row.requested_price !== null ? Number(row.requested_price) : 0,
      executionPrice: row.execution_price !== null ? Number(row.execution_price) : 0,
      stopLoss: row.stop_loss !== null ? Number(row.stop_loss) : undefined,
      takeProfit: row.take_profit !== null ? Number(row.take_profit) : undefined,
      status: row.status as OrderStatus,
      rejectReason: row.reject_reason || undefined,
      createdAt: Number(row.created_at),
      executedAt: row.executed_at !== null ? Number(row.executed_at) : undefined,
    };
  }

  public async saveOrder(order: Order, tenantId: string = 'tenant_default'): Promise<void> {
    await this.db.query(
      `INSERT INTO trading_orders (
        id, client_order_id, account_id, tenant_id, symbol, side, type,
        volume, requested_price, execution_price, stop_loss, take_profit,
        status, reject_reason, created_at, executed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      ON CONFLICT (id) DO UPDATE SET
        execution_price = EXCLUDED.execution_price,
        status = EXCLUDED.status,
        reject_reason = EXCLUDED.reject_reason,
        executed_at = EXCLUDED.executed_at;`,
      [
        order.id,
        order.clientOrderId || `ord_${Date.now()}`,
        order.accountId,
        tenantId,
        order.symbol,
        order.side,
        order.type,
        order.volume,
        order.requestedPrice ?? null,
        order.executionPrice ?? null,
        order.stopLoss ?? null,
        order.takeProfit ?? null,
        order.status,
        order.rejectReason ?? null,
        order.createdAt,
        order.executedAt ?? null,
      ]
    );
  }

  public async getOrder(id: string): Promise<Order | undefined> {
    const res = await this.db.query(`SELECT * FROM trading_orders WHERE id = $1 LIMIT 1;`, [id]);
    if (res.rows.length === 0) return undefined;
    return this.mapRow(res.rows[0]);
  }

  public async getOrdersForAccount(accountId: string): Promise<Order[]> {
    const res = await this.db.query(
      `SELECT * FROM trading_orders WHERE account_id = $1 ORDER BY created_at DESC;`,
      [accountId]
    );
    return res.rows.map((r) => this.mapRow(r));
  }

  public async getActiveOrdersForAccount(accountId: string): Promise<Order[]> {
    const res = await this.db.query(
      `SELECT * FROM trading_orders WHERE account_id = $1 AND status IN ('PENDING', 'WORKING') ORDER BY created_at ASC;`,
      [accountId]
    );
    return res.rows.map((r) => this.mapRow(r));
  }

  public async updateOrderStatus(
    orderId: string,
    status: OrderStatus,
    executionPrice?: number,
    rejectReason?: string
  ): Promise<void> {
    const now = Date.now();
    await this.db.query(
      `UPDATE trading_orders SET status = $1, execution_price = COALESCE($2, execution_price), reject_reason = COALESCE($3, reject_reason), executed_at = $4 WHERE id = $5;`,
      [status, executionPrice ?? null, rejectReason ?? null, now, orderId]
    );
  }
}
