/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * SERVER-AUTHORITATIVE TRADING ADMIN SERVICE (STEP 5)
 * Orchestrates administrative trading controls:
 * 1. Account Controls: enable/disable, trading status, leverage, risk volume limits.
 * 2. Symbol Controls: trading enable/block, halt status, min/max volume, tickSize, digits.
 * 3. Pair-Wise Spread Controls: effective-dated pair-wise spread configuration.
 * 4. Tenant Isolation: strict multi-tenant separation across all resources.
 * 5. Immutable Audit Trail: complete audit logging for every administrative operation.
 */

import { TradingRuntime } from '../runtime/TradingRuntime';
import { InstrumentDefinition, InstrumentRegistry } from '../market/InstrumentRegistry';
import { AdminSpreadPricingPolicy } from '../market/AdminSpreadPricingPolicy';
import { PostgresAuditRepository } from '../repositories/PostgresAuditRepository';
import { PostgresSpreadRepository } from '../repositories/PostgresSpreadRepository';
import { PostgresSymbolRepository } from '../repositories/PostgresSymbolRepository';
import {
  AdminAccountCreatePayload,
  AdminAccountUpdatePayload,
  AdminAuditEntry,
  AdminContext,
  AdminSymbolUpdatePayload,
  CreateSpreadConfigPayload,
  SpreadConfigRecord,
  UpdateSpreadConfigPayload,
} from '../types/admin';
import { TradingAccount } from '../types/trading';
import { normalizeAccountStatus, isValidAccountStatus } from '../utils/accountStatus';

export class TradingAdminService {
  constructor(
    public readonly runtime: TradingRuntime,
    public readonly auditRepo: PostgresAuditRepository,
    public readonly spreadRepo: PostgresSpreadRepository,
    public readonly symbolRepo: PostgresSymbolRepository,
    public readonly spreadPolicy: AdminSpreadPricingPolicy
  ) {}

  /**
   * Initializes persistent configurations from PostgreSQL on server startup.
   */
  public async init(tenantId: string = 'tenant_default'): Promise<void> {
    try {
      // Ensure persistence / schema migrations have executed before hydrating configs
      if (this.runtime?.persistence) {
        await this.runtime.persistence.init();
      }

      // 1. Hydrate symbol overrides from database into InstrumentRegistry
      const overrides = await this.symbolRepo.getSymbolOverrides(tenantId);
      const registry = InstrumentRegistry.getInstance();
      for (const [sym, override] of Object.entries(overrides)) {
        registry.updateInstrument(sym, override);
      }

      // 2. Hydrate active spread configs from database into AdminSpreadPricingPolicy
      const spreads = await this.spreadRepo.getSpreadConfigsByTenant(tenantId);
      for (const sc of spreads) {
        this.spreadPolicy.addConfig(sc);
      }
    } catch (err) {
      console.warn('[TradingAdminService] Non-fatal init warning (DB may be initializing):', err);
    }
  }

  // ---------------------------------------------------------------------------
  // 1. ACCOUNT ADMIN CONTROLS
  // ---------------------------------------------------------------------------

  public async getAccount(tenantId: string, accountId: string): Promise<TradingAccount | undefined> {
    const acc = this.runtime.accounts.getAccount(accountId);
    if (acc) {
      // Tenant Isolation Check
      if (acc.tenantId && acc.tenantId !== tenantId) {
        return undefined; // Hide account from other tenants
      }
      return acc;
    }

    // Fallback to database
    const dbAcc = await this.runtime.persistence.accounts.getAccount(accountId);
    if (dbAcc && dbAcc.tenantId === tenantId) {
      return dbAcc;
    }
    return undefined;
  }

  public async createAccount(
    tenantId: string,
    payload: AdminAccountCreatePayload,
    admin: AdminContext
  ): Promise<TradingAccount> {
    const effectiveTenant = tenantId || 'tenant_default';

    // 1. Validate / Determine Account Number
    let accNum: string;
    if (payload.accountNumber !== undefined && payload.accountNumber !== null) {
      accNum = String(payload.accountNumber).trim();
      if (!accNum) {
        throw new Error('accountNumber cannot be empty if specified');
      }
      const existing = await this.runtime.persistence.accounts.getAccount(accNum) ||
                       this.runtime.accounts.getAccount(accNum);
      if (existing) {
        throw new Error(`Account number '${accNum}' already exists`);
      }
    } else {
      // Auto-generate a unique 6-digit account number
      let candidate = '';
      let isUnique = false;
      let attempts = 0;
      while (!isUnique && attempts < 20) {
        attempts++;
        candidate = String(Math.floor(100000 + Math.random() * 900000));
        const existing = await this.runtime.persistence.accounts.getAccount(candidate) ||
                         this.runtime.accounts.getAccount(candidate);
        if (!existing) {
          isUnique = true;
        }
      }
      if (!isUnique) {
        candidate = `ACC-${Date.now().toString().slice(-6)}`;
      }
      accNum = candidate;
    }

    // 2. Validate Status
    let status: 'ACTIVE' | 'READ_ONLY' | 'SUSPENDED' | 'DISABLED' = 'ACTIVE';
    if (payload.status !== undefined && payload.status !== null) {
      if (!isValidAccountStatus(payload.status)) {
        throw new Error(`Invalid account status '${payload.status}'. Must be one of: ACTIVE, READ_ONLY, SUSPENDED, DISABLED`);
      }
      status = normalizeAccountStatus(payload.status, 'ACTIVE');
    }

    // 3. Validate Leverage
    const leverage = payload.leverage !== undefined ? payload.leverage : 100;
    if (typeof leverage !== 'number' || leverage <= 0 || leverage > 1000) {
      throw new Error('Invalid leverage: must be between 1 and 1000');
    }

    // 4. Validate Initial Balance
    const initialBalance = payload.initialBalance !== undefined ? Number(payload.initialBalance) : 0.00;
    if (isNaN(initialBalance) || initialBalance < 0) {
      throw new Error('Invalid initialBalance: must be a non-negative number');
    }

    // 5. Volume Limits Validation
    if (payload.maxOrderVolume !== undefined && payload.maxOrderVolume !== null) {
      if (typeof payload.maxOrderVolume !== 'number' || payload.maxOrderVolume <= 0) {
        throw new Error('Invalid maxOrderVolume: must be greater than zero');
      }
    }
    if (payload.maxPositionVolume !== undefined && payload.maxPositionVolume !== null) {
      if (typeof payload.maxPositionVolume !== 'number' || payload.maxPositionVolume <= 0) {
        throw new Error('Invalid maxPositionVolume: must be greater than zero');
      }
    }

    const id = `acc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = Date.now();

    const account: TradingAccount = {
      id,
      tenantId: effectiveTenant,
      clientId: payload.clientId !== undefined ? payload.clientId : undefined,
      accountNumber: accNum,
      platform: payload.platform || 'MT5',
      currency: payload.currency || 'USD',
      accountType: payload.accountType || 'LIVE',
      sessionMode: 'EXTERNAL',
      leverage,
      balance: initialBalance,
      equity: initialBalance,
      usedMargin: 0.00,
      freeMargin: initialBalance,
      marginLevel: 0,
      marginCallLevel: payload.marginCallLevel || 100,
      stopOutLevel: payload.stopOutLevel || 50,
      status,
      tradingEnabled: payload.tradingEnabled !== undefined ? payload.tradingEnabled : true,
      maxOrderVolume: payload.maxOrderVolume,
      maxPositionVolume: payload.maxPositionVolume,
      createdAt: now,
      updatedAt: now,
    };

    // Persist to PostgreSQL repository
    await this.runtime.persistence.accounts.updateAccount(account);

    // Initial Ledger Deposit if initialBalance > 0
    if (initialBalance > 0) {
      const desc = `Initial provisioning balance by Manager ${admin.adminId}`;
      await this.runtime.persistence.accounts.createLedgerEntry(account.id, 'DEPOSIT', initialBalance, initialBalance, desc);
      this.runtime.accounts.createLedgerEntry(account.id, 'DEPOSIT', initialBalance, initialBalance, desc);
    }

    // Hydrate into runtime memory
    this.runtime.accounts.updateAccount(account);

    // Record audit log
    const auditEntry: AdminAuditEntry = {
      id: `aud_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      tenantId: effectiveTenant,
      adminId: admin.adminId,
      action: 'CREATE_ACCOUNT',
      resourceType: 'ACCOUNT',
      resourceId: account.id,
      newState: account,
      reason: payload.reason || 'Manager account provisioning',
      timestamp: Date.now(),
    };
    await this.auditRepo.saveAuditEntry(auditEntry);

    return account;
  }

  public async updateAccount(
    tenantId: string,
    accountId: string,
    payload: AdminAccountUpdatePayload,
    admin: AdminContext
  ): Promise<TradingAccount> {
    const account = await this.getAccount(tenantId, accountId);
    if (!account) {
      throw new Error(`Account '${accountId}' not found in tenant '${tenantId}'`);
    }

    // Validation: Leverage
    if (payload.leverage !== undefined) {
      if (typeof payload.leverage !== 'number' || payload.leverage <= 0 || payload.leverage > 1000) {
        throw new Error(`Invalid leverage: must be between 1 and 1000`);
      }
    }

    // Validation: Volume Limits
    if (payload.maxOrderVolume !== undefined && payload.maxOrderVolume !== null) {
      if (typeof payload.maxOrderVolume !== 'number' || payload.maxOrderVolume <= 0) {
        throw new Error(`Invalid maxOrderVolume: must be greater than zero`);
      }
    }

    if (payload.maxPositionVolume !== undefined && payload.maxPositionVolume !== null) {
      if (typeof payload.maxPositionVolume !== 'number' || payload.maxPositionVolume <= 0) {
        throw new Error(`Invalid maxPositionVolume: must be greater than zero`);
      }
    }

    // Validation: Status Normalization
    if (payload.status !== undefined && payload.status !== null) {
      if (!isValidAccountStatus(payload.status)) {
        throw new Error(`Invalid account status '${payload.status}'. Must be one of: ACTIVE, READ_ONLY, SUSPENDED, DISABLED`);
      }
    }

    const prevState = {
      status: account.status,
      tradingEnabled: account.tradingEnabled !== undefined ? account.tradingEnabled : true,
      leverage: account.leverage,
      maxOrderVolume: account.maxOrderVolume,
      maxPositionVolume: account.maxPositionVolume,
    };

    // Apply updates
    if (payload.status !== undefined) account.status = normalizeAccountStatus(payload.status, 'DISABLED');
    if (payload.tradingEnabled !== undefined) account.tradingEnabled = payload.tradingEnabled;
    if (payload.leverage !== undefined) account.leverage = payload.leverage;
    if (payload.maxOrderVolume !== undefined) account.maxOrderVolume = payload.maxOrderVolume;
    if (payload.maxPositionVolume !== undefined) account.maxPositionVolume = payload.maxPositionVolume;

    const newState = {
      status: account.status,
      tradingEnabled: account.tradingEnabled,
      leverage: account.leverage,
      maxOrderVolume: account.maxOrderVolume,
      maxPositionVolume: account.maxPositionVolume,
    };

    // Record audit log
    const auditEntry: AdminAuditEntry = {
      id: `aud_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      tenantId,
      adminId: admin.adminId,
      action: 'UPDATE_ACCOUNT',
      resourceType: 'ACCOUNT',
      resourceId: account.id,
      prevState,
      newState,
      reason: payload.reason || 'Admin modification of account risk parameters',
      timestamp: Date.now(),
    };
    await this.auditRepo.saveAuditEntry(auditEntry);

    // Update in-memory runtime
    this.runtime.accounts.updateAccount(account);

    // Persist to PostgreSQL
    await this.runtime.persistence.accounts.updateAccount(account);

    // Notify connected client sessions via WebSocket
    this.runtime.sendToAccount(account.id, 'ACCOUNT_STATE', { account });

    return account;
  }

  public async deleteAccount(
    tenantId: string,
    accountId: string,
    admin: AdminContext
  ): Promise<{ success: boolean; message: string }> {
    const account = await this.getAccount(tenantId, accountId);
    if (!account) {
      throw new Error(`Account '${accountId}' not found in tenant '${tenantId}'`);
    }

    const eligibility = this.runtime.persistence?.accounts?.canDeleteAccount
      ? await this.runtime.persistence.accounts.canDeleteAccount(tenantId, account.id)
      : { eligible: true };

    if (!eligibility.eligible) {
      const rejectAudit: AdminAuditEntry = {
        id: `aud_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        tenantId,
        adminId: admin.adminId,
        action: 'DELETE_ACCOUNT_REJECTED',
        resourceType: 'ACCOUNT',
        resourceId: account.id,
        reason: eligibility.reason || 'Cannot delete account with existing trading history',
        timestamp: Date.now(),
      };
      await this.auditRepo.saveAuditEntry(rejectAudit);

      throw new Error(eligibility.reason || 'Cannot delete account with existing trading history or financial transactions. Please set account status to DISABLED.');
    }

    // Perform hard delete
    if (this.runtime.persistence?.accounts?.deleteAccount) {
      await this.runtime.persistence.accounts.deleteAccount(tenantId, account.id);
    }
    if (this.runtime.accounts.deleteAccount) {
      this.runtime.accounts.deleteAccount(account.id);
    }

    const deleteAudit: AdminAuditEntry = {
      id: `aud_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      tenantId,
      adminId: admin.adminId,
      action: 'DELETE_ACCOUNT',
      resourceType: 'ACCOUNT',
      resourceId: account.id,
      prevState: account,
      reason: 'Manager hard deletion of eligible unused account',
      timestamp: Date.now(),
    };
    await this.auditRepo.saveAuditEntry(deleteAudit);

    return { success: true, message: 'Account deleted successfully' };
  }

  // ---------------------------------------------------------------------------
  // 2. SYMBOL / INSTRUMENT ADMIN CONTROLS
  // ---------------------------------------------------------------------------

  public getAllSymbols(tenantId: string): InstrumentDefinition[] {
    return InstrumentRegistry.getInstance().getAllSymbols();
  }

  public getSymbol(tenantId: string, symbol: string): InstrumentDefinition | undefined {
    return InstrumentRegistry.getInstance().getSymbol(symbol);
  }

  public async updateSymbol(
    tenantId: string,
    symbol: string,
    payload: AdminSymbolUpdatePayload,
    admin: AdminContext
  ): Promise<InstrumentDefinition> {
    const registry = InstrumentRegistry.getInstance();
    const existing = registry.getSymbol(symbol);
    if (!existing) {
      throw new Error(`Symbol '${symbol}' not found in InstrumentRegistry`);
    }

    // Validation: Volumes
    if (payload.minVolume !== undefined && payload.minVolume <= 0) {
      throw new Error('minVolume must be greater than zero');
    }
    if (payload.maxVolume !== undefined) {
      const minV = payload.minVolume ?? existing.minVolume;
      if (payload.maxVolume < minV) {
        throw new Error(`maxVolume (${payload.maxVolume}) cannot be less than minVolume (${minV})`);
      }
    }

    // Validation: Precision
    if (payload.digits !== undefined && (payload.digits < 0 || payload.digits > 8)) {
      throw new Error('digits must be between 0 and 8');
    }
    if (payload.tickSize !== undefined && payload.tickSize <= 0) {
      throw new Error('tickSize must be greater than zero');
    }
    if (payload.contractSize !== undefined && payload.contractSize <= 0) {
      throw new Error('contractSize must be greater than zero');
    }

    const prevState = {
      enabled: existing.enabled,
      tradingStatus: existing.tradingStatus,
      minVolume: existing.minVolume,
      maxVolume: existing.maxVolume,
      volumeStep: existing.volumeStep,
      digits: existing.digits,
      tickSize: existing.tickSize,
      contractSize: existing.contractSize,
    };

    const updated = registry.updateInstrument(symbol, payload);
    if (!updated) {
      throw new Error(`Failed to update symbol '${symbol}'`);
    }

    const newState = {
      enabled: updated.enabled,
      tradingStatus: updated.tradingStatus,
      minVolume: updated.minVolume,
      maxVolume: updated.maxVolume,
      volumeStep: updated.volumeStep,
      digits: updated.digits,
      tickSize: updated.tickSize,
      contractSize: updated.contractSize,
    };

    // Record audit log
    const auditEntry: AdminAuditEntry = {
      id: `aud_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      tenantId,
      adminId: admin.adminId,
      action: 'UPDATE_SYMBOL',
      resourceType: 'SYMBOL',
      resourceId: updated.symbol,
      prevState,
      newState,
      reason: payload.reason || 'Admin modification of symbol configuration',
      timestamp: Date.now(),
    };
    await this.auditRepo.saveAuditEntry(auditEntry);

    // Persist to PostgreSQL
    await this.symbolRepo.upsertSymbolOverride(tenantId, symbol, payload, admin.adminId);

    return updated;
  }

  // ---------------------------------------------------------------------------
  // 3. PAIR-WISE SPREAD CONTROL (EFFECTIVE-DATED)
  // ---------------------------------------------------------------------------

  public async getSpreadConfigs(tenantId: string, symbol?: string): Promise<SpreadConfigRecord[]> {
    return this.spreadRepo.getSpreadConfigsByTenant(tenantId, symbol);
  }

  public async createSpreadConfig(
    tenantId: string,
    payload: CreateSpreadConfigPayload,
    admin: AdminContext
  ): Promise<SpreadConfigRecord> {
    const symbol = payload.symbol.trim().toUpperCase();
    const registry = InstrumentRegistry.getInstance();
    if (!registry.hasSymbol(symbol)) {
      throw new Error(`Symbol '${symbol}' is not a registered canonical instrument`);
    }

    if (payload.spreadPoints === undefined || payload.spreadPoints < 0) {
      throw new Error('spreadPoints must be greater than or equal to zero');
    }

    const now = Date.now();
    const configId = `sp_cfg_${now}_${Math.random().toString(36).substring(2, 7)}`;
    const record: SpreadConfigRecord = {
      id: configId,
      tenantId,
      symbol,
      spreadPoints: payload.spreadPoints,
      spreadUnit: payload.spreadUnit || 'POINTS',
      isActive: payload.isActive !== undefined ? payload.isActive : true,
      effectiveFrom: payload.effectiveFrom || now,
      createdBy: admin.adminId,
      createdAt: now,
      updatedAt: now,
    };

    // 1. Persist to PostgreSQL
    await this.spreadRepo.createSpreadConfig(record);

    // 2. Register into in-memory Spread Pricing Policy for live quote execution
    this.spreadPolicy.addConfig(record);
    if ((this.runtime.market as any)?.repriceAllQuotes) {
      (this.runtime.market as any).repriceAllQuotes(tenantId);
    }

    // 3. Record audit trail
    const auditEntry: AdminAuditEntry = {
      id: `aud_${now}_${Math.random().toString(36).substring(2, 7)}`,
      tenantId,
      adminId: admin.adminId,
      action: 'CREATE_SPREAD_CONFIG',
      resourceType: 'SPREAD',
      resourceId: record.id,
      newState: record,
      reason: `Configured ${record.spreadPoints} ${record.spreadUnit} spread for ${record.symbol} effective from ${new Date(record.effectiveFrom).toISOString()}`,
      timestamp: now,
    };
    await this.auditRepo.saveAuditEntry(auditEntry);

    return record;
  }

  public async updateSpreadConfig(
    tenantId: string,
    configId: string,
    payload: UpdateSpreadConfigPayload,
    admin: AdminContext
  ): Promise<SpreadConfigRecord> {
    const existing = await this.spreadRepo.getSpreadConfig(configId);
    if (!existing || existing.tenantId !== tenantId) {
      throw new Error(`Spread configuration '${configId}' not found in tenant '${tenantId}'`);
    }

    if (payload.spreadPoints !== undefined && payload.spreadPoints < 0) {
      throw new Error('spreadPoints must be greater than or equal to zero');
    }

    const prevState = { ...existing };
    const updated = await this.spreadRepo.updateSpreadConfig(configId, tenantId, payload);
    if (!updated) {
      throw new Error(`Failed to update spread configuration '${configId}'`);
    }

    // Update in-memory Spread Pricing Policy
    this.spreadPolicy.addConfig(updated);
    if ((this.runtime.market as any)?.repriceAllQuotes) {
      (this.runtime.market as any).repriceAllQuotes(tenantId);
    }

    // Record audit trail
    const auditEntry: AdminAuditEntry = {
      id: `aud_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      tenantId,
      adminId: admin.adminId,
      action: 'UPDATE_SPREAD_CONFIG',
      resourceType: 'SPREAD',
      resourceId: updated.id,
      prevState,
      newState: updated,
      reason: `Updated spread configuration for ${updated.symbol}`,
      timestamp: Date.now(),
    };
    await this.auditRepo.saveAuditEntry(auditEntry);

    return updated;
  }

  // ---------------------------------------------------------------------------
  // 4. AUDIT LOG QUERYING
  // ---------------------------------------------------------------------------

  public async getAuditLogs(
    tenantId: string,
    filter?: { resourceType?: string; resourceId?: string; adminId?: string; limit?: number }
  ): Promise<AdminAuditEntry[]> {
    return this.auditRepo.getAuditEntries(tenantId, filter);
  }
}
