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
import { ALL_SYMBOLS, BASE_PRICES } from './MarketEngine';
import { MarketEngine } from './MarketEngine';

export interface CategoryStaleThresholds {
  FOREX?: number;
  CRYPTO?: number;
  COMMODITIES?: number;
  DEFAULT?: number;
}

export interface MarketDataRouterOptions {
  tiingoAdapter?: IMarketDataAdapter;
  twelveDataAdapter?: IMarketDataAdapter;
  simulatorFallback?: MarketEngine;
  isRealMarketData?: boolean;
  staleThresholdMs?: number;
  categoryStaleThresholds?: CategoryStaleThresholds;
}

export function isFxMarketClosed(timestamp: number): boolean {
  const d = new Date(timestamp);
  const day = d.getUTCDay(); // 0 = Sun, 5 = Fri, 6 = Sat
  const hour = d.getUTCHours();
  if (day === 6) return true; // Saturday all day
  if (day === 0 && hour < 21) return true; // Sunday before 21:00 UTC
  if (day === 5 && hour >= 21) return true; // Friday from 21:00 UTC onwards
  return false;
}

export function isCommodityMarketClosed(timestamp: number): boolean {
  const d = new Date(timestamp);
  const day = d.getUTCDay(); // 0 = Sun, 5 = Fri, 6 = Sat
  const hour = d.getUTCHours();
  if (day === 6) return true; // Saturday all day
  if (day === 0 && hour < 22) return true; // Sunday before 22:00 UTC
  if (day === 5 && hour >= 21) return true; // Friday from 21:00 UTC onwards
  return false;
}

export function isMarketSessionClosed(category: string, timestamp: number): boolean {
  const cat = category.toUpperCase();
  if (cat === 'FOREX') return isFxMarketClosed(timestamp);
  if (cat === 'COMMODITIES' || cat === 'METALS') return isCommodityMarketClosed(timestamp);
  if (cat === 'CRYPTO') return false; // 24/7/365 continuous trading
  return false;
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
  private readonly categoryStaleThresholds: CategoryStaleThresholds;
  private ticksReceivedCount: number = 0;
  private lastTickTimestamp: number = 0;

  constructor(options?: MarketDataRouterOptions) {
    this.tiingoAdapter = options?.tiingoAdapter;
    this.twelveDataAdapter = options?.twelveDataAdapter;
    this.simulatorFallback = options?.simulatorFallback;
    this.isRealMarketData = options?.isRealMarketData ?? (process.env.USE_REAL_MARKET_DATA === 'true');
    this.staleThresholdMs = options?.staleThresholdMs || 15000;
    this.categoryStaleThresholds = {
      FOREX: options?.categoryStaleThresholds?.FOREX ?? 15000,
      CRYPTO: options?.categoryStaleThresholds?.CRYPTO ?? 30000,
      COMMODITIES: options?.categoryStaleThresholds?.COMMODITIES ?? 45000, // 3x 15s REST polling cadence
      DEFAULT: options?.categoryStaleThresholds?.DEFAULT ?? this.staleThresholdMs,
    };

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

  public getEnrichedQuote(symbol: string, now = Date.now()): Quote | undefined {
    const canonical = symbol.toUpperCase();
    const rawQuote = this.quotes.get(canonical);
    const symCfg = this.getSymbolConfig(canonical);
    const category = symCfg?.category?.toUpperCase() || 'FOREX';
    const mapping = getSymbolMapping(canonical);

    // 1. Check provider connection / availability
    const isConnected = this.isRunning;
    if (!isConnected) {
      if (rawQuote) {
        return { ...rawQuote, marketStatus: 'UNAVAILABLE' };
      }
      return {
        symbol: canonical,
        bid: 0,
        ask: 0,
        mid: 0,
        spread: 0,
        high24h: 0,
        low24h: 0,
        change24h: 0,
        change24hPct: 0,
        timestamp: now,
        receivedTimestamp: now,
        tickDirection: 'FLAT',
        marketStatus: 'UNAVAILABLE',
        source: 'system',
      };
    }

    // 2. Check if market session is legitimately closed (weekend schedule for FOREX & COMMODITIES)
    const closed = isMarketSessionClosed(category, now);
    if (closed) {
      if (rawQuote && rawQuote.bid > 0 && rawQuote.ask > 0) {
        return { ...rawQuote, marketStatus: 'CLOSED' };
      }
      const base = BASE_PRICES[canonical];
      const digits = symCfg?.digits ?? 2;
      const spreadPoints = mapping?.defaultSpreadPoints ?? 4.0;
      const halfSpread = (spreadPoints * Math.pow(10, -digits)) / 2;
      const mid = base ? base.price : (rawQuote?.mid || 0);
      const bid = mid > 0 ? Number((mid - halfSpread).toFixed(digits)) : 0;
      const ask = mid > 0 ? Number((mid + halfSpread).toFixed(digits)) : 0;
      const spread = Number((ask - bid).toFixed(digits));

      return {
        symbol: canonical,
        bid,
        ask,
        mid,
        spread,
        high24h: ask,
        low24h: bid,
        change24h: 0,
        change24hPct: 0,
        timestamp: now,
        receivedTimestamp: now,
        tickDirection: 'FLAT',
        marketStatus: 'CLOSED',
        source: rawQuote?.source || 'system',
      };
    }

    // 3. Market is open, but no quote received yet
    if (!rawQuote || rawQuote.bid <= 0 || rawQuote.ask <= 0) {
      const isUnavailable = mapping && !mapping.isAvailableOnStandardTier;
      const status = isUnavailable ? 'UNAVAILABLE' : 'WAITING_FOR_PROVIDER';
      const base = BASE_PRICES[canonical];
      const digits = symCfg?.digits ?? 2;
      const spreadPoints = mapping?.defaultSpreadPoints ?? 4.0;
      const halfSpread = (spreadPoints * Math.pow(10, -digits)) / 2;
      const mid = base ? base.price : 0;
      const bid = mid > 0 ? Number((mid - halfSpread).toFixed(digits)) : 0;
      const ask = mid > 0 ? Number((mid + halfSpread).toFixed(digits)) : 0;
      const spread = Number((ask - bid).toFixed(digits));

      return {
        symbol: canonical,
        bid,
        ask,
        mid,
        spread,
        high24h: ask,
        low24h: bid,
        change24h: 0,
        change24hPct: 0,
        timestamp: now,
        receivedTimestamp: now,
        tickDirection: 'FLAT',
        marketStatus: status,
        source: 'system',
      };
    }

    // 4. Market is open and quote exists: check freshness
    const threshold = this.getStaleThresholdForSymbol(canonical);
    const quoteTime = rawQuote.receivedTimestamp || rawQuote.timestamp;
    const isStale = now - quoteTime > threshold;
    const marketStatus = isStale ? 'STALE' : 'LIVE';

    return {
      ...rawQuote,
      marketStatus,
    };
  }

  public getQuote(symbol: string): Quote | undefined {
    return this.getEnrichedQuote(symbol, Date.now());
  }

  public getAllQuotes(): Record<string, Quote> {
    const res: Record<string, Quote> = {};
    const now = Date.now();
    for (const symCfg of ALL_SYMBOLS) {
      const q = this.getEnrichedQuote(symCfg.symbol, now);
      if (q) {
        res[symCfg.symbol] = q;
      }
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

  public getStaleThresholdForSymbol(symbol: string): number {
    const symCfg = this.getSymbolConfig(symbol);
    const cat = symCfg?.category?.toUpperCase();
    if (cat === 'FOREX') return this.categoryStaleThresholds.FOREX ?? 15000;
    if (cat === 'CRYPTO') return this.categoryStaleThresholds.CRYPTO ?? 30000;
    if (cat === 'COMMODITIES' || cat === 'METALS') return this.categoryStaleThresholds.COMMODITIES ?? 45000;
    return this.categoryStaleThresholds.DEFAULT ?? this.staleThresholdMs;
  }

  public isQuoteStale(symbol: string): boolean {
    const q = this.quotes.get(symbol.toUpperCase());
    if (!q) return true;
    if (q.marketStatus === 'STALE') return true;
    const threshold = this.getStaleThresholdForSymbol(symbol);
    const quoteTime = q.receivedTimestamp || q.timestamp;
    return Date.now() - quoteTime > threshold;
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
      const category = mapping?.category || 'FOREX';
      const isClosed = isMarketSessionClosed(category, now);

      if (!mapping || mapping.primaryProvider === 'tiingo_fx' || mapping.secondaryProvider === 'tiingo_fx') {
        const enrichedQuote: Quote = {
          ...quote,
          symbol: canonical,
          marketStatus: isClosed ? 'CLOSED' : 'LIVE',
          source: 'tiingo_fx',
          receivedTimestamp: now,
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
    const category = mapping?.category || 'FOREX';
    const now = Date.now();
    const isClosed = isMarketSessionClosed(category, now);

    if (!mapping || mapping.primaryProvider === 'tiingo_fx' || mapping.secondaryProvider === 'tiingo_fx') {
      const quote: Quote = {
        symbol: canonical,
        bid: raw.bid,
        ask: raw.ask,
        mid: raw.mid,
        spread: raw.spread,
        timestamp: raw.timestamp,
        receivedTimestamp: now,
        tickDirection: raw.tickDirection || 'FLAT',
        high24h: raw.high24h,
        low24h: raw.low24h,
        change24h: raw.change24h,
        change24hPct: raw.change24hPct,
        marketStatus: isClosed ? 'CLOSED' : (raw.marketStatus || 'LIVE'),
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
    const category = mapping?.category || 'FOREX';
    const now = Date.now();
    const isClosed = isMarketSessionClosed(category, now);

    const isPrimaryTwelveData = mapping?.primaryProvider === 'twelve_data';
    const isSecondaryFallback = mapping?.secondaryProvider === 'twelve_data';
    const tiingoCurrentQuote = this.quotes.get(canonical);
    const staleLimit = this.getStaleThresholdForSymbol(canonical);
    const tiingoIsActive = tiingoCurrentQuote && tiingoCurrentQuote.source === 'tiingo_fx' && (now - (tiingoCurrentQuote.receivedTimestamp || tiingoCurrentQuote.timestamp) < staleLimit);

    if (isPrimaryTwelveData || (isSecondaryFallback && !tiingoIsActive)) {
      const quote: Quote = {
        symbol: canonical,
        bid: raw.bid,
        ask: raw.ask,
        mid: raw.mid,
        spread: raw.spread,
        timestamp: raw.timestamp,
        receivedTimestamp: now,
        tickDirection: raw.tickDirection || 'FLAT',
        high24h: raw.high24h,
        low24h: raw.low24h,
        change24h: raw.change24h,
        change24hPct: raw.change24hPct,
        marketStatus: isClosed ? 'CLOSED' : (raw.marketStatus || 'LIVE'),
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
    const batchToDispatch: Record<string, Quote> = {};

    for (const symCfg of ALL_SYMBOLS) {
      const sym = symCfg.symbol;
      const currentStored = this.quotes.get(sym);
      const enriched = this.getEnrichedQuote(sym, now);
      if (!enriched) continue;

      const prevStatus = currentStored?.marketStatus;
      if (prevStatus !== enriched.marketStatus) {
        this.quotes.set(sym, enriched);
        batchToDispatch[sym] = enriched;
      }
    }

    if (Object.keys(batchToDispatch).length > 0) {
      this.dispatch(batchToDispatch);
    }
  }
}
