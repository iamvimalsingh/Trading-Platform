/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * POSTGRESQL ACCOUNT REPOSITORY
 * Persistent store for trading accounts and financial balances.
 */

import { IDatabaseClient } from '../db/DatabaseClient';
import { ExternalSessionTokenPayload, LedgerEntry, TradingAccount } from '../types/trading';
import { parseDbTimestamp, toDbTimestamp, SchemaInspector } from '../db/timestampUtils';
import { normalizeAccountStatus } from '../utils/accountStatus';

export interface IAccountRepository {
  getAccount(idOrNumber: string): Promise<TradingAccount | undefined> | TradingAccount | undefined;
  getAllAccounts(): Promise<TradingAccount[]> | TradingAccount[];
  updateAccount(account: TradingAccount): Promise<void> | void;
  deleteAccount?(tenantId: string, accountId: string): Promise<void> | void;
  canDeleteAccount?(tenantId: string, accountId: string): Promise<{ eligible: boolean; reason?: string }> | { eligible: boolean; reason?: string };
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
      status: normalizeAccountStatus(row.status, 'DISABLED'),
      tradingEnabled: row.trading_enabled !== undefined && row.trading_enabled !== null ? Boolean(row.trading_enabled) : true,
      maxOrderVolume: row.max_order_volume ? Number(row.max_order_volume) : undefined,
      maxPositionVolume: row.max_position_volume ? Number(row.max_position_volume) : undefined,
      tradingPassword: row.trading_password || undefined,
      passwordHash: row.password_hash || undefined,
      createdAt: row.created_at ? parseDbTimestamp(row.created_at) : undefined,
      updatedAt: row.updated_at ? parseDbTimestamp(row.updated_at) : undefined,
    };
  }

  public async setTradingPassword(idOrNumber: string, password: string): Promise<void> {
    if (!idOrNumber || !password) return;
    await this.db.query(
      `UPDATE trading_accounts SET trading_password = $1, updated_at = NOW() WHERE id = $2 OR account_number = $2;`,
      [password, idOrNumber]
    );
  }

  public async setPasswordHash(idOrNumber: string, hash: string): Promise<void> {
    if (!idOrNumber || !hash) return;
    await this.db.query(
      `UPDATE trading_accounts SET password_hash = $1, trading_password = NULL, updated_at = NOW() WHERE id = $2 OR account_number = $2;`,
      [hash, idOrNumber]
    );
  }

  public async getAccount(idOrNumber: string): Promise<TradingAccount | undefined> {
    if (!idOrNumber || typeof idOrNumber !== 'string') return undefined;
    const trimmed = idOrNumber.trim();
    if (!trimmed) return undefined;

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed);

    if (isUuid) {
      try {
        const res = await this.db.query(
          `SELECT * FROM trading_accounts WHERE id = $1::uuid LIMIT 1;`,
          [trimmed]
        );
        if (res.rows.length === 0) return undefined;
        return this.mapRow(res.rows[0]);
      } catch (err: any) {
        if (err?.message?.includes('operator does not exist: character varying = uuid')) {
          const res = await this.db.query(
            `SELECT * FROM trading_accounts WHERE id = $1 LIMIT 1;`,
            [trimmed]
          );
          if (res.rows.length === 0) return undefined;
          return this.mapRow(res.rows[0]);
        }
        throw err;
      }
    } else {
      let res = await this.db.query(
        `SELECT * FROM trading_accounts WHERE account_number = $1 LIMIT 1;`,
        [trimmed]
      );
      if (res.rows.length === 0) {
        try {
          res = await this.db.query(
            `SELECT * FROM trading_accounts WHERE id = $1 LIMIT 1;`,
            [trimmed]
          );
        } catch {
          return undefined;
        }
      }
      if (res.rows.length === 0) return undefined;
      return this.mapRow(res.rows[0]);
    }
  }

  public async getExternalAccount(tenantId: string, accountId: string, accountNumber: string): Promise<TradingAccount | undefined> {
    const effectiveTenant = tenantId || 'tenant_default';
    const trimmedId = accountId ? accountId.trim() : '';
    const trimmedNum = accountNumber ? accountNumber.trim() : '';

    if (trimmedId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmedId)) {
      const res = await this.db.query(
        `SELECT * FROM trading_accounts WHERE tenant_id = $1 AND id = $2::uuid LIMIT 1;`,
        [effectiveTenant, trimmedId]
      );
      if (res.rows.length > 0) return this.mapRow(res.rows[0]);
    }

    if (trimmedNum) {
      const res = await this.db.query(
        `SELECT * FROM trading_accounts WHERE tenant_id = $1 AND account_number = $2 LIMIT 1;`,
        [effectiveTenant, trimmedNum]
      );
      if (res.rows.length > 0) return this.mapRow(res.rows[0]);
    }

    return undefined;
  }

  public async updateAccountMetadataOnly(account: TradingAccount): Promise<void> {
    await this.db.query(
      `UPDATE trading_accounts SET
        client_id = $1,
        platform = $2,
        session_mode = $3,
        updated_at = $4
      WHERE id = $5 AND tenant_id = $6;`,
      [account.clientId || null, account.platform || 'MT5', 'EXTERNAL', toDbTimestamp(undefined, 'trading_accounts', 'updated_at'), account.id, account.tenantId || 'tenant_default']
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
    const tsUpdatedAt = toDbTimestamp(undefined, 'trading_accounts', 'updated_at');
    const normalizedStatus = normalizeAccountStatus(account.status, 'ACTIVE');
    const updateRes = await this.db.query(
      `UPDATE trading_accounts SET
        tenant_id = $1,
        client_id = COALESCE($2, client_id),
        account_number = $3,
        platform = $4,
        currency = $5,
        account_type = $6,
        session_mode = $7,
        leverage = $8,
        balance = $9,
        equity = $10,
        used_margin = $11,
        free_margin = $12,
        margin_level = $13,
        margin_call_level = $14,
        stop_out_level = $15,
        status = $16,
        trading_enabled = $17,
        max_order_volume = $18,
        max_position_volume = $19,
        password_hash = COALESCE($20, password_hash),
        trading_password = COALESCE($21, trading_password),
        updated_at = $22
      WHERE id = $23;`,
      [
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
        normalizedStatus,
        account.tradingEnabled !== undefined ? account.tradingEnabled : true,
        account.maxOrderVolume ?? null,
        account.maxPositionVolume ?? null,
        account.passwordHash ?? null,
        account.tradingPassword ?? null,
        tsUpdatedAt,
        account.id,
      ]
    );

    if (updateRes.rowCount === 0) {
      const tsCreatedAt = toDbTimestamp(account.createdAt, 'trading_accounts', 'created_at');
      const hasUserIdCol = !!SchemaInspector.getColumnType('trading_accounts', 'user_id');
      const userIdVal = account.clientId || (account as any).userId || (account as any).user_id || null;

      if (hasUserIdCol && userIdVal) {
        await this.db.query(
          `INSERT INTO trading_accounts (
            id, user_id, tenant_id, client_id, account_number, platform, currency,
            account_type, session_mode, leverage, balance, equity,
            used_margin, free_margin, margin_level, margin_call_level,
            stop_out_level, status, trading_enabled, max_order_volume, max_position_volume,
            password_hash, trading_password, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
          ON CONFLICT (id) DO UPDATE SET
            balance = EXCLUDED.balance,
            equity = EXCLUDED.equity,
            free_margin = EXCLUDED.free_margin,
            password_hash = COALESCE(EXCLUDED.password_hash, trading_accounts.password_hash),
            updated_at = EXCLUDED.updated_at;`,
          [
            account.id,
            userIdVal,
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
            normalizedStatus,
            account.tradingEnabled !== undefined ? account.tradingEnabled : true,
            account.maxOrderVolume ?? null,
            account.maxPositionVolume ?? null,
            account.passwordHash ?? null,
            account.tradingPassword ?? null,
            tsCreatedAt,
            tsUpdatedAt,
          ]
        );
      } else {
        await this.db.query(
          `INSERT INTO trading_accounts (
            id, tenant_id, client_id, account_number, platform, currency,
            account_type, session_mode, leverage, balance, equity,
            used_margin, free_margin, margin_level, margin_call_level,
            stop_out_level, status, trading_enabled, max_order_volume, max_position_volume,
            password_hash, trading_password, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
          ON CONFLICT (id) DO UPDATE SET
            balance = EXCLUDED.balance,
            equity = EXCLUDED.equity,
            free_margin = EXCLUDED.free_margin,
            status = EXCLUDED.status,
            trading_enabled = EXCLUDED.trading_enabled,
            leverage = EXCLUDED.leverage,
            password_hash = COALESCE(EXCLUDED.password_hash, trading_accounts.password_hash),
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
            normalizedStatus,
            account.tradingEnabled !== undefined ? account.tradingEnabled : true,
            account.maxOrderVolume ?? null,
            account.maxPositionVolume ?? null,
            account.passwordHash ?? null,
            account.tradingPassword ?? null,
            tsCreatedAt,
            tsUpdatedAt,
          ]
        );
      }
    }
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

    // Tenant boundary check: Ensure account number does not exist under a different tenant
    const existingByNumber = await this.getAccount(claims.accountNumber);
    if (existingByNumber) {
      if (existingByNumber.tenantId && existingByNumber.tenantId !== tenantId) {
        throw new Error(`Account ${claims.accountNumber} belongs to a different tenant (${existingByNumber.tenantId})`);
      }
      // Same tenant with different ID: update metadata and return existing account safely
      existingByNumber.clientId = claims.sub;
      if (claims.platform) existingByNumber.platform = claims.platform;
      existingByNumber.sessionMode = 'EXTERNAL';
      await this.updateAccountMetadataOnly(existingByNumber);
      return existingByNumber;
    }

    const initialBal = typeof claims.initialBalance === 'number'
      ? claims.initialBalance
      : typeof claims.balance === 'number'
      ? claims.balance
      : 0.00;

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

    const tsCreatedAt = toDbTimestamp(undefined, 'trading_accounts', 'created_at');
    const tsUpdatedAt = toDbTimestamp(undefined, 'trading_accounts', 'updated_at');
    const hasUserIdCol = !!SchemaInspector.getColumnType('trading_accounts', 'user_id');
    const userIdVal = (claims as any).userId || (claims as any).user_id || claims.sub || null;

    if (hasUserIdCol && userIdVal) {
      await this.db.query(
        `INSERT INTO trading_accounts (
          id, user_id, tenant_id, client_id, account_number, platform, currency,
          account_type, session_mode, leverage, balance, equity,
          used_margin, free_margin, margin_level, margin_call_level,
          stop_out_level, status, trading_enabled, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
        ON CONFLICT (id) DO UPDATE SET
          client_id = COALESCE(EXCLUDED.client_id, trading_accounts.client_id),
          session_mode = 'EXTERNAL',
          updated_at = EXCLUDED.updated_at;`,
        [
          externalAccount.id,
          userIdVal,
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
          tsCreatedAt,
          tsUpdatedAt,
        ]
      );
    } else {
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
          tsCreatedAt,
          tsUpdatedAt,
        ]
      );
    }

    if (initialBal > 0) {
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
    const nowMs = Date.now();

    await this.db.query(
      `INSERT INTO trading_ledger (id, account_id, tenant_id, type, amount, balance_after, reference_id, description, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);`,
      [id, accountId, 'tenant_default', type, amount, balanceAfter, referenceId || null, description, toDbTimestamp(nowMs)]
    );

    return {
      id,
      accountId,
      type,
      amount,
      balanceAfter,
      description,
      referenceId,
      createdAt: nowMs,
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
      createdAt: parseDbTimestamp(r.created_at),
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

  public async canDeleteAccount(tenantId: string, accountId: string): Promise<{ eligible: boolean; reason?: string }> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(accountId);
    
    // 1. Check orders
    const orderSql = isUuid
      ? `SELECT COUNT(*)::int as count FROM trading_orders WHERE tenant_id = $1 AND (account_id = $2::uuid OR account_id = $2);`
      : `SELECT COUNT(*)::int as count FROM trading_orders WHERE tenant_id = $1 AND account_id = $2;`;
    const orderRes = await this.db.query(orderSql, [tenantId, accountId]);
    if (orderRes.rows[0]?.count > 0) {
      return { eligible: false, reason: 'Cannot delete account with existing trading history or financial transactions. Please set account status to DISABLED.' };
    }

    // 2. Check positions
    const posSql = isUuid
      ? `SELECT COUNT(*)::int as count FROM trading_positions WHERE tenant_id = $1 AND (account_id = $2::uuid OR account_id = $2);`
      : `SELECT COUNT(*)::int as count FROM trading_positions WHERE tenant_id = $1 AND account_id = $2;`;
    const posRes = await this.db.query(posSql, [tenantId, accountId]);
    if (posRes.rows[0]?.count > 0) {
      return { eligible: false, reason: 'Cannot delete account with existing trading history or financial transactions. Please set account status to DISABLED.' };
    }

    // 3. Check executions
    const execSql = isUuid
      ? `SELECT COUNT(*)::int as count FROM trading_executions WHERE tenant_id = $1 AND (account_id = $2::uuid OR account_id = $2);`
      : `SELECT COUNT(*)::int as count FROM trading_executions WHERE tenant_id = $1 AND account_id = $2;`;
    const execRes = await this.db.query(execSql, [tenantId, accountId]);
    if (execRes.rows[0]?.count > 0) {
      return { eligible: false, reason: 'Cannot delete account with existing trading history or financial transactions. Please set account status to DISABLED.' };
    }

    // 4. Check ledger entries
    const ledgerSql = isUuid
      ? `SELECT COUNT(*)::int as count FROM trading_ledger WHERE tenant_id = $1 AND (account_id = $2::uuid OR account_id = $2);`
      : `SELECT COUNT(*)::int as count FROM trading_ledger WHERE tenant_id = $1 AND account_id = $2;`;
    const ledgerRes = await this.db.query(ledgerSql, [tenantId, accountId]);
    if (ledgerRes.rows[0]?.count > 0) {
      return { eligible: false, reason: 'Cannot delete account with existing trading history or financial transactions. Please set account status to DISABLED.' };
    }

    return { eligible: true };
  }

  public async deleteAccount(tenantId: string, accountId: string): Promise<void> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(accountId);
    const sql = isUuid
      ? `DELETE FROM trading_accounts WHERE tenant_id = $1 AND (id = $2::uuid OR id = $2);`
      : `DELETE FROM trading_accounts WHERE tenant_id = $1 AND id = $2;`;
    await this.db.query(sql, [tenantId, accountId]);
  }
}
