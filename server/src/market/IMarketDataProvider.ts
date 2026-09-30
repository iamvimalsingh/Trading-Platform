/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * MARKET DATA PROVIDER INTERFACE
 * Decouples TradingRuntime from synthetic market simulation,
 * enabling seamless hot-swapping between MarketEngine and real-world feeds.
 */

import { OHLCVBar, Quote, SymbolConfig } from '../types/trading';

export type QuoteBatchListener = (quotes: Record<string, Quote>) => void;

export interface MarketMetrics {
  ticksGeneratedCount: number;
  activeSymbolsCount: number;
  intervalMs?: number;
  lastTickTimestamp: number;
  providerName?: string;
  connectionState?: string;
  isStale?: boolean;
}

export interface ProviderConnectionState {
  status: 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'RECONNECTING';
  isStale: boolean;
  lastTickAt: number;
  reconnectAttempts: number;
  url?: string;
}

export interface IMarketDataProvider {
  readonly providerName: string;
  start(): void;
  stop(): void;
  subscribe(listener: QuoteBatchListener): () => void;
  getQuote(symbol: string): Quote | undefined;
  getAllQuotes(): Record<string, Quote>;
  getActiveSymbols(): SymbolConfig[];
  getAllSymbols(): SymbolConfig[];
  getSymbolConfig(symbol: string): SymbolConfig | undefined;
  getHistoricalBars(symbol: string, count?: number): OHLCVBar[];
  getMetrics(): MarketMetrics;
  getConnectionState?(): ProviderConnectionState;
  isQuoteStale?(symbol: string): boolean;
  generateTickBatch(): Record<string, Quote>;
}
