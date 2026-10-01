/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * STEP 4 — MULTI-ASSET MARKET DATA CONTRACTS & NORMALIZATION MODELS
 * 
 * Establishes a clean, provider-agnostic market data pipeline:
 * RAW PROVIDER QUOTE → NORMALIZATION → [FUTURE PRICING / SPREAD POLICY] → CLIENT QUOTE
 */

import { AssetCategory, Quote, SymbolConfig } from './trading';

/**
 * Server-authoritative market data and provider statuses.
 * Explicitly distinguishes healthy real data from stale, disconnected, or simulated feeds.
 */
export type MarketStatus =
  | 'OPEN'
  | 'LIVE'
  | 'STALE'
  | 'CLOSED'
  | 'DISCONNECTED'
  | 'UNAVAILABLE'
  | 'WAITING_FOR_PROVIDER'
  | 'SIMULATED';

/**
 * A) RAW PROVIDER QUOTE
 * Generic envelope capturing unadulterated quote payloads direct from external feeds (e.g. Tiingo, LPs).
 */
export interface RawProviderQuote {
  providerId: string;
  rawSymbol: string;
  bidPrice: number;
  askPrice: number;
  bidSize?: number;
  askSize?: number;
  providerTimestamp?: number;
  receivedTimestamp: number;
  rawPayload?: unknown;
}

/**
 * B) NORMALIZED INTERNAL QUOTE
 * Canonical internal market data representation used by Trading Engine, Risk Engine, and Chart Aggregation.
 * Decoupled from provider-specific quirks and formats.
 */
export interface NormalizedInternalQuote {
  symbol: string;             // Canonical terminal symbol (e.g. 'EURUSD', 'XAUUSD', 'BTCUSD')
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  timestamp: number;          // Epoch milliseconds
  providerTimestamp?: number; // Upstream provider timestamp if provided
  receivedTimestamp: number;  // Local server arrival timestamp
  marketStatus: MarketStatus;
  providerId: string;         // e.g. 'tiingo_fx', 'synthetic_sim', 'unassigned'
  sequence?: number;
  assetClass: AssetCategory;
  digits: number;             // Decimal precision from InstrumentRegistry
  tickSize: number;           // Minimum price movement
  tickDirection?: 'UP' | 'DOWN' | 'FLAT';
  high24h: number;
  low24h: number;
  change24h: number;
  change24hPct: number;
}

/**
 * C) CLIENT-FACING QUOTE
 * Client-facing quote delivered over WebSocket to Trading Terminal.
 * Backward-compatible superset of the legacy Quote interface.
 */
export interface ClientFacingQuote extends Quote {
  marketStatus?: MarketStatus;
  source?: string;
  providerTimestamp?: number;
  receivedTimestamp?: number;
  digits?: number;
  tickSize?: number;
  sequence?: number;
}

/**
 * FUTURE SPREAD-PRICING BOUNDARY (STEP 5 PREPARATION)
 * Clean architectural interface allowing future Step 5 Admin Pair-Wise Spreads
 * without altering or refactoring the normalization or trading engine layers.
 */
export interface ISpreadPricingPolicy {
  readonly policyName: string;
  applyPricing(
    quote: NormalizedInternalQuote,
    symbolCfg: SymbolConfig,
    tenantId?: string
  ): ClientFacingQuote;
}

/**
 * Default Passthrough Pricing Policy:
 * Identity mapping preserving raw normalized provider spread until Step 5.
 */
export class PassthroughPricingPolicy implements ISpreadPricingPolicy {
  public readonly policyName: string = 'PassthroughPolicy';

  public applyPricing(
    quote: NormalizedInternalQuote,
    _symbolCfg: SymbolConfig,
    _tenantId?: string
  ): ClientFacingQuote {
    return {
      symbol: quote.symbol,
      bid: quote.bid,
      ask: quote.ask,
      spread: quote.spread,
      mid: quote.mid,
      high24h: quote.high24h,
      low24h: quote.low24h,
      change24h: quote.change24h,
      change24hPct: quote.change24hPct,
      timestamp: quote.timestamp,
      tickDirection: quote.tickDirection,
      marketStatus: quote.marketStatus,
      source: quote.providerId,
      providerTimestamp: quote.providerTimestamp,
      receivedTimestamp: quote.receivedTimestamp,
      digits: quote.digits,
      tickSize: quote.tickSize,
      sequence: quote.sequence,
    };
  }
}

/**
 * Provider Status & Health Metrics
 */
export interface ProviderStatusInfo {
  providerId: string;
  providerName: string;
  status: 'CONNECTED' | 'CONNECTING' | 'RECONNECTING' | 'DISCONNECTED' | 'DEGRADED';
  supportedSymbols: string[];
  lastMessageTimestamp: number;
  reconnectAttempts: number;
  isHealthy: boolean;
}

// =============================================================================
// STEP 6: HISTORICAL MARKET DATA CONTRACTS & NORMALIZED MODELS
// =============================================================================

export type HistoricalTimeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d';

export const HISTORICAL_TIMEFRAME_SECONDS: Record<HistoricalTimeframe, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
};

/**
 * Canonical normalized historical candle bar.
 * Strict time-boundary aligned and precision-rounded.
 */
export interface NormalizedHistoricalBar {
  symbol: string;
  timeframe: HistoricalTimeframe;
  timestamp: number; // Unix timestamp in seconds aligned to timeframe boundary
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  source: 'REAL' | 'SIMULATED' | 'PROVIDER';
  providerId: string;
}

export interface HistoricalDataRequest {
  symbol: string;
  timeframe: HistoricalTimeframe;
  from?: number; // Unix timestamp in seconds
  to?: number;   // Unix timestamp in seconds
  limit?: number; // Maximum number of bars requested (default: 120, max: 1000)
}

export interface HistoricalDataResponse {
  symbol: string;
  timeframe: HistoricalTimeframe;
  status: 'SUCCESS' | 'UNAVAILABLE' | 'SIMULATED';
  providerId: string;
  count: number;
  bars: NormalizedHistoricalBar[];
  error?: string;
}

