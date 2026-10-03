/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * MARKET DATA ROUTER & GATEWAY (STEP 4)
 * Multi-provider routing engine coordinating Tiingo (Primary FX) and Twelve Data (Primary Metals & Crypto).
 * 
 * Invariants:
 * - Implements IMarketDataProvider for drop-in compatibility with TradingRuntime.
 * - Prioritizes primary provider per symbol mapping (Tiingo for FX, Twelve Data for Metals/Crypto).
 * - Automatic secondary fallback if primary provider disconnects or becomes stale.
 * - Prevents conflicting concurrent updates by enforcing router precedence.
 * - Stale watchdog detecting stalled ticks across all providers.
 * - US500 is cleanly marked unavailable without fake quote injection.
 * - Supports fallback to MarketEngine in development / unit testing when no real keys are provided.
 */

import { OHLCVBar, Quote, SymbolConfig } from '../types/trading';
import {
  IMarketDataProvider,
  MarketMetrics,
  ProviderConnectionState,
  QuoteBatchListener,
} from './IMarketDataProvider';
import { IMarketDataAdapter } from './IMarketDataAdapter';
import { NormalizedInternalQuote } from '../types/marketData';
import { getAllSymbolMappings, getSymbolMapping, SymbolMappingDefinition } from './SymbolMapping';
import { ALL_SYMBOLS } from './MarketEngine';
import { MarketEngine } from './MarketEngine';

export interface MarketDataRouterOptions {
  tiingoAdapter?: IMarketDataAdapter;
  twelveDataAdapter?: IMarketDataAdapter;
  simulatorFallback?: MarketEngine;
  isRealMarketData?: boolean;
  staleThresholdMs?: number;
}

export class MarketDataRouter implements IMarketDataProvider {
  public readonly providerName: string = 'MultiProviderMarketRouter';

  public readonly tiingoAdapter?: IMarketDataAdapter;
  public readonly twelveDataAdapter?: IMarketDataAdapter;
  public readonly simulatorFallback?: MarketEngine;
  public readonly isRealMarketData: boolean;

  private quotes: Map<string, Quote> = new Map();
  private internalQuotes: Map<string, NormalizedInternalQuote> = new Map();
  private quoteListeners: Set<QuoteBatchListener> = new Set();
  private isRunning: boolean = false;
  private staleTimer: NodeJS.Timeout | null = null;
  private readonly staleThresholdMs: number;
  private ticksReceivedCount: number = 0;
  private lastTickTimestamp: number = 0;

  constructor(options?: MarketDataRouterOptions) {
    this.tiingoAdapter = options?.tiingoAdapter;
    this.twelveDataAdapter = options?.twelveDataAdapter;
    this.simulatorFallback = options?.simulatorFallback;
    this.isRealMarketData = options?.isRealMarketData ?? (process.env.USE_REAL_MARKET_DATA === 'true');
    this.staleThresholdMs = options?.staleThresholdMs || 15000;

    // Register quote listeners for Tiingo
    if (this.tiingoAdapter) {
      if (typeof this.tiingoAdapter.onQuote === 'function') {
        this.tiingoAdapter.onQuote((quote: NormalizedInternalQuote) => {
          this.handleTiingoQuote(quote);
        });
      } else if (typeof (this.tiingoAdapter as any).subscribe === 'function') {
        (this.tiingoAdapter as any).subscribe((batch: Record<string, Quote>) => {
          this.handleTiingoBatch(batch);
        });
      }
    }

    // Register quote listeners for Twelve Data
    if (this.twelveDataAdapter) {
      this.twelveDataAdapter.onQuote((quote: NormalizedInternalQuote) => {
        this.handleTwelveDataQuote(quote);
      });
    }

    // Simulator fallback for dev/testing
    if (!this.isRealMarketData && this.simulatorFallback) {
      this.simulatorFallback.subscribe((batch: Record<string, Quote>) => {
        if (!this.isRealMarketData) {
          this.handleSimulatorBatch(batch);
        }
      });
    }
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    if (this.tiingoAdapter) {
      try {
        this.tiingoAdapter.start();
      } catch (err) {
        console.warn('[MarketDataRouter] Error starting Tiingo adapter:', err);
      }
    }

    if (this.twelveDataAdapter) {
      try {
        this.twelveDataAdapter.start();
      } catch (err) {
        console.warn('[MarketDataRouter] Error starting Twelve Data adapter:', err);
      }
    }

    if (!this.isRealMarketData && this.simulatorFallback) {
      this.simulatorFallback.start();
    }

    this.staleTimer = setInterval(() => {
      this.checkStale();
    }, 3000);
  }

  public stop(): void {
    this.isRunning = false;

    if (this.staleTimer) {
      clearInterval(this.staleTimer);
      this.staleTimer = null;
    }

    if (this.tiingoAdapter) {
      try {
        this.tiingoAdapter.stop();
      } catch {
        // ignore
      }
    }

    if (this.twelveDataAdapter) {
      try {
        this.twelveDataAdapter.stop();
      } catch {
        // ignore
      }
    }

    if (this.simulatorFallback) {
      try {
        this.simulatorFallback.stop();
      } catch {
        // ignore
      }
    }
  }

  public subscribe(listener: QuoteBatchListener): () => void {
    this.quoteListeners.add(listener);
    return () => this.quoteListeners.delete(listener);
  }

  public getQuote(symbol: string): Quote | undefined {
    return this.quotes.get(symbol.toUpperCase());
  }

  public getAllQuotes(): Record<string, Quote> {
    const res: Record<string, Quote> = {};
    for (const [sym, q] of this.quotes.entries()) {
      res[sym] = q;
    }
    return res;
  }

  public getActiveSymbols(): SymbolConfig[] {
    return ALL_SYMBOLS;
  }

  public getAllSymbols(): SymbolConfig[] {
    return ALL_SYMBOLS;
  }

  public getSymbolConfig(symbol: string): SymbolConfig | undefined {
    return ALL_SYMBOLS.find((s) => s.symbol === symbol.toUpperCase());
  }

  public getHistoricalBars(symbol: string, count: number = 50): OHLCVBar[] {
    if (this.simulatorFallback) {
      return this.simulatorFallback.getHistoricalBars(symbol, count);
    }
    return [];
  }

  public getMetrics(): MarketMetrics {
    return {
      ticksGeneratedCount: this.ticksReceivedCount,
      activeSymbolsCount: this.quotes.size,
      lastTickTimestamp: this.lastTickTimestamp,
      providerName: this.providerName,
      connectionState: this.isRunning ? 'CONNECTED' : 'DISCONNECTED',
      isStale: Date.now() - this.lastTickTimestamp > this.staleThresholdMs,
    };
  }

  public getConnectionState(): ProviderConnectionState {
    return {
      status: this.isRunning ? 'CONNECTED' : 'DISCONNECTED',
      isStale: Date.now() - this.lastTickTimestamp > this.staleThresholdMs,
      lastTickAt: this.lastTickTimestamp,
      reconnectAttempts: 0,
    };
  }

  public isQuoteStale(symbol: string): boolean {
    const q = this.quotes.get(symbol.toUpperCase());
    if (!q) return true;
    if (q.marketStatus === 'STALE') return true;
    return Date.now() - q.timestamp > this.staleThresholdMs;
  }

  public generateTickBatch(): Record<string, Quote> {
    return this.getAllQuotes();
  }

  // --- Quote Routing & Arbitration ---

  private handleTiingoBatch(batch: Record<string, Quote>): void {
    const routedBatch: Record<string, Quote> = {};
    const now = Date.now();

    for (const [sym, quote] of Object.entries(batch)) {
      const canonical = sym.toUpperCase();
      const mapping = getSymbolMapping(canonical);

      // Precedence Rule 1: Tiingo is authoritative for symbols where it is primary (all FX majors)
      if (!mapping || mapping.primaryProvider === 'tiingo_fx') {
        const enrichedQuote: Quote = {
          ...quote,
          symbol: canonical,
          marketStatus: 'LIVE',
          source: 'tiingo_fx',
        };
        this.quotes.set(canonical, enrichedQuote);
        routedBatch[canonical] = enrichedQuote;
        this.ticksReceivedCount++;
        this.lastTickTimestamp = now;
      }
    }

    if (Object.keys(routedBatch).length > 0) {
      this.dispatch(routedBatch);
    }
  }

  private handleTiingoQuote(raw: NormalizedInternalQuote): void {
    const canonical = raw.symbol.toUpperCase();
    const mapping = getSymbolMapping(canonical);
    const now = Date.now();

    if (!mapping || mapping.primaryProvider === 'tiingo_fx') {
      const quote: Quote = {
        symbol: canonical,
        bid: raw.bid,
        ask: raw.ask,
        mid: raw.mid,
        spread: raw.spread,
        timestamp: raw.timestamp,
        tickDirection: raw.tickDirection || 'FLAT',
        high24h: raw.high24h,
        low24h: raw.low24h,
        change24h: raw.change24h,
        change24hPct: raw.change24hPct,
        marketStatus: raw.marketStatus || 'LIVE',
        source: 'tiingo_fx',
      };
      this.quotes.set(canonical, quote);
      this.internalQuotes.set(canonical, raw);
      this.ticksReceivedCount++;
      this.lastTickTimestamp = now;
      this.dispatch({ [canonical]: quote });
    }
  }

  private handleTwelveDataQuote(raw: NormalizedInternalQuote): void {
    const canonical = raw.symbol.toUpperCase();
    const mapping = getSymbolMapping(canonical);
    const now = Date.now();

    // Check precedence:
    // A. Twelve Data is primary for Metals (XAUUSD, XAGUSD) and Crypto (BTCUSD, ETHUSD)
    // B. Twelve Data acts as secondary for FX ONLY if Tiingo has not provided a live quote recently
    const isPrimaryTwelveData = mapping?.primaryProvider === 'twelve_data';
    const isSecondaryFallback = mapping?.secondaryProvider === 'twelve_data';
    const tiingoCurrentQuote = this.quotes.get(canonical);
    const tiingoIsActive = tiingoCurrentQuote && tiingoCurrentQuote.source === 'tiingo_fx' && (now - tiingoCurrentQuote.timestamp < this.staleThresholdMs);

    if (isPrimaryTwelveData || (isSecondaryFallback && !tiingoIsActive)) {
      const quote: Quote = {
        symbol: canonical,
        bid: raw.bid,
        ask: raw.ask,
        mid: raw.mid,
        spread: raw.spread,
        timestamp: raw.timestamp,
        tickDirection: raw.tickDirection || 'FLAT',
        high24h: raw.high24h,
        low24h: raw.low24h,
        change24h: raw.change24h,
        change24hPct: raw.change24hPct,
        marketStatus: raw.marketStatus || 'LIVE',
        source: 'twelve_data',
      };

      this.quotes.set(canonical, quote);
      this.internalQuotes.set(canonical, raw);
      this.ticksReceivedCount++;
      this.lastTickTimestamp = now;
      this.dispatch({ [canonical]: quote });
    }
  }

  private handleSimulatorBatch(batch: Record<string, Quote>): void {
    const routedBatch: Record<string, Quote> = {};
    for (const [sym, q] of Object.entries(batch)) {
      const canonical = sym.toUpperCase();
      // Only populate from simulator if no real provider has provided a quote
      if (!this.quotes.has(canonical)) {
        this.quotes.set(canonical, q);
        routedBatch[canonical] = q;
      }
    }
    if (Object.keys(routedBatch).length > 0) {
      this.dispatch(routedBatch);
    }
  }

  private dispatch(batch: Record<string, Quote>): void {
    for (const listener of this.quoteListeners) {
      try {
        listener(batch);
      } catch (err) {
        console.error('[MarketDataRouter] Listener dispatch error:', err);
      }
    }
  }

  private checkStale(): void {
    const now = Date.now();
    let hasStale = false;
    const staleBatch: Record<string, Quote> = {};

    for (const [sym, quote] of this.quotes.entries()) {
      if (quote.marketStatus === 'LIVE' && now - quote.timestamp > this.staleThresholdMs) {
        quote.marketStatus = 'STALE';
        staleBatch[sym] = { ...quote };
        hasStale = true;
      }
    }

    if (hasStale) {
      this.dispatch(staleBatch);
    }
  }
}
