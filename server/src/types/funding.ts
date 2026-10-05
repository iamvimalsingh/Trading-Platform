/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * STEP 3 — M2M FUNDING & FINANCIAL TRANSACTION DOMAIN TYPES
 * Authoritative contracts for CRM -> Trading Engine M2M Funding Credit operations.
 */

import { TradingAccount } from './trading';

export interface FundingCreditRequest {
  accountId: string;
  amount: number;
  currency?: string;
  transactionId: string;
  idempotencyKey: string;
  note?: string;
  tenantId?: string;
}

export interface FundingTransactionRecord {
  id: string;                 // transactionId
  idempotencyKey: string;
  accountId: string;
  tenantId: string;
  amount: number;
  currency: string;
  balanceBefore: number;
  balanceAfter: number;
  note?: string;
  ledgerEntryId?: string;
  status: 'SUCCESS' | 'FAILED';
  createdAt: number;
}

export interface FundingCreditResponse {
  success: boolean;
  transactionId: string;
  idempotencyKey: string;
  accountId: string;
  amount: number;
  currency: string;
  balanceBefore: number;
  balanceAfter: number;
  ledgerEntryId?: string;
  duplicate: boolean;
  timestamp: number;
  account?: TradingAccount;
}
