/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * POSTGRESQL FUNDING REPOSITORY
 * Authoritative persistence and unique idempotency enforcement for CRM M2M funding transactions.
 */

import { IDatabaseClient } from '../db/DatabaseClient';
import { FundingTransactionRecord } from '../types/funding';
import { TradingAccount } from '../types/trading';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(str: string): boolean {
  if (!str || typeof str !== 'string') return false;
  return UUID_REGEX.test(str.trim());
}

export interface IFundingRepository {
  getAccount(idOrNumber: string): Promise<TradingAccount | undefined>;
  getAccountByUuid(id: string): Promise<TradingAccount | undefined>;
  getAccountByNumber(accountNumber: string): Promise<TradingAccount | undefined>;
  updateAccountBalance(
    accountId: string,
    balance: number,
    equity: number,
    freeMargin: number,
    marginLevel: number
  ): Promise<void>;
  getFundingTransaction(id: string): Promise<FundingTransactionRecord | undefined>;
  getFundingTransactionByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<FundingTransactionRecord | undefined>;
  recordFundingTransaction(record: FundingTransactionRecord): Promise<{ inserted: boolean; record: FundingTransactionRecord }>;
}

export class PostgresFundingRepository implements IFundingRepository {
  constructor(private db: IDatabaseClient) {}

  /**
   * Resolves a trading account using separate typed SQL paths.
   * - If idOrNumber matches standard UUID format: queries WHERE id = $1::uuid
   * - If non-UUID: queries WHERE account_number = $1
   * NEVER combines UUID and VARCHAR in a compound 'WHERE account_number = $1 OR id = $1' clause.
   */
  public async getAccount(idOrNumber: string): Promise<TradingAccount | undefined> {
    if (!idOrNumber || typeof idOrNumber !== 'string') return undefined;
    const trimmed = idOrNumber.trim();
    if (!trimmed) return undefined;

    if (isUuid(trimmed)) {
      return this.getAccountByUuid(trimmed);
    } else {
      const byNumber = await this.getAccountByNumber(trimmed);
      if (byNumber) return byNumber;
      try {
        const res = await this.db.query(
          `SELECT * FROM trading_accounts WHERE id = $1 LIMIT 1;`,
          [trimmed]
        );
        if (res.rows.length > 0) return this.mapAccountRow(res.rows[0]);
      } catch {
        // Safe ignore if database strictly enforces UUID on id column
      }
      return undefined;
    }
  }

  public async getAccountByUuid(id: string): Promise<TradingAccount | undefined> {
    const trimmed = id.trim();
    try {
      const res = await this.db.query(
        `SELECT * FROM trading_accounts WHERE id = $1::uuid LIMIT 1;`,
        [trimmed]
      );
      if (res.rows.length === 0) return undefined;
      return this.mapAccountRow(res.rows[0]);
    } catch (err: any) {
      if (err?.message?.includes('operator does not exist: character varying = uuid')) {
        const res = await this.db.query(
          `SELECT * FROM trading_accounts WHERE id = $1 LIMIT 1;`,
          [trimmed]
        );
        if (res.rows.length === 0) return undefined;
        return this.mapAccountRow(res.rows[0]);
      }
      throw err;
    }
  }

  public async getAccountByNumber(accountNumber: string): Promise<TradingAccount | undefined> {
    const trimmed = accountNumber.trim();
    const res = await this.db.query(
      `SELECT * FROM trading_accounts WHERE account_number = $1 LIMIT 1;`,
      [trimmed]
    );
    if (res.rows.length === 0) return undefined;
    return this.mapAccountRow(res.rows[0]);
  }

  /**
   * Updates account balance targeting trading_accounts.id using canonical account ID.
   */
  public async updateAccountBalance(
    accountId: string,
    balance: number,
    equity: number,
    freeMargin: number,
    marginLevel: number
  ): Promise<void> {
    const trimmedId = accountId.trim();
    const now = Date.now();

    await this.db.query(
      `UPDATE trading_accounts SET
        balance = $1,
        equity = $2,
        free_margin = $3,
        margin_level = $4,
        updated_at = $5
      WHERE id = $6;`,
      [balance, equity, freeMargin, marginLevel, now, trimmedId]
    );
  }

  public async getFundingTransaction(id: string): Promise<FundingTransactionRecord | undefined> {
    const res = await this.db.query(
      `SELECT * FROM trading_funding_transactions WHERE id = $1 LIMIT 1;`,
      [id]
    );
    if (res.rows.length === 0) return undefined;
    return this.mapRow(res.rows[0]);
  }

  public async getFundingTransactionByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string
  ): Promise<FundingTransactionRecord | undefined> {
    const res = await this.db.query(
      `SELECT * FROM trading_funding_transactions WHERE tenant_id = $1 AND idempotency_key = $2 LIMIT 1;`,
      [tenantId, idempotencyKey]
    );
    if (res.rows.length === 0) return undefined;
    return this.mapRow(res.rows[0]);
  }

  public async recordFundingTransaction(
    record: FundingTransactionRecord
  ): Promise<{ inserted: boolean; record: FundingTransactionRecord }> {
    const res = await this.db.query(
      `INSERT INTO trading_funding_transactions (
        id, idempotency_key, account_id, tenant_id, amount, currency,
        balance_before, balance_after, note, ledger_entry_id, status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (id) DO NOTHING
      RETURNING *;`,
      [
        record.id,
        record.idempotencyKey,
        record.accountId,
        record.tenantId,
        record.amount,
        record.currency,
        record.balanceBefore,
        record.balanceAfter,
        record.note || null,
        record.ledgerEntryId || null,
        record.status,
        record.createdAt,
      ]
    );

    if (res.rows && res.rows.length > 0) {
      return { inserted: true, record: this.mapRow(res.rows[0]) };
    }

    // Existing transaction returned
    const existing = await this.getFundingTransaction(record.id);
    return { inserted: false, record: existing || record };
  }

  private mapAccountRow(row: any): TradingAccount {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      clientId: row.client_id || undefined,
      accountNumber: row.account_number,
      platform: row.platform,
      currency: row.currency,
      accountType: row.account_type,
      sessionMode: row.session_mode,
      leverage: Number(row.leverage),
      balance: Number(row.balance),
      equity: Number(row.equity),
      usedMargin: Number(row.used_margin),
      freeMargin: Number(row.free_margin),
      marginLevel: Number(row.margin_level),
      marginCallLevel: Number(row.margin_call_level),
      stopOutLevel: Number(row.stop_out_level),
      status: row.status,
      tradingEnabled: row.trading_enabled !== undefined && row.trading_enabled !== null ? Boolean(row.trading_enabled) : true,
      maxOrderVolume: row.max_order_volume ? Number(row.max_order_volume) : undefined,
      maxPositionVolume: row.max_position_volume ? Number(row.max_position_volume) : undefined,
    };
  }

  private mapRow(r: any): FundingTransactionRecord {
    return {
      id: r.id,
      idempotencyKey: r.idempotency_key,
      accountId: r.account_id,
      tenantId: r.tenant_id,
      amount: Number(r.amount),
      currency: r.currency,
      balanceBefore: Number(r.balance_before),
      balanceAfter: Number(r.balance_after),
      note: r.note || undefined,
      ledgerEntryId: r.ledger_entry_id || undefined,
      status: r.status,
      createdAt: Number(r.created_at),
    };
  }
}
