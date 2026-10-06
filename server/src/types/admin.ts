/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * STEP 5 — ADMIN & RISK CONTROL DOMAIN TYPES
 * Authoritative contracts for CRM Admin API, pair-wise spread policy,
 * tenant isolation, account controls, and immutable audit logs.
 */

import { InstrumentDefinition } from '../market/InstrumentRegistry';
import { TradingAccount } from './trading';

export type AdminRole = 'SUPER_ADMIN' | 'ADMIN' | 'RISK_MANAGER';

export interface AdminContext {
  adminId: string;
  tenantId: string;
  role: AdminRole;
}

export type SpreadUnit = 'POINTS' | 'PIPS' | 'PERCENTAGE';

export interface SpreadConfigRecord {
  id: string;
  tenantId: string;
  symbol: string;
  spreadPoints: number;
  spreadUnit: SpreadUnit;
  isActive: boolean;
  effectiveFrom: number; // Unix timestamp in milliseconds
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface CreateSpreadConfigPayload {
  symbol: string;
  spreadPoints: number;
  spreadUnit?: SpreadUnit;
  effectiveFrom?: number;
  isActive?: boolean;
}

export interface UpdateSpreadConfigPayload {
  spreadPoints?: number;
  spreadUnit?: SpreadUnit;
  effectiveFrom?: number;
  isActive?: boolean;
}

export interface AdminAccountCreatePayload {
  accountNumber?: string;
  clientId?: string | null;
  currency?: string;
  accountType?: 'DEMO' | 'LIVE';
  leverage?: number;
  initialBalance?: number;
  status?: 'ACTIVE' | 'READ_ONLY' | 'SUSPENDED' | 'DISABLED';
  tradingEnabled?: boolean;
  maxOrderVolume?: number;
  maxPositionVolume?: number;
  marginCallLevel?: number;
  stopOutLevel?: number;
  platform?: 'MT5' | 'MT4' | 'PROPRIETARY';
  reason?: string;
}

export interface AdminAccountUpdatePayload {
  status?: 'ACTIVE' | 'DISABLED' | 'SUSPENDED' | 'READ_ONLY';
  tradingEnabled?: boolean;
  leverage?: number;
  maxOrderVolume?: number;
  maxPositionVolume?: number;
  reason?: string;
}

export interface AdminSymbolUpdatePayload {
  enabled?: boolean;
  tradingStatus?: 'TRADING' | 'HALTED' | 'CLOSE_ONLY' | 'UNAVAILABLE';
  minVolume?: number;
  maxVolume?: number;
  volumeStep?: number;
  digits?: number;
  tickSize?: number;
  contractSize?: number;
  reason?: string;
}

export interface AdminAuditEntry {
  id: string;
  tenantId: string;
  adminId: string;
  action: string;
  resourceType: 'ACCOUNT' | 'SYMBOL' | 'SPREAD' | 'RISK';
  resourceId: string;
  prevState?: any;
  newState?: any;
  reason?: string;
  timestamp: number;
}
