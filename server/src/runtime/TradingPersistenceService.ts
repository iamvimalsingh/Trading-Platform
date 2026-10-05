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
import { SchemaInspector } from '../db/timestampUtils';
import { PostgresAccountRepository } from '../repositories/PostgresAccountRepository';
import { PostgresOrderRepository } from '../repositories/PostgresOrderRepository';
import { PostgresPositionRepository } from '../repositories/PostgresPositionRepository';
import { PostgresExecutionRepository } from '../repositories/PostgresExecutionRepository';
import { PostgresLedgerRepository } from '../repositories/PostgresLedgerRepository';
import { PostgresFundingRepository } from '../repositories/PostgresFundingRepository';
import {
  Execution,
  LedgerEntry,
  Order,
  Position,
  TradingAccount,
} from '../types/trading';
import { FundingTransactionRecord } from '../types/funding';

export class TradingPersistenceService {
  public readonly accounts: PostgresAccountRepository;
  public readonly orders: PostgresOrderRepository;
  public readonly positions: PostgresPositionRepository;
  public readonly executions: PostgresExecutionRepository;
  public readonly ledger: PostgresLedgerRepository;
  public readonly funding: PostgresFundingRepository;
  private initialized: boolean = false;

  constructor(public readonly db: IDatabaseClient) {
    this.accounts = new PostgresAccountRepository(db);
    this.orders = new PostgresOrderRepository(db);
    this.positions = new PostgresPositionRepository(db);
    this.executions = new PostgresExecutionRepository(db);
    this.ledger = new PostgresLedgerRepository(db);
    this.funding = new PostgresFundingRepository(db);
  }

  public async init(): Promise<void> {
    if (this.initialized) return;
    await runMigrations(this.db);
    await SchemaInspector.loadSchema(this.db);
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
   * Atomically records an order execution (Order fill + Position opening + Execution audit + Account financial state).
   */
  public async recordOrderExecution(
    order: Order,
    position?: Position,
    execution?: Execution,
    account?: TradingAccount,
    tenantId: string = 'tenant_default'
  ): Promise<{ applied: boolean; duplicate: boolean }> {
    await this.init();

    return await this.db.transaction(async (txClient) => {
      const txOrders = new PostgresOrderRepository(txClient);
      const txPositions = new PostgresPositionRepository(txClient);
      const txExecutions = new PostgresExecutionRepository(txClient);
      const txAccounts = new PostgresAccountRepository(txClient);

      if (execution) {
        const existingExec = await txExecutions.getExecution(execution.id);
        if (existingExec) {
          return { applied: false, duplicate: true };
        }
        const saveRes = await txExecutions.saveExecution(execution, tenantId);
        if (!saveRes.inserted) {
          return { applied: false, duplicate: true };
        }
      }

      await txOrders.saveOrder(order, tenantId);

      if (position) {
        await txPositions.savePosition(position, tenantId);
      }

      if (account) {
        await txAccounts.updateAccount(account);
      }

      return { applied: true, duplicate: false };
    });
  }

  /**
   * Atomically records a position close (partial or full):
   * Position updated + Close Execution + Realized P/L Ledger Entry + Account Balance update.
   */
  public async recordPositionClose(
    position: Position,
    execution?: Execution,
    ledgerEntry?: LedgerEntry,
    account?: TradingAccount,
    tenantId: string = 'tenant_default'
  ): Promise<{ applied: boolean; duplicate: boolean }> {
    await this.init();

    return await this.db.transaction(async (txClient) => {
      const txPositions = new PostgresPositionRepository(txClient);
      const txExecutions = new PostgresExecutionRepository(txClient);
      const txLedger = new PostgresLedgerRepository(txClient);
      const txAccounts = new PostgresAccountRepository(txClient);

      if (execution) {
        const existingExec = await txExecutions.getExecution(execution.id);
        if (existingExec) {
          return { applied: false, duplicate: true };
        }
        const saveRes = await txExecutions.saveExecution(execution, tenantId);
        if (!saveRes.inserted) {
          return { applied: false, duplicate: true };
        }
      }

      await txPositions.savePosition(position, tenantId);

      if (ledgerEntry) {
        await txLedger.createEntry(ledgerEntry, tenantId);
      }

      if (account) {
        await txAccounts.updateAccount(account);
      }

      return { applied: true, duplicate: false };
    });
  }

  /**
   * Direct execution submission with strict persistent idempotency protection.
   */
  public async applyExecution(
    execution: Execution,
    order?: Order,
    position?: Position,
    ledgerEntry?: LedgerEntry,
    account?: TradingAccount,
    tenantId: string = 'tenant_default'
  ): Promise<{ applied: boolean; duplicate: boolean }> {
    await this.init();
    const existing = await this.executions.getExecution(execution.id);
    if (existing) {
      return { applied: false, duplicate: true };
    }

    return await this.db.transaction(async (txClient) => {
      const txExecutions = new PostgresExecutionRepository(txClient);
      const txOrders = new PostgresOrderRepository(txClient);
      const txPositions = new PostgresPositionRepository(txClient);
      const txLedger = new PostgresLedgerRepository(txClient);
      const txAccounts = new PostgresAccountRepository(txClient);

      const saveRes = await txExecutions.saveExecution(execution, tenantId);
      if (!saveRes.inserted) {
        return { applied: false, duplicate: true };
      }
      if (order) await txOrders.saveOrder(order, tenantId);
      if (position) await txPositions.savePosition(position, tenantId);
      if (ledgerEntry) await txLedger.createEntry(ledgerEntry, tenantId);
      if (account) await txAccounts.updateAccount(account);

      return { applied: true, duplicate: false };
    });
  }

  /**
   * Persists updated account balance & margin parameters.
   */
  public async recordAccountUpdate(account: TradingAccount): Promise<void> {
    await this.init();
    await this.accounts.updateAccount(account);
  }

  /**
   * Atomically applies a funding credit to an account, inserting the funding transaction
   * record and immutable ledger entry within a single transactional boundary.
   */
  public async applyFundingCredit(
    record: FundingTransactionRecord,
    ledgerEntry: LedgerEntry,
    updatedAccount: TradingAccount,
    tenantId: string = 'tenant_default'
  ): Promise<{ applied: boolean; duplicate: boolean; existingRecord?: FundingTransactionRecord }> {
    await this.init();

    // 1. Pre-check transactionId
    const existingById = await this.funding.getFundingTransaction(record.id);
    if (existingById) {
      return { applied: false, duplicate: true, existingRecord: existingById };
    }

    // 2. Pre-check idempotencyKey
    const existingByIdempotency = await this.funding.getFundingTransactionByIdempotencyKey(tenantId, record.idempotencyKey);
    if (existingByIdempotency) {
      return { applied: false, duplicate: true, existingRecord: existingByIdempotency };
    }

    // 3. Execute atomic transaction
    return await this.db.transaction(async (txClient) => {
      const txFunding = new PostgresFundingRepository(txClient);
      const txLedger = new PostgresLedgerRepository(txClient);
      const txAccounts = new PostgresAccountRepository(txClient);

      const existingInTx = await txFunding.getFundingTransactionByIdempotencyKey(tenantId, record.idempotencyKey);
      if (existingInTx) {
        return { applied: false, duplicate: true, existingRecord: existingInTx };
      }

      const saveFunding = await txFunding.recordFundingTransaction(record);
      if (!saveFunding.inserted) {
        return { applied: false, duplicate: true, existingRecord: saveFunding.record };
      }

      await txLedger.createEntry(ledgerEntry, tenantId);
      await txFunding.updateAccountBalance(
        updatedAccount.id,
        updatedAccount.balance,
        updatedAccount.equity,
        updatedAccount.freeMargin,
        updatedAccount.marginLevel
      );
      await txAccounts.updateAccount(updatedAccount);

      return { applied: true, duplicate: false, existingRecord: record };
    });
  }
}
