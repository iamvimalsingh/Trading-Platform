/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * POSTGRESQL FUNDING REPOSITORY
 * Authoritative persistence and unique idempotency enforcement for CRM M2M funding transactions.
 */

import { IDatabaseClient } from '../db/DatabaseClient';
import { FundingTransactionRecord } from '../types/funding';

export interface IFundingRepository {
  getFundingTransaction(id: string): Promise<FundingTransactionRecord | undefined>;
  getFundingTransactionByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<FundingTransactionRecord | undefined>;
  recordFundingTransaction(record: FundingTransactionRecord): Promise<{ inserted: boolean; record: FundingTransactionRecord }>;
}

export class PostgresFundingRepository implements IFundingRepository {
  constructor(private db: IDatabaseClient) {}

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
