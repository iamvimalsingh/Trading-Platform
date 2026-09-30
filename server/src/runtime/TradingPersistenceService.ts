/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * TRADING PERSISTENCE SERVICE
 * Central coordinator linking PostgreSQL repositories with TradingRuntime.
 * Enforces transactional consistency and atomic state transitions for:
 * Order + Execution + Position + Balance/Ledger.
 */

import { DatabaseClient, IDatabaseClient } from '../db/DatabaseClient';
import { runMigrations } from '../db/migrations';
import { PostgresAccountRepository } from '../repositories/PostgresAccountRepository';
import { PostgresOrderRepository } from '../repositories/PostgresOrderRepository';
import { PostgresPositionRepository } from '../repositories/PostgresPositionRepository';
import { PostgresExecutionRepository } from '../repositories/PostgresExecutionRepository';
import { PostgresLedgerRepository } from '../repositories/PostgresLedgerRepository';
import {
  Execution,
  LedgerEntry,
  Order,
  Position,
  TradingAccount,
} from '../types/trading';

export class TradingPersistenceService {
  public readonly accounts: PostgresAccountRepository;
  public readonly orders: PostgresOrderRepository;
  public readonly positions: PostgresPositionRepository;
  public readonly executions: PostgresExecutionRepository;
  public readonly ledger: PostgresLedgerRepository;
  private initialized: boolean = false;

  constructor(public readonly db: IDatabaseClient) {
    this.accounts = new PostgresAccountRepository(db);
    this.orders = new PostgresOrderRepository(db);
    this.positions = new PostgresPositionRepository(db);
    this.executions = new PostgresExecutionRepository(db);
    this.ledger = new PostgresLedgerRepository(db);
  }

  public async init(): Promise<void> {
    if (this.initialized) return;
    await runMigrations(this.db);
    this.initialized = true;
  }

  /**
   * Recovers full trading state for an authenticated account from PostgreSQL.
   */
  public async hydrateAccountSession(accountIdOrNumber: string): Promise<{
    account: TradingAccount;
    positions: Position[];
    orders: Order[];
    executions: Execution[];
    ledger: LedgerEntry[];
  } | undefined> {
    await this.init();

    const account = await this.accounts.getAccount(accountIdOrNumber);
    if (!account) return undefined;

    const [positions, orders, executions, ledger] = await Promise.all([
      this.positions.getOpenPositionsForAccount(account.id),
      this.orders.getActiveOrdersForAccount(account.id),
      this.executions.getExecutionsForAccount(account.id),
      this.ledger.getLedgerForAccount(account.id),
    ]);

    return {
      account,
      positions,
      orders,
      executions,
      ledger,
    };
  }

  /**
   * Persists order placement (Working or Pending).
   */
  public async recordOrderPlacement(order: Order, tenantId: string = 'tenant_default'): Promise<void> {
    await this.init();
    await this.orders.saveOrder(order, tenantId);
  }

  /**
   * Atomically records an order execution (Order fill + Position opening + Execution audit).
   */
  public async recordOrderExecution(
    order: Order,
    position?: Position,
    execution?: Execution,
    tenantId: string = 'tenant_default'
  ): Promise<void> {
    await this.init();

    await this.db.transaction(async (txClient) => {
      const txOrders = new PostgresOrderRepository(txClient);
      const txPositions = new PostgresPositionRepository(txClient);
      const txExecutions = new PostgresExecutionRepository(txClient);

      await txOrders.saveOrder(order, tenantId);

      if (position) {
        await txPositions.savePosition(position, tenantId);
      }

      if (execution) {
        await txExecutions.saveExecution(execution, tenantId);
      }
    });
  }

  /**
   * Atomically records a position close:
   * Position updated to CLOSED + Close Execution + Realized P/L Ledger Entry + Account Balance update.
   */
  public async recordPositionClose(
    position: Position,
    execution?: Execution,
    ledgerEntry?: LedgerEntry,
    account?: TradingAccount,
    tenantId: string = 'tenant_default'
  ): Promise<void> {
    await this.init();

    await this.db.transaction(async (txClient) => {
      const txPositions = new PostgresPositionRepository(txClient);
      const txExecutions = new PostgresExecutionRepository(txClient);
      const txLedger = new PostgresLedgerRepository(txClient);
      const txAccounts = new PostgresAccountRepository(txClient);

      await txPositions.savePosition(position, tenantId);

      if (execution) {
        await txExecutions.saveExecution(execution, tenantId);
      }

      if (ledgerEntry) {
        await txLedger.createEntry(ledgerEntry, tenantId);
      }

      if (account) {
        await txAccounts.updateAccount(account);
      }
    });
  }

  /**
   * Persists updated account balance & margin parameters.
   */
  public async recordAccountUpdate(account: TradingAccount): Promise<void> {
    await this.init();
    await this.accounts.updateAccount(account);
  }
}
