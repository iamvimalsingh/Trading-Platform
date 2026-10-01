/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * POSTGRESQL ACCOUNT REPOSITORY
 * Persistent store for trading accounts and financial balances.
 */

import { IDatabaseClient } from '../db/DatabaseClient';
import { ExternalSessionTokenPayload, LedgerEntry, TradingAccount } from '../types/trading';

export interface IAccountRepository {
  getAccount(idOrNumber: string): Promise<TradingAccount | undefined> | TradingAccount | undefined;
  getAllAccounts(): Promise<TradingAccount[]> | TradingAccount[];
  updateAccount(account: TradingAccount): Promise<void> | void;
  createLedgerEntry(
    accountId: string,
    type: LedgerEntry['type'],
    amount: number,
    balanceAfter: number,
    description: string,
    referenceId?: string
  ): Promise<LedgerEntry> | LedgerEntry;
  getLedger(accountId: string): Promise<LedgerEntry[]> | LedgerEntry[];
  provisionExternalAccount(claims: ExternalSessionTokenPayload): Promise<TradingAccount> | TradingAccount;
  isDemoAccount(idOrNumber: string): boolean;
  resetAccount(idOrNumber: string): Promise<TradingAccount | undefined> | TradingAccount | undefined;
}

export class PostgresAccountRepository implements IAccountRepository {
  constructor(private db: IDatabaseClient) {}

  public isDemoAccount(idOrNumber: string): boolean {
    return (
      idOrNumber === 'acc_demo_1001' ||
      idOrNumber === 'DEMO-1001' ||
      idOrNumber === 'acc_demo_1002' ||
      idOrNumber === 'DEMO-1002'
    );
  }

  private mapRow(row: any): TradingAccount {
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

  public async getAccount(idOrNumber: string): Promise<TradingAccount | undefined> {
    const res = await this.db.query(
      `SELECT * FROM trading_accounts WHERE id = $1 OR account_number = $1 LIMIT 1;`,
      [idOrNumber]
    );
    if (res.rows.length === 0) return undefined;
    return this.mapRow(res.rows[0]);
  }

  public async getExternalAccount(tenantId: string, accountId: string, accountNumber: string): Promise<TradingAccount | undefined> {
    const res = await this.db.query(
      `SELECT * FROM trading_accounts WHERE tenant_id = $1 AND (id = $2 OR account_number = $3) LIMIT 1;`,
      [tenantId || 'tenant_default', accountId, accountNumber]
    );
    if (res.rows.length === 0) return undefined;
    return this.mapRow(res.rows[0]);
  }

  public async updateAccountMetadataOnly(account: TradingAccount): Promise<void> {
    const now = Date.now();
    await this.db.query(
      `UPDATE trading_accounts SET
        client_id = $1,
        platform = $2,
        session_mode = $3,
        updated_at = $4
      WHERE id = $5 AND tenant_id = $6;`,
      [account.clientId || null, account.platform || 'MT5', 'EXTERNAL', now, account.id, account.tenantId || 'tenant_default']
    );
  }

  public async getAccountsByTenant(tenantId: string): Promise<TradingAccount[]> {
    const res = await this.db.query(
      `SELECT * FROM trading_accounts WHERE tenant_id = $1 ORDER BY created_at ASC;`,
      [tenantId]
    );
    return res.rows.map((r) => this.mapRow(r));
  }

  public async getAllAccounts(): Promise<TradingAccount[]> {
    const res = await this.db.query(`SELECT * FROM trading_accounts ORDER BY created_at ASC;`);
    return res.rows.map((r) => this.mapRow(r));
  }

  public async updateAccount(account: TradingAccount): Promise<void> {
    const now = Date.now();
    await this.db.query(
      `INSERT INTO trading_accounts (
        id, tenant_id, client_id, account_number, platform, currency,
        account_type, session_mode, leverage, balance, equity,
        used_margin, free_margin, margin_level, margin_call_level,
        stop_out_level, status, trading_enabled, max_order_volume, max_position_volume,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
      ON CONFLICT (id) DO UPDATE SET
        tenant_id = EXCLUDED.tenant_id,
        client_id = COALESCE(EXCLUDED.client_id, trading_accounts.client_id),
        account_number = EXCLUDED.account_number,
        platform = EXCLUDED.platform,
        currency = EXCLUDED.currency,
        account_type = EXCLUDED.account_type,
        session_mode = EXCLUDED.session_mode,
        leverage = EXCLUDED.leverage,
        balance = EXCLUDED.balance,
        equity = EXCLUDED.equity,
        used_margin = EXCLUDED.used_margin,
        free_margin = EXCLUDED.free_margin,
        margin_level = EXCLUDED.margin_level,
        status = EXCLUDED.status,
        trading_enabled = EXCLUDED.trading_enabled,
        max_order_volume = EXCLUDED.max_order_volume,
        max_position_volume = EXCLUDED.max_position_volume,
        updated_at = EXCLUDED.updated_at;`,
      [
        account.id,
        account.tenantId || 'tenant_default',
        account.clientId || null,
        account.accountNumber,
        account.platform || 'MT5',
        account.currency || 'USD',
        account.accountType || 'LIVE',
        account.sessionMode || 'EXTERNAL',
        account.leverage || 100,
        account.balance,
        account.equity,
        account.usedMargin || 0,
        account.freeMargin || account.balance,
        account.marginLevel || 0,
        account.marginCallLevel || 100,
        account.stopOutLevel || 50,
        account.status || 'ACTIVE',
        account.tradingEnabled !== undefined ? account.tradingEnabled : true,
        account.maxOrderVolume ?? null,
        account.maxPositionVolume ?? null,
        now,
        now,
      ]
    );
  }

  public async provisionExternalAccount(claims: ExternalSessionTokenPayload): Promise<TradingAccount> {
    const tenantId = claims.tenantId || 'tenant_default';
    const existing = await this.getExternalAccount(tenantId, claims.accountId, claims.accountNumber);
    if (existing) {
      existing.clientId = claims.sub;
      if (claims.platform) existing.platform = claims.platform;
      existing.sessionMode = 'EXTERNAL';
      await this.updateAccountMetadataOnly(existing);
      return existing;
    }

    const initialBal = typeof claims.initialBalance === 'number' && claims.initialBalance > 0
      ? claims.initialBalance
      : 25000.00;

    const externalAccount: TradingAccount = {
      id: claims.accountId,
      tenantId,
      accountNumber: claims.accountNumber,
      currency: claims.currency || 'USD',
      accountType: claims.accountType || 'LIVE',
      leverage: claims.leverage || 100,
      balance: initialBal,
      equity: initialBal,
      usedMargin: 0.00,
      freeMargin: initialBal,
      marginLevel: 0,
      marginCallLevel: 100,
      stopOutLevel: 50,
      status: 'ACTIVE',
      clientId: claims.sub,
      platform: claims.platform || 'MT5',
      sessionMode: 'EXTERNAL',
    };

    const now = Date.now();
    await this.db.query(
      `INSERT INTO trading_accounts (
        id, tenant_id, client_id, account_number, platform, currency,
        account_type, session_mode, leverage, balance, equity,
        used_margin, free_margin, margin_level, margin_call_level,
        stop_out_level, status, trading_enabled, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
      ON CONFLICT (id) DO UPDATE SET
        client_id = COALESCE(EXCLUDED.client_id, trading_accounts.client_id),
        session_mode = 'EXTERNAL',
        updated_at = EXCLUDED.updated_at;`,
      [
        externalAccount.id,
        externalAccount.tenantId,
        externalAccount.clientId || null,
        externalAccount.accountNumber,
        externalAccount.platform || 'MT5',
        externalAccount.currency || 'USD',
        externalAccount.accountType || 'LIVE',
        externalAccount.sessionMode || 'EXTERNAL',
        externalAccount.leverage || 100,
        initialBal,
        initialBal,
        0,
        initialBal,
        0,
        100,
        50,
        'ACTIVE',
        true,
        now,
        now,
      ]
    );

    const ledgerRes = await this.db.query(`SELECT COUNT(*) as cnt FROM trading_ledger WHERE account_id = $1;`, [externalAccount.id]);
    if (Number(ledgerRes.rows[0]?.cnt || 0) === 0) {
      await this.createLedgerEntry(
        externalAccount.id,
        'DEPOSIT',
        initialBal,
        initialBal,
        `External Account Hydrated from CRM (${externalAccount.platform} #${externalAccount.accountNumber})`
      );
    }

    return await this.getExternalAccount(tenantId, claims.accountId, claims.accountNumber) || externalAccount;
  }

  public async createLedgerEntry(
    accountId: string,
    type: LedgerEntry['type'],
    amount: number,
    balanceAfter: number,
    description: string,
    referenceId?: string
  ): Promise<LedgerEntry> {
    const id = `led_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = Date.now();

    await this.db.query(
      `INSERT INTO trading_ledger (id, account_id, tenant_id, type, amount, balance_after, reference_id, description, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);`,
      [id, accountId, 'tenant_default', type, amount, balanceAfter, referenceId || null, description, now]
    );

    return {
      id,
      accountId,
      type,
      amount,
      balanceAfter,
      description,
      referenceId,
      createdAt: now,
    };
  }

  public async getLedger(accountId: string): Promise<LedgerEntry[]> {
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

  public async resetAccount(idOrNumber: string): Promise<TradingAccount | undefined> {
    const existing = await this.getAccount(idOrNumber);
    if (!existing) return undefined;

    const resetAcc: TradingAccount = {
      ...existing,
      balance: 10000.00,
      equity: 10000.00,
      usedMargin: 0.00,
      freeMargin: 10000.00,
      marginLevel: 0,
      status: 'ACTIVE',
    };

    await this.updateAccount(resetAcc);
    await this.createLedgerEntry(
      resetAcc.id,
      'DEPOSIT',
      10000.00,
      10000.00,
      `Reset Account Balance for ${resetAcc.accountNumber}`
    );

    return resetAcc;
  }
}
