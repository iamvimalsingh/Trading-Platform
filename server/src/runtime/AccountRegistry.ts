/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * SERVER ACCOUNT REGISTRY
 * In-memory authoritative store for demo accounts and double-entry financial ledger.
 */

import { ExternalSessionTokenPayload, LedgerEntry, TradingAccount } from '../types/trading';

export interface IAccountRepository {
  getAccount(idOrNumber: string): TradingAccount | undefined;
  getAllAccounts(): TradingAccount[];
  updateAccount(account: TradingAccount): void;
  createLedgerEntry(
    accountId: string,
    type: LedgerEntry['type'],
    amount: number,
    balanceAfter: number,
    description: string,
    referenceId?: string
  ): LedgerEntry;
  getLedger(accountId: string): LedgerEntry[];
  provisionExternalAccount(claims: ExternalSessionTokenPayload): TradingAccount;
  isDemoAccount(idOrNumber: string): boolean;
  resetAccount(idOrNumber: string): TradingAccount | undefined;
}

const INITIAL_DEMO_ACCOUNTS: TradingAccount[] = [
  {
    id: 'acc_demo_1001',
    tenantId: 'tenant_default',
    accountNumber: 'DEMO-1001',
    currency: 'USD',
    accountType: 'DEMO',
    leverage: 100,
    balance: 10000.00,
    equity: 10000.00,
    usedMargin: 0.00,
    freeMargin: 10000.00,
    marginLevel: 0,
    marginCallLevel: 100,
    stopOutLevel: 50,
    status: 'ACTIVE',
    tradingEnabled: true,
    sessionMode: 'DEMO',
    platform: 'PROPRIETARY',
  },
  {
    id: 'acc_demo_1002',
    tenantId: 'tenant_default',
    accountNumber: 'DEMO-1002',
    currency: 'USD',
    accountType: 'DEMO',
    leverage: 100,
    balance: 10000.00,
    equity: 10000.00,
    usedMargin: 0.00,
    freeMargin: 10000.00,
    marginLevel: 0,
    marginCallLevel: 100,
    stopOutLevel: 50,
    status: 'ACTIVE',
    tradingEnabled: true,
    sessionMode: 'DEMO',
    platform: 'PROPRIETARY',
  },
];

export class AccountRegistry implements IAccountRepository {
  private accounts: Map<string, TradingAccount> = new Map();
  private ledger: Map<string, LedgerEntry[]> = new Map();
  private nextLedgerId: number = 1000;

  constructor() {
    this.seedAccounts();
  }

  private seedAccounts(): void {
    const now = Date.now();
    for (const acc of INITIAL_DEMO_ACCOUNTS) {
      this.accounts.set(acc.id, { ...acc });
      this.accounts.set(acc.accountNumber, { ...acc }); // alias by account number

      const initialEntry: LedgerEntry = {
        id: `led_${++this.nextLedgerId}`,
        accountId: acc.id,
        type: 'DEPOSIT',
        amount: acc.balance,
        balanceAfter: acc.balance,
        description: `Initial Demo Funding for ${acc.accountNumber}`,
        createdAt: now,
      };
      this.ledger.set(acc.id, [initialEntry]);
    }
  }

  public isDemoAccount(idOrNumber: string): boolean {
    return (
      idOrNumber === 'acc_demo_1001' ||
      idOrNumber === 'DEMO-1001' ||
      idOrNumber === 'acc_demo_1002' ||
      idOrNumber === 'DEMO-1002'
    );
  }

  public provisionExternalAccount(claims: ExternalSessionTokenPayload): TradingAccount {
    const existing = this.getAccount(claims.accountId) || this.getAccount(claims.accountNumber);
    if (existing) {
      // Ensure metadata is synchronized with validated token
      existing.clientId = claims.sub;
      if (claims.platform) existing.platform = claims.platform;
      existing.sessionMode = 'EXTERNAL';
      this.updateAccount(existing);
      return existing;
    }

    const initialBal = typeof claims.initialBalance === 'number'
      ? claims.initialBalance
      : typeof claims.balance === 'number'
      ? claims.balance
      : 0.00;

    const externalAccount: TradingAccount = {
      id: claims.accountId,
      tenantId: claims.tenantId || 'tenant_default',
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

    this.updateAccount(externalAccount);

    if (initialBal > 0) {
      this.createLedgerEntry(
        externalAccount.id,
        'DEPOSIT',
        initialBal,
        initialBal,
        `External Account Hydrated from CRM (${externalAccount.platform} #${externalAccount.accountNumber})`
      );
    }

    return externalAccount;
  }

  public getAccount(idOrNumber: string): TradingAccount | undefined {
    return this.accounts.get(idOrNumber);
  }

  public getAllAccounts(): TradingAccount[] {
    const unique = new Map<string, TradingAccount>();
    for (const acc of this.accounts.values()) {
      unique.set(acc.id, acc);
    }
    return Array.from(unique.values());
  }

  public updateAccount(account: TradingAccount): void {
    this.accounts.set(account.id, { ...account });
    this.accounts.set(account.accountNumber, { ...account });
  }

  public hydrateAccount(account: TradingAccount, ledger: LedgerEntry[]): void {
    this.updateAccount(account);
    const existingLedger = this.ledger.get(account.id) || [];
    const mergedMap = new Map<string, LedgerEntry>();
    for (const e of [...ledger, ...existingLedger]) {
      mergedMap.set(e.id, e);
    }
    this.ledger.set(account.id, Array.from(mergedMap.values()).sort((a, b) => b.createdAt - a.createdAt));
  }

  public addLedgerEntry(entry: LedgerEntry): void {
    const existing = this.ledger.get(entry.accountId) || [];
    this.ledger.set(entry.accountId, [entry, ...existing]);
  }

  public getLedger(accountId: string): LedgerEntry[] {
    return this.ledger.get(accountId) || [];
  }

  public createLedgerEntry(
    accountId: string,
    type: LedgerEntry['type'],
    amount: number,
    balanceAfter: number,
    description: string,
    referenceId?: string
  ): LedgerEntry {
    const entry: LedgerEntry = {
      id: `led_${++this.nextLedgerId}`,
      accountId,
      type,
      amount,
      balanceAfter,
      description,
      referenceId,
      createdAt: Date.now(),
    };
    this.addLedgerEntry(entry);
    return entry;
  }

  public resetAccount(idOrNumber: string): TradingAccount | undefined {
    const existing = this.getAccount(idOrNumber);
    if (!existing) return undefined;

    const baseConfig = INITIAL_DEMO_ACCOUNTS.find((a) => a.id === existing.id) || existing;
    const resetAcc: TradingAccount = {
      ...baseConfig,
      balance: 10000.00,
      equity: 10000.00,
      usedMargin: 0.00,
      freeMargin: 10000.00,
      marginLevel: 0,
      status: 'ACTIVE',
    };

    this.updateAccount(resetAcc);
    this.ledger.set(resetAcc.id, [
      {
        id: `led_${++this.nextLedgerId}`,
        accountId: resetAcc.id,
        type: 'DEPOSIT',
        amount: 10000.00,
        balanceAfter: 10000.00,
        description: `Reset Demo Balance for ${resetAcc.accountNumber}`,
        createdAt: Date.now(),
      },
    ]);

    return resetAcc;
  }
}
