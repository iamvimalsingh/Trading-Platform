/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * CLIENT-FACING WEBSOCKET PROTOCOL DTO CONTRACTS
 * Network contract types for external clients (Web Terminal, Mobile App, CRM integrations).
 * External clients depend ONLY on this network protocol contract, never internal server classes.
 */

import {
  Execution,
  LedgerEntry,
  Order,
  OrderResult,
  Position,
  Quote,
  SessionMode,
  SymbolConfig,
  TradingAccount,
} from './trading';

export type WsMessageType =
  // Client -> Server
  | 'SESSION_INIT'
  | 'SUBSCRIBE_SYMBOLS'
  | 'UNSUBSCRIBE_SYMBOLS'
  | 'PLACE_ORDER'
  | 'CANCEL_ORDER'
  | 'REPLACE_ORDER'
  | 'MODIFY_POSITION'
  | 'CLOSE_POSITION'
  | 'PING'
  // Server -> Client
  | 'SESSION_READY'
  | 'QUOTE'
  | 'ACCOUNT_STATE'
  | 'ORDER_ACK'
  | 'ORDER_UPDATE'
  | 'EXECUTION'
  | 'POSITION_UPDATE'
  | 'POSITION_CLOSED'
  | 'ERROR'
  | 'PONG';

export interface WsEnvelope<T = unknown> {
  type: WsMessageType;
  requestId?: string;
  timestamp: number;
  payload: T;
}

// Client Payloads
export interface SessionInitPayload {
  mode?: SessionMode;          // 'DEMO' (default standalone), 'EXTERNAL' (CRM launch), or 'TRADING_ACCOUNT'
  token?: string;              // Signed external launch token (required for EXTERNAL mode)
  preferredAccountId?: string; // Optional: validated against token for EXTERNAL, or restricted to demo accounts for DEMO
  loginId?: string;            // Login ID / Account Number for TRADING_ACCOUNT mode
  password?: string;           // Trading password for TRADING_ACCOUNT mode
}

export interface SubscribeSymbolsPayload {
  symbols: string[];
}

export interface UnsubscribeSymbolsPayload {
  symbols: string[];
}

export interface PlaceOrderPayload {
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT' | 'STOP';
  volume: number;
  requestedPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  clientOrderId?: string;
}

export interface CancelOrderPayload {
  orderId: string;
  clientOrderId?: string;
}

export interface ReplaceOrderPayload {
  orderId: string;
  requestedPrice?: number;
  volume?: number;
  stopLoss?: number;
  takeProfit?: number;
  clientOrderId?: string;
}

export interface ModifyPositionPayload {
  positionId: string;
  stopLoss?: number;
  takeProfit?: number;
}

export interface ClosePositionPayload {
  positionId: string;
  volume?: number;
}

// Server Payloads
export interface SessionReadyPayload {
  connectionId: string;
  account: TradingAccount;
  symbols: SymbolConfig[];
  positions: Position[];
  orders: Order[];
  executions?: Execution[];
  ledger: LedgerEntry[];
  activeSymbols: string[];
}

export interface QuotePayload {
  quotes: Record<string, Quote>;
}

export interface AccountStatePayload {
  account: TradingAccount;
}

export interface OrderAckPayload extends OrderResult {}

export interface OrderUpdatePayload {
  order: Order;
}

export interface ExecutionPayload {
  execution: Execution;
}

export interface PositionUpdatePayload {
  position: Position;
}

export interface PositionClosedPayload {
  position: Position;
  ledgerEntry: LedgerEntry;
  execution?: Execution;
}

export interface ErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}
