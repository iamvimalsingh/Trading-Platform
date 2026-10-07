/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * T1 TRADING DOMAIN CONTRACTS
 * Pure TypeScript interfaces independent of React UI.
 */

export type AssetCategory = 'FOREX' | 'CRYPTO' | 'METALS' | 'COMMODITIES' | 'INDICES';

export interface SymbolConfig {
  id: string;
  symbol: string;
  name: string;
  category: AssetCategory;
  digits: number;               // decimal precision, e.g. 5 for EURUSD, 2 for XAUUSD/BTC
  tickSize?: number;           // minimum tick increment, e.g. 0.00001
  contractSize: number;         // e.g. 100,000 for Forex, 100 for Gold, 1 for BTC
  minVolume: number;           // e.g. 0.01
  maxVolume: number;           // e.g. 100.0
  volumeStep: number;          // e.g. 0.01
  defaultSpreadPoints: number; // e.g. 1.2 pips
  baseCurrency: string;
  quoteCurrency: string;
  description: string;
}

export interface Quote {
  symbol: string;
  bid: number;
  ask: number;
  spread: number;
  mid: number;
  high24h: number;
  low24h: number;
  change24h: number;
  change24hPct: number;
  timestamp: number;
  tickDirection?: 'UP' | 'DOWN' | 'FLAT';
  marketStatus?: 'OPEN' | 'LIVE' | 'STALE' | 'CLOSED' | 'DISCONNECTED' | 'UNAVAILABLE' | 'WAITING_FOR_PROVIDER' | 'SIMULATED';
  isStale?: boolean;
  source?: string;
  digits?: number;
  tickSize?: number;
  providerTimestamp?: number;
  receivedTimestamp?: number;
  sequence?: number;
}

export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'MARKET' | 'LIMIT' | 'STOP';
export type OrderStatus = 'NEW' | 'PENDING' | 'WORKING' | 'PARTIALLY_FILLED' | 'FILLED' | 'REJECTED' | 'CANCELLED' | 'REPLACED';

export type ExecutionType = 'OPEN' | 'CLOSE';

export interface Execution {
  id: string;
  orderId?: string;
  positionId?: string;
  accountId: string;
  symbol: string;
  side: OrderSide;
  type: ExecutionType;
  volume: number;
  executionPrice: number;
  commission: number;
  fee?: number;
  realizedPnL?: number;
  clientOrderId?: string;
  timestamp: number;
}

export interface Order {
  id: string;
  clientOrderId: string;
  accountId: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  volume: number;
  requestedPrice: number;
  executionPrice: number;
  stopLoss?: number;
  takeProfit?: number;
  status: OrderStatus;
  rejectReason?: string;
  createdAt: number;
  executedAt?: number;
}

export interface OrderRequest {
  accountId?: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  volume: number;
  requestedPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  clientOrderId?: string;
}

export interface CancelOrderRequest {
  orderId: string;
  clientOrderId?: string;
}

export interface ReplaceOrderRequest {
  orderId: string;
  requestedPrice?: number;
  volume?: number;
  stopLoss?: number;
  takeProfit?: number;
  clientOrderId?: string;
}

export interface OrderResult {
  success: boolean;
  order: Order;
  position?: Position;
  execution?: Execution;
  error?: string;
}

export type PositionStatus = 'OPEN' | 'CLOSED';

export interface Position {
  id: string;
  accountId: string;
  symbol: string;
  side: OrderSide;
  volume: number;
  openPrice: number;
  currentPrice: number;
  unrealizedPnL: number;
  realizedPnL: number;
  stopLoss?: number;
  takeProfit?: number;
  marginLocked: number;
  openedAt: number;
  closedAt?: number;
  status: PositionStatus;
}

export type SessionMode = 'DEMO' | 'EXTERNAL' | 'TRADING_ACCOUNT';

export interface ExternalSessionTokenPayload {
  iss: string;                 // Issuer (e.g. 'crm-backend')
  sub: string;                 // Client/User ID in CRM (e.g. 'client_58392')
  aud: string;                 // Audience (e.g. 'trading-terminal')
  accountId: string;           // Authoritative Account ID (e.g. 'acc_crm_57775' or '57775')
  accountNumber: string;       // Human-readable (e.g. '57775')
  tenantId: string;            // Tenant / Broker ID (e.g. 'tenant_default')
  platform?: 'MT5' | 'MT4' | 'PROPRIETARY';
  currency?: string;           // Default 'USD'
  accountType?: 'DEMO' | 'LIVE';
  leverage?: number;           // e.g. 100
  initialBalance?: number;     // e.g. 0.00
  balance?: number;            // Explicit current balance if provided
  iat: number;                 // Issued at (seconds)
  exp: number;                 // Expiration timestamp (seconds)
}

export interface TradingAccount {
  id: string;
  tenantId: string;
  accountNumber: string;
  currency: string;
  accountType: 'DEMO' | 'LIVE';
  leverage: number;            // e.g. 100 for 1:100
  balance: number;             // Realized cash balance
  equity: number;              // balance + unrealizedPnL
  usedMargin: number;          // Total margin locked across all open positions
  freeMargin: number;          // equity - usedMargin
  marginLevel: number;         // (equity / usedMargin) * 100, 0 if usedMargin is 0
  marginCallLevel: number;     // e.g. 100%
  stopOutLevel: number;        // e.g. 50%
  status: 'ACTIVE' | 'READ_ONLY' | 'SUSPENDED' | 'DISABLED';
  tradingEnabled?: boolean;    // Explicit Admin control over trading permission
  maxOrderVolume?: number;    // Account-level max volume per single order
  maxPositionVolume?: number; // Account-level max aggregate open volume
  clientId?: string | null;   // External CRM Client ID (null for standalone accounts)
  platform?: 'MT5' | 'MT4' | 'PROPRIETARY';
  sessionMode?: SessionMode;   // 'DEMO', 'EXTERNAL', or 'TRADING_ACCOUNT'
  tradingPassword?: string;
  passwordHash?: string;
}

export type LedgerEntryType = 'DEPOSIT' | 'WITHDRAWAL' | 'TRADE_PNL' | 'SWAP' | 'COMMISSION';

export interface LedgerEntry {
  id: string;
  accountId: string;
  type: LedgerEntryType;
  amount: number;
  balanceAfter: number;
  referenceId?: string;
  description: string;
  createdAt: number;
}

export interface OHLCVBar {
  time: number; // Unix timestamp in seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface RiskState {
  isMarginCall: boolean;
  isStopOut: boolean;
  maxAccountDrawdown: number;
  totalUnrealizedPnL: number;
}
