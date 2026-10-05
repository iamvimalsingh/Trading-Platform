/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * SERVER FUNDING SERVICE (STEP 3)
 * Orchestrates authoritative balance crediting, ledger entry generation,
 * duplicate idempotency protection, database persistence, and WebSocket broadcasting.
 */

import { TradingRuntime } from '../runtime/TradingRuntime';
import {
  FundingCreditRequest,
  FundingCreditResponse,
  FundingTransactionRecord,
} from '../types/funding';
import { LedgerEntry, TradingAccount } from '../types/trading';

export class FundingService {
  constructor(private runtime: TradingRuntime) {}

  /**
   * Executes an atomic funding credit operation.
   */
  public async creditAccount(
    request: FundingCreditRequest
  ): Promise<{ success: boolean; statusCode: number; data?: FundingCreditResponse; error?: string; code?: string }> {
    const { accountId, amount, currency, transactionId, idempotencyKey, note, tenantId } = request;

    // 1. Validation: accountId
    if (!accountId || typeof accountId !== 'string' || !accountId.trim()) {
      return { success: false, statusCode: 400, error: 'Missing or invalid accountId', code: 'INVALID_ACCOUNT_ID' };
    }

    // 2. Validation: amount
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      return { success: false, statusCode: 400, error: 'Amount must be a positive finite number greater than zero', code: 'INVALID_AMOUNT' };
    }

    // Normalize monetary amount to 2 decimal places to prevent floating-point precision issues
    const normalizedAmount = Number(amount.toFixed(2));
    if (normalizedAmount <= 0) {
      return { success: false, statusCode: 400, error: 'Amount must be greater than zero after rounding', code: 'INVALID_AMOUNT' };
    }

    // 3. Validation: transactionId & idempotencyKey
    if (!transactionId || typeof transactionId !== 'string' || !transactionId.trim()) {
      return { success: false, statusCode: 400, error: 'Missing or invalid transactionId', code: 'INVALID_TRANSACTION_ID' };
    }

    if (!idempotencyKey || typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
      return { success: false, statusCode: 400, error: 'Missing or invalid idempotencyKey', code: 'INVALID_IDEMPOTENCY_KEY' };
    }

    const trimmedAccountId = accountId.trim();
    const trimmedTxId = transactionId.trim();
    const trimmedIdempotencyKey = idempotencyKey.trim();

    // 4. Resolve Account (Check in-memory registry first, then PostgreSQL persistence via separate typed paths)
    let account = this.runtime.accounts.getAccount(trimmedAccountId);
    if (!account) {
      account = await this.runtime.persistence.funding.getAccount(trimmedAccountId);
    }
    if (!account) {
      account = await this.runtime.persistence.accounts.getAccount(trimmedAccountId);
    }

    if (!account) {
      return {
        success: false,
        statusCode: 404,
        error: `Trading account '${trimmedAccountId}' not found`,
        code: 'ACCOUNT_NOT_FOUND',
      };
    }

    const effectiveTenantId = tenantId || account.tenantId || 'tenant_default';

    // 5. Validation: Currency compatibility
    const targetCurrency = currency?.trim().toUpperCase() || account.currency;
    if (account.currency && targetCurrency !== account.currency) {
      return {
        success: false,
        statusCode: 400,
        error: `Currency mismatch: account base currency is ${account.currency}, but requested funding currency is ${targetCurrency}`,
        code: 'CURRENCY_MISMATCH',
      };
    }

    // 6. Check existing transaction by ID or idempotency key (Idempotency check)
    const existingById = await this.runtime.persistence.funding.getFundingTransaction(trimmedTxId);
    if (existingById) {
      return {
        success: true,
        statusCode: 200,
        data: {
          success: true,
          transactionId: existingById.id,
          idempotencyKey: existingById.idempotencyKey,
          accountId: existingById.accountId,
          amount: existingById.amount,
          currency: existingById.currency,
          balanceBefore: existingById.balanceBefore,
          balanceAfter: existingById.balanceAfter,
          ledgerEntryId: existingById.ledgerEntryId,
          duplicate: true,
          timestamp: existingById.createdAt,
          account,
        },
      };
    }

    const existingByIdempotency = await this.runtime.persistence.funding.getFundingTransactionByIdempotencyKey(
      effectiveTenantId,
      trimmedIdempotencyKey
    );
    if (existingByIdempotency) {
      return {
        success: true,
        statusCode: 200,
        data: {
          success: true,
          transactionId: existingByIdempotency.id,
          idempotencyKey: existingByIdempotency.idempotencyKey,
          accountId: existingByIdempotency.accountId,
          amount: existingByIdempotency.amount,
          currency: existingByIdempotency.currency,
          balanceBefore: existingByIdempotency.balanceBefore,
          balanceAfter: existingByIdempotency.balanceAfter,
          ledgerEntryId: existingByIdempotency.ledgerEntryId,
          duplicate: true,
          timestamp: existingByIdempotency.createdAt,
          account,
        },
      };
    }

    // 7. Calculate new financial state
    const balanceBefore = Number(account.balance.toFixed(2));
    const balanceAfter = Number((balanceBefore + normalizedAmount).toFixed(2));
    const now = Date.now();

    const ledgerEntryId = `led_${now}_${Math.random().toString(36).substring(2, 7)}`;
    const ledgerDescription = note?.trim() || `CRM M2M Funding Credit: ${normalizedAmount} ${targetCurrency} (TX: ${trimmedTxId})`;

    const ledgerEntry: LedgerEntry = {
      id: ledgerEntryId,
      accountId: account.id,
      type: 'DEPOSIT',
      amount: normalizedAmount,
      balanceAfter,
      description: ledgerDescription,
      referenceId: trimmedTxId,
      createdAt: now,
    };

    const fundingRecord: FundingTransactionRecord = {
      id: trimmedTxId,
      idempotencyKey: trimmedIdempotencyKey,
      accountId: account.id,
      tenantId: effectiveTenantId,
      amount: normalizedAmount,
      currency: targetCurrency,
      balanceBefore,
      balanceAfter,
      note: note?.trim(),
      ledgerEntryId,
      status: 'SUCCESS',
      createdAt: now,
    };

    // Prepare updated account state
    const updatedAccount: TradingAccount = {
      ...account,
      balance: balanceAfter,
      equity: Number((account.equity + normalizedAmount).toFixed(2)),
      freeMargin: Number((account.freeMargin + normalizedAmount).toFixed(2)),
      marginLevel: account.usedMargin > 0
        ? Number((((account.equity + normalizedAmount) / account.usedMargin) * 100).toFixed(2))
        : 0,
    };

    // 8. Atomically apply in PostgreSQL transaction
    const persistenceResult = await this.runtime.persistence.applyFundingCredit(
      fundingRecord,
      ledgerEntry,
      updatedAccount,
      effectiveTenantId
    );

    if (persistenceResult.duplicate && persistenceResult.existingRecord) {
      return {
        success: true,
        statusCode: 200,
        data: {
          success: true,
          transactionId: persistenceResult.existingRecord.id,
          idempotencyKey: persistenceResult.existingRecord.idempotencyKey,
          accountId: persistenceResult.existingRecord.accountId,
          amount: persistenceResult.existingRecord.amount,
          currency: persistenceResult.existingRecord.currency,
          balanceBefore: persistenceResult.existingRecord.balanceBefore,
          balanceAfter: persistenceResult.existingRecord.balanceAfter,
          ledgerEntryId: persistenceResult.existingRecord.ledgerEntryId,
          duplicate: true,
          timestamp: persistenceResult.existingRecord.createdAt,
          account,
        },
      };
    }

    // 9. Synchronize in-memory TradingRuntime state
    this.runtime.accounts.updateAccount(updatedAccount);
    this.runtime.accounts.addLedgerEntry(ledgerEntry);

    // 10. Broadcast updated account state to connected WebSocket sessions
    this.runtime.sendToAccount(updatedAccount.id, 'ACCOUNT_STATE', { account: updatedAccount });

    return {
      success: true,
      statusCode: 200,
      data: {
        success: true,
        transactionId: fundingRecord.id,
        idempotencyKey: fundingRecord.idempotencyKey,
        accountId: updatedAccount.id,
        amount: normalizedAmount,
        currency: targetCurrency,
        balanceBefore,
        balanceAfter,
        ledgerEntryId,
        duplicate: false,
        timestamp: now,
        account: updatedAccount,
      },
    };
  }
}
