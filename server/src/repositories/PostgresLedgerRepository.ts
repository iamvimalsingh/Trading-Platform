/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * POSTGRESQL LEDGER REPOSITORY
 * Immutable append-only double-entry financial ledger for balance-affecting transactions.
 */

import { IDatabaseClient } from '../db/DatabaseClient';
import { LedgerEntry } from '../types/trading';

export interface ILedgerRepository {
  createEntry(entry: LedgerEntry, tenantId?: string): Promise<LedgerEntry>;
  getLedgerForAccount(accountId: string): Promise<LedgerEntry[]>;
}

export class PostgresLedgerRepository implements ILedgerRepository {
  constructor(private db: IDatabaseClient) {}

  public async createEntry(entry: LedgerEntry, tenantId: string = 'tenant_default'): Promise<LedgerEntry> {
    await this.db.query(
      `INSERT INTO trading_ledger (
        id, account_id, tenant_id, type, amount, balance_after,
        reference_id, description, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (id) DO NOTHING;`,
      [
        entry.id,
        entry.accountId,
        tenantId,
        entry.type,
        entry.amount,
        entry.balanceAfter,
        entry.referenceId || null,
        entry.description,
        entry.createdAt,
      ]
    );
    return entry;
  }

  public async getLedgerForAccount(accountId: string): Promise<LedgerEntry[]> {
    const res = await this.db.query(
      `SELECT * FROM trading_ledger WHERE account_id = $1 ORDER BY created_at DESC;`,
      [accountId]
    );
    return res.rows.map((r) => ({
      id: r.id,
      accountId: r.account_id,
      type: r.type,
      amount: Number(r.amount),
      balanceAfter: Number(r.balance_after),
      description: r.description,
      referenceId: r.reference_id || undefined,
      createdAt: Number(r.created_at),
    }));
  }
}
