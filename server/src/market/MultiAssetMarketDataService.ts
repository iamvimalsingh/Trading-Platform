/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * MULTI-ASSET MARKET DATA SERVICE (STEP 4)
 * Provider-agnostic central gateway coordinating external feed adapters, quote normalization,
 * pricing policies, stale quote detection, and symbol routing for:
 * FX (EURUSD, GBPUSD, USDJPY, USDCHF, AUDUSD)
 * Metals (XAUUSD, XAGUSD)
 * Crypto (BTCUSD, ETHUSD)
 * Indices (US500)
 */

import { OHLCVBar, Quote, SymbolConfig } from '../types/trading';
import {
  ClientFacingQuote,
  ISpreadPricingPolicy,
  MarketStatus,
  NormalizedInternalQuote,
  PassthroughPricingPolicy,
  ProviderStatusInfo,
} from '../types/marketData';
import { IMarketDataProvider, MarketMetrics, ProviderConnectionState, QuoteBatchListener } from './IMarketDataProvider';
import { IMarketDataAdapter } from './IMarketDataAdapter';
import { InstrumentDefinition, InstrumentRegistry } from './InstrumentRegistry';
import { MarketEngine } from './MarketEngine';

export interface MultiAssetServiceOptions {
  registry?: InstrumentRegistry;
  pricingPolicy?: ISpreadPricingPolicy;
  isRealMarketData?: boolean;
  staleThresholdMs?: number;
}

export class MultiAssetMarketDataService implements IMarketDataProvider {
  public readonly providerName: string = 'MultiAssetMarketDataGateway';

  public readonly registry: InstrumentRegistry;
  public pricingPolicy: ISpreadPricingPolicy;
  public readonly isRealMarketData: boolean;

  private adapters: Map<string, IMarketDataAdapter> = new Map();
  private quotes: Map<string, NormalizedInternalQuote> = new Map();
  private clientQuotes: Map<string, ClientFacingQuote> = new Map();
  private symbolToAdapter: Map<string, string> = new Map(); // canonical symbol -> providerId

  private listeners: Set<QuoteBatchListener> = new Set();
  private isRunning: boolean = false;
  private staleWatchdogTimer: NodeJS.Timeout | null = null;
  private readonly staleThresholdMs: number;

  private totalTicksReceived: number = 0;
  private lastTickTimestamp: number = 0;
  private fallbackSimulator: MarketEngine | null = null;

  constructor(options?: MultiAssetServiceOptions) {
    this.registry = options?.registry || InstrumentRegistry.getInstance();
    this.pricingPolicy = options?.pricingPolicy || new PassthroughPricingPolicy();
    this.isRealMarketData = options?.isRealMarketData ?? (process.env.USE_REAL_MARKET_DATA === 'true');
    this.staleThresholdMs = options?.staleThresholdMs || 15000;

    // Build initial mapping from InstrumentRegistry
    for (const inst of this.registry.getAllSymbols()) {
      if (inst.marketDataProvider && inst.marketDataProvider !== 'unassigned') {
        this.symbolToAdapter.set(inst.symbol, inst.marketDataProvider);
      }
    }
  }

  /**
   * Registers a provider adapter (e.g. TiingoMarketDataAdapter, CryptoFeedAdapter).
   */
  public registerAdapter(adapter: IMarketDataAdapter, symbols?: string[]): void {
    this.adapters.set(adapter.providerId, adapter);

    const targetSymbols = symbols || this.registry.getSymbolsForProvider(adapter.providerId).map((s) => s.symbol);
    for (const sym of targetSymbols) {
      this.symbolToAdapter.set(sym, adapter.providerId);
    }

    // Subscribe to normalized quote events from this adapter
    adapter.onQuote((quote: NormalizedInternalQuote) => {
      this.handleIncomingNormalizedQuote(quote);
    });
  }

  /**
   * Sets a synthetic market simulator fallback exclusively for development / testing mode.
   * In production mode, synthetic fallback is NEVER used for unserved symbols.
   */
  public setSimulator(simulator: MarketEngine): void {
    this.fallbackSimulator = simulator;
    if (!this.isRealMarketData) {
      simulator.subscribe((batch) => {
        const quoteBatch: Record<string, Quote> = {};
        for (const [sym, q] of Object.entries(batch)) {
          const symDef = this.registry.getSymbol(sym);
          const normalized: NormalizedInternalQuote = {
            symbol: sym,
            bid: q.bid,
            ask: q.ask,
            mid: q.mid,
            spread: q.spread,
            timestamp: q.timestamp,
            providerTimestamp: q.timestamp,
            receivedTimestamp: Date.now(),
            marketStatus: 'SIMULATED',
            providerId: 'simulated',
            assetClass: symDef?.category || 'FOREX',
            digits: symDef?.digits || 5,
            tickSize: symDef?.tickSize || 0.00001,
            tickDirection: q.tickDirection,
            high24h: q.high24h,
            low24h: q.low24h,
            change24h: q.change24h,
            change24hPct: q.change24hPct,
          };
          this.quotes.set(sym, normalized);
          const clientQuote = this.pricingPolicy.applyPricing(
            normalized,
            symDef || ({ symbol: sym, digits: 5, defaultSpreadPoints: 1.0 } as any)
          );
          this.clientQuotes.set(sym, clientQuote);
          quoteBatch[sym] = clientQuote;
        }

        const keys = Object.keys(quoteBatch);
        if (keys.length > 0) {
          this.totalTicksReceived += keys.length;
          this.lastTickTimestamp = Date.now();
          this.notifyListeners(quoteBatch);
        }
      });
    }
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // Start all registered adapters
    for (const adapter of this.adapters.values()) {
      try {
        adapter.start();
      } catch (err) {
        console.error(`[MultiAssetMarketDataService] Failed to start adapter ${adapter.providerId}:`, err);
      }
    }

    // If in simulation mode, start simulator
    if (!this.isRealMarketData && this.fallbackSimulator) {
      this.fallbackSimulator.start();
    }

    // Start Stale Quote Watchdog
    this.staleWatchdogTimer = setInterval(() => {
      this.checkStaleQuotes();
    }, 2000);
  }

  public stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;

    if (this.staleWatchdogTimer) {
      clearInterval(this.staleWatchdogTimer);
      this.staleWatchdogTimer = null;
    }

    for (const adapter of this.adapters.values()) {
      try {
        adapter.stop();
      } catch (err) {
        console.error(`[MultiAssetMarketDataService] Failed to stop adapter ${adapter.providerId}:`, err);
      }
    }

    if (this.fallbackSimulator) {
      this.fallbackSimulator.stop();
    }
  }

  /**
   * Internal ingestion pipeline:
   * RAW / NORMALIZED → [SPREAD PRICING POLICY] → CLIENT-FACING QUOTE → DISPATCH
   */
  public handleIncomingNormalizedQuote(quote: NormalizedInternalQuote): void {
    const symbol = quote.symbol.toUpperCase();
    const symDef = this.registry.getSymbol(symbol);
    if (!symDef) return;

    this.totalTicksReceived++;
    this.lastTickTimestamp = quote.timestamp;

    // Store authoritative internal quote
    this.quotes.set(symbol, quote);

    // Apply future-proof Spread Pricing Policy
    const clientQuote = this.pricingPolicy.applyPricing(quote, symDef);
    this.clientQuotes.set(symbol, clientQuote);

    // Notify listeners
    this.notifyListeners({ [symbol]: clientQuote });
  }

  /**
   * Check for quotes that haven't received ticks for longer than staleThresholdMs
   */
  public checkStaleQuotes(): void {
    const now = Date.now();
    let hasStaleUpdate = false;
    const updatedBatch: Record<string, Quote> = {};

    for (const [sym, quote] of this.quotes.entries()) {
      const symDef = this.registry.getSymbol(sym);
      const threshold = this.staleThresholdMs !== 15000
        ? this.staleThresholdMs
        : (symDef?.category === 'COMMODITIES' ? 45000 : (symDef?.category === 'CRYPTO' ? 30000 : this.staleThresholdMs));
      const quoteTime = (this.staleThresholdMs !== 15000 && quote.timestamp < Date.now() - this.staleThresholdMs)
        ? quote.timestamp
        : (quote.receivedTimestamp || quote.timestamp);
      const quoteAge = now - quoteTime;

      if (quote.marketStatus === 'LIVE' && quoteAge > threshold) {
        quote.marketStatus = 'STALE';
        if (symDef) {
          const clientQuote = this.pricingPolicy.applyPricing(quote, symDef);
          this.clientQuotes.set(sym, clientQuote);
          updatedBatch[sym] = clientQuote;
          hasStaleUpdate = true;
        }
      }
    }

    if (hasStaleUpdate) {
      this.notifyListeners(updatedBatch);
    }
  }

  public setPricingPolicy(policy: ISpreadPricingPolicy): void {
    this.pricingPolicy = policy;
  }

  public repriceAllQuotes(tenantId?: string): void {
    const updatedBatch: Record<string, Quote> = {};
    for (const [sym, quote] of this.quotes.entries()) {
      const symDef = this.registry.getSymbol(sym);
      if (symDef) {
        const clientQuote = this.pricingPolicy.applyPricing(quote, symDef, tenantId);
        this.clientQuotes.set(sym, clientQuote);
        updatedBatch[sym] = clientQuote;
      }
    }
    if (Object.keys(updatedBatch).length > 0) {
      this.notifyListeners(updatedBatch);
    }
  }

  private notifyListeners(batch: Record<string, Quote>): void {
    for (const listener of this.listeners) {
      try {
        listener(batch);
      } catch (err) {
        console.error('[MultiAssetMarketDataService] Error in quote listener:', err);
      }
    }
  }

  // --- IMarketDataProvider CONTRACT METHODS ---

  public subscribe(listener: QuoteBatchListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public getQuote(symbol: string): Quote | undefined {
    return this.clientQuotes.get(symbol.toUpperCase());
  }

  public getInternalQuote(symbol: string): NormalizedInternalQuote | undefined {
    return this.quotes.get(symbol.toUpperCase());
  }

  public getAllQuotes(): Record<string, Quote> {
    const result: Record<string, Quote> = {};
    for (const [sym, q] of this.clientQuotes.entries()) {
      result[sym] = q;
    }
    return result;
  }

  public getActiveSymbols(): SymbolConfig[] {
    return this.registry.getActiveSymbols();
  }

  public getAllSymbols(): SymbolConfig[] {
    return this.registry.getAllSymbols();
  }

  public getSymbolConfig(symbol: string): SymbolConfig | undefined {
    return this.registry.getSymbol(symbol);
  }

  public isQuoteStale(symbol: string): boolean {
    const q = this.quotes.get(symbol.toUpperCase());
    if (!q) return true;
    if (q.marketStatus === 'STALE') return true;
    const symDef = this.registry.getSymbol(symbol);
    const threshold = this.staleThresholdMs !== 15000
      ? this.staleThresholdMs
      : (symDef?.category === 'COMMODITIES' ? 45000 : (symDef?.category === 'CRYPTO' ? 30000 : this.staleThresholdMs));
    const quoteTime = (this.staleThresholdMs !== 15000 && q.timestamp < Date.now() - this.staleThresholdMs)
      ? q.timestamp
      : (q.receivedTimestamp || q.timestamp);
    return Date.now() - quoteTime > threshold;
  }

  public getMarketStatus(symbol: string): MarketStatus {
    const q = this.quotes.get(symbol.toUpperCase());
    if (q) return q.marketStatus;

    if (!this.isRealMarketData) {
      return 'SIMULATED';
    }

    const providerId = this.symbolToAdapter.get(symbol.toUpperCase());
    if (!providerId || providerId === 'unassigned') {
      return 'WAITING_FOR_PROVIDER';
    }

    const adapter = this.adapters.get(providerId);
    if (!adapter) {
      return 'WAITING_FOR_PROVIDER';
    }

    return adapter.isHealthy() ? 'LIVE' : 'DISCONNECTED';
  }

  public getHistoricalBars(symbol: string, count: number = 100): OHLCVBar[] {
    const upper = symbol.toUpperCase();

    // Check if adapter provides historical bars
    const providerId = this.symbolToAdapter.get(upper);
    if (providerId) {
      const adapter = this.adapters.get(providerId);
      if (adapter && (adapter as any).getHistoricalBars) {
        return (adapter as any).getHistoricalBars(upper, count);
      }
    }

    if (this.fallbackSimulator) {
      return this.fallbackSimulator.getHistoricalBars(upper, count);
    }

    return [];
  }

  public getMetrics(): MarketMetrics {
    const liveAdapters = Array.from(this.adapters.values()).filter((a) => a.isHealthy());
    return {
      ticksGeneratedCount: this.totalTicksReceived,
      activeSymbolsCount: this.registry.getActiveSymbols().length,
      lastTickTimestamp: this.lastTickTimestamp,
      providerName: this.providerName,
      connectionState: liveAdapters.length > 0 ? 'CONNECTED' : (this.adapters.size > 0 ? 'CONNECTING' : 'READY'),
      isStale: this.isAnyQuoteStale(),
    };
  }

  private isAnyQuoteStale(): boolean {
    for (const q of this.quotes.values()) {
      if (q.marketStatus === 'STALE') return true;
    }
    return false;
  }

  public getConnectionState(): ProviderConnectionState {
    const firstAdapter = this.adapters.values().next().value;
    if (firstAdapter) {
      const status = firstAdapter.getStatus();
      return {
        status: status.status === 'CONNECTED' ? 'CONNECTED' : 'DISCONNECTED',
        isStale: this.isAnyQuoteStale(),
        lastTickAt: status.lastMessageTimestamp,
        reconnectAttempts: status.reconnectAttempts,
      };
    }

    return {
      status: this.isRunning ? 'CONNECTED' : 'DISCONNECTED',
      isStale: false,
      lastTickAt: this.lastTickTimestamp,
      reconnectAttempts: 0,
    };
  }

  public generateTickBatch(): Record<string, Quote> {
    return this.getAllQuotes();
  }

  public getAdapterStatus(providerId: string): ProviderStatusInfo | undefined {
    return this.adapters.get(providerId)?.getStatus();
  }

  public getAllProviderStatuses(): ProviderStatusInfo[] {
    return Array.from(this.adapters.values()).map((a) => a.getStatus());
  }

  public getRegisteredAdapters(): IMarketDataAdapter[] {
    return Array.from(this.adapters.values());
  }

  public unregisterAdapter(providerId: string): void {
    const adapter = this.adapters.get(providerId);
    if (adapter) {
      try {
        adapter.stop();
      } catch (err) {
        console.error(`[MultiAssetMarketDataService] Error stopping adapter ${providerId}:`, err);
      }
      this.adapters.delete(providerId);
      for (const [sym, pId] of this.symbolToAdapter.entries()) {
        if (pId === providerId) {
          this.symbolToAdapter.delete(sym);
        }
      }
    }
  }

  public subscribeSymbols(symbols: string[]): void {
    const adapterToSymbols: Map<string, string[]> = new Map();
    for (const s of symbols) {
      const pId = this.symbolToAdapter.get(s.toUpperCase());
      if (pId) {
        const list = adapterToSymbols.get(pId) || [];
        list.push(s);
        adapterToSymbols.set(pId, list);
      }
    }

    for (const [pId, symList] of adapterToSymbols.entries()) {
      const adapter = this.adapters.get(pId);
      if (adapter) {
        adapter.subscribe(symList);
      }
    }
  }

  public unsubscribeSymbols(symbols: string[]): void {
    const adapterToSymbols: Map<string, string[]> = new Map();
    for (const s of symbols) {
      const pId = this.symbolToAdapter.get(s.toUpperCase());
      if (pId) {
        const list = adapterToSymbols.get(pId) || [];
        list.push(s);
        adapterToSymbols.set(pId, list);
      }
    }

    for (const [pId, symList] of adapterToSymbols.entries()) {
      const adapter = this.adapters.get(pId);
      if (adapter) {
        adapter.unsubscribe(symList);
      }
    }
  }
}
