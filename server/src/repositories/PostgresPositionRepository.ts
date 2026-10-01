/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * POSTGRESQL POSITION REPOSITORY
 * Persistent store for open and closed positions (trade history).
 */

import { IDatabaseClient } from '../db/DatabaseClient';
import { Position, PositionStatus } from '../types/trading';

export interface IPositionRepository {
  savePosition(position: Position, tenantId?: string): Promise<void>;
  getPosition(id: string): Promise<Position | undefined>;
  getPositionsForAccount(accountId: string): Promise<Position[]>;
  getOpenPositionsForAccount(accountId: string): Promise<Position[]>;
  getClosedPositionsForAccount(accountId: string): Promise<Position[]>;
  updatePosition(position: Position): Promise<void>;
}

export class PostgresPositionRepository implements IPositionRepository {
  constructor(private db: IDatabaseClient) {}

  private mapRow(row: any): Position {
    return {
      id: row.id,
      accountId: row.account_id,
      symbol: row.symbol,
      side: row.side,
      volume: Number(row.volume),
      openPrice: Number(row.open_price),
      currentPrice: Number(row.current_price),
      unrealizedPnL: Number(row.unrealized_pnl),
      realizedPnL: Number(row.realized_pnl),
      stopLoss: row.stop_loss !== null ? Number(row.stop_loss) : undefined,
      takeProfit: row.take_profit !== null ? Number(row.take_profit) : undefined,
      marginLocked: Number(row.margin_locked),
      openedAt: Number(row.opened_at),
      closedAt: row.closed_at !== null ? Number(row.closed_at) : undefined,
      status: row.status as PositionStatus,
    };
  }

  public async savePosition(position: Position, tenantId: string = 'tenant_default'): Promise<void> {
    await this.db.query(
      `INSERT INTO trading_positions (
        id, account_id, tenant_id, symbol, side, volume,
        open_price, current_price, unrealized_pnl, realized_pnl,
        stop_loss, take_profit, margin_locked, opened_at, closed_at, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      ON CONFLICT (id) DO UPDATE SET
        volume = EXCLUDED.volume,
        current_price = EXCLUDED.current_price,
        unrealized_pnl = EXCLUDED.unrealized_pnl,
        realized_pnl = EXCLUDED.realized_pnl,
        stop_loss = EXCLUDED.stop_loss,
        take_profit = EXCLUDED.take_profit,
        margin_locked = EXCLUDED.margin_locked,
        closed_at = EXCLUDED.closed_at,
        status = EXCLUDED.status;`,
      [
        position.id,
        position.accountId,
        tenantId,
        position.symbol,
        position.side,
        position.volume,
        position.openPrice,
        position.currentPrice,
        position.unrealizedPnL || 0,
        position.realizedPnL || 0,
        position.stopLoss ?? null,
        position.takeProfit ?? null,
        position.marginLocked || 0,
        position.openedAt,
        position.closedAt ?? null,
        position.status,
      ]
    );
  }

  public async getPosition(id: string): Promise<Position | undefined> {
    const res = await this.db.query(`SELECT * FROM trading_positions WHERE id = $1 LIMIT 1;`, [id]);
    if (res.rows.length === 0) return undefined;
    return this.mapRow(res.rows[0]);
  }

  public async getPositionsForAccount(accountId: string): Promise<Position[]> {
    const res = await this.db.query(
      `SELECT * FROM trading_positions WHERE account_id = $1 ORDER BY opened_at DESC;`,
      [accountId]
    );
    return res.rows.map((r) => this.mapRow(r));
  }

  public async getOpenPositionsForAccount(accountId: string): Promise<Position[]> {
    const res = await this.db.query(
      `SELECT * FROM trading_positions WHERE account_id = $1 AND status = 'OPEN' ORDER BY opened_at ASC;`,
      [accountId]
    );
    return res.rows.map((r) => this.mapRow(r));
  }

  public async getClosedPositionsForAccount(accountId: string): Promise<Position[]> {
    const res = await this.db.query(
      `SELECT * FROM trading_positions WHERE account_id = $1 AND status = 'CLOSED' ORDER BY closed_at DESC;`,
      [accountId]
    );
    return res.rows.map((r) => this.mapRow(r));
  }

  public async updatePosition(position: Position): Promise<void> {
    await this.savePosition(position);
  }
}
