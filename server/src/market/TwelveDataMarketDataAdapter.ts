/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * TWELVE DATA SECONDARY MARKET DATA ADAPTER (STEP 4)
 * Server-authoritative WebSocket streaming and REST initial-seeding adapter
 * for non-FX instruments (Metals: XAUUSD, XAGUSD, Crypto: BTCUSD, ETHUSD)
 * and secondary FX fallback.
 * 
 * Rules:
 * - Server-side only. Never expose TWELVE_DATA_API_KEY to browser.
 * - Optional and fails safely if key is not configured.
 * - Single bounded WebSocket connection with automatic exponential reconnect.
 * - Normalizes quotes to platform canonical format (e.g. BTC/USD -> BTCUSD).
 * - Rest initial quote seed with bounded timeout/backoff.
 * - Unsupported symbols (e.g. US500 on standard plan) are NOT subscribed.
 */

import { WebSocket } from 'ws';
import { IMarketDataAdapter, QuoteListener } from './IMarketDataAdapter';
import { NormalizedInternalQuote, ProviderStatusInfo } from '../types/marketData';
import { getCanonicalFromTwelveData, getSymbolMapping, SymbolMappingDefinition } from './SymbolMapping';
import { InstrumentRegistry } from './InstrumentRegistry';

export interface TwelveDataAdapterOptions {
  apiKey?: string;
  wsUrl?: string;
  restBaseUrl?: string;
  symbols?: string[]; // Canonical symbols, e.g. ['BTCUSD', 'ETHUSD', 'XAUUSD', 'XAGUSD']
  autoStart?: boolean;
  staleThresholdMs?: number;
  initialReconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
}

export interface RawTwelveDataPriceEvent {
  event: 'price' | 'heartbeat' | 'subscribe-status' | 'error';
  symbol?: string; // e.g. 'BTC/USD'
  currency_base?: string;
  currency_quote?: string;
  exchange?: string;
  type?: string;
  timestamp?: number; // Unix timestamp in seconds
  price?: number;
  bid?: number;
  ask?: number;
  day_volume?: number;
  status?: string;
  message?: string;
}

export class TwelveDataMarketDataAdapter implements IMarketDataAdapter {
  public readonly providerId: string = 'twelve_data';
  public readonly providerName: string = 'TwelveDataLiveFeed';

  private readonly apiKey: string;
  private readonly wsUrl: string;
  private readonly restBaseUrl: string;
  private readonly staleThresholdMs: number;
  private readonly initialReconnectDelayMs: number;
  private readonly maxReconnectDelayMs: number;

  private ws: WebSocket | null = null;
  private isRunning: boolean = false;
  private reconnectAttempts: number = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private staleWatchdogTimer: NodeJS.Timeout | null = null;
  private restSeedPerformed: boolean = false;

  private subscribedCanonicalSymbols: Set<string> = new Set();
  private quoteListeners: Set<QuoteListener> = new Set();
  private quotes: Map<string, NormalizedInternalQuote> = new Map();
  private status: 'CONNECTED' | 'CONNECTING' | 'RECONNECTING' | 'DISCONNECTED' | 'DEGRADED' = 'DISCONNECTED';
  private lastMessageTimestamp: number = 0;
  private ticksReceivedCount: number = 0;

  constructor(options?: TwelveDataAdapterOptions) {
    this.apiKey = (options?.apiKey || process.env.TWELVE_DATA_API_KEY || '').trim();
    this.wsUrl = options?.wsUrl || 'wss://ws.twelvedata.com/v1/quotes/price';
    this.restBaseUrl = options?.restBaseUrl || 'https://api.twelvedata.com';
    this.staleThresholdMs = options?.staleThresholdMs || 15000;
    this.initialReconnectDelayMs = options?.initialReconnectDelayMs || 1000;
    this.maxReconnectDelayMs = options?.maxReconnectDelayMs || 30000;

    // Default canonical symbols managed by Twelve Data
    const initialSymbols = options?.symbols || ['BTCUSD', 'ETHUSD', 'XAUUSD', 'XAGUSD'];
    for (const sym of initialSymbols) {
      const mapping = getSymbolMapping(sym);
      if (mapping && mapping.isAvailableOnStandardTier && mapping.twelveDataSymbol) {
        this.subscribedCanonicalSymbols.add(sym.toUpperCase());
      }
    }

    if (options?.autoStart) {
      this.start();
    }
  }

  public isKeyConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.length > 0);
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    if (!this.isKeyConfigured()) {
      console.log('[TwelveDataMarketDataAdapter] No TWELVE_DATA_API_KEY configured. Running in idle/standby mode.');
      this.status = 'DISCONNECTED';
      return;
    }

    // Trigger optional REST initial seed quote asynchronously
    this.seedInitialQuotesRest().catch(() => {});

    // Open WebSocket connection
    this.connectWebSocket();

    // Start stale watchdog
    this.staleWatchdogTimer = setInterval(() => {
      this.checkStale();
    }, 3000);
  }

  public stop(): void {
    this.isRunning = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.staleWatchdogTimer) {
      clearInterval(this.staleWatchdogTimer);
      this.staleWatchdogTimer = null;
    }

    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }

    this.status = 'DISCONNECTED';
  }

  public connect(): void {
    this.start();
  }

  public disconnect(): void {
    this.stop();
  }

  public subscribe(symbols: string[]): void {
    const toAdd: string[] = [];
    for (const sym of symbols) {
      const mapping = getSymbolMapping(sym);
      if (mapping && mapping.isAvailableOnStandardTier && mapping.twelveDataSymbol) {
        if (!this.subscribedCanonicalSymbols.has(sym.toUpperCase())) {
          this.subscribedCanonicalSymbols.add(sym.toUpperCase());
          toAdd.push(mapping.twelveDataSymbol);
        }
      }
    }

    if (toAdd.length > 0 && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendSubscriptionFrame(toAdd);
    }
  }

  public unsubscribe(symbols: string[]): void {
    const toRemove: string[] = [];
    for (const sym of symbols) {
      const mapping = getSymbolMapping(sym);
      if (mapping && mapping.twelveDataSymbol) {
        if (this.subscribedCanonicalSymbols.delete(sym.toUpperCase())) {
          toRemove.push(mapping.twelveDataSymbol);
        }
      }
    }

    if (toRemove.length > 0 && this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({
          action: 'unsubscribe',
          params: { symbols: toRemove.join(',') },
        }));
      } catch {
        // ignore
      }
    }
  }

  public onQuote(listener: QuoteListener): () => void {
    this.quoteListeners.add(listener);
    return () => this.quoteListeners.delete(listener);
  }

  public getStatus(): ProviderStatusInfo {
    return {
      providerId: this.providerId,
      providerName: this.providerName,
      status: this.status,
      supportedSymbols: Array.from(this.subscribedCanonicalSymbols),
      lastMessageTimestamp: this.lastMessageTimestamp,
      reconnectAttempts: this.reconnectAttempts,
      isHealthy: this.isHealthy(),
    };
  }

  public isHealthy(): boolean {
    return this.isRunning && this.status === 'CONNECTED' && Date.now() - this.lastMessageTimestamp < this.staleThresholdMs;
  }

  public getQuote(canonicalSymbol: string): NormalizedInternalQuote | undefined {
    return this.quotes.get(canonicalSymbol.toUpperCase());
  }

  public getAllQuotes(): Record<string, NormalizedInternalQuote> {
    const res: Record<string, NormalizedInternalQuote> = {};
    for (const [sym, q] of this.quotes.entries()) {
      res[sym] = q;
    }
    return res;
  }

  // --- WebSocket Connection & Lifecycle ---

  private connectWebSocket(): void {
    if (!this.isRunning || !this.isKeyConfigured()) return;

    this.status = this.reconnectAttempts > 0 ? 'RECONNECTING' : 'CONNECTING';

    const fullUrl = `${this.wsUrl}?apikey=${encodeURIComponent(this.apiKey)}`;

    try {
      this.ws = new WebSocket(fullUrl);

      this.ws.on('open', () => {
        this.status = 'CONNECTED';
        this.reconnectAttempts = 0;
        this.lastMessageTimestamp = Date.now();
        console.log(`[TwelveDataMarketDataAdapter] Connected to WebSocket at ${this.wsUrl}`);

        // Subscribe all active symbols
        const providerSymbols: string[] = [];
        for (const can of this.subscribedCanonicalSymbols) {
          const mapping = getSymbolMapping(can);
          if (mapping?.twelveDataSymbol) {
            providerSymbols.push(mapping.twelveDataSymbol);
          }
        }
        if (providerSymbols.length > 0) {
          this.sendSubscriptionFrame(providerSymbols);
        }
      });

      this.ws.on('message', (data: Buffer | string) => {
        this.lastMessageTimestamp = Date.now();
        this.handleMessage(data.toString());
      });

      this.ws.on('error', (err: Error) => {
        console.warn('[TwelveDataMarketDataAdapter] WebSocket error:', err.message);
      });

      this.ws.on('close', () => {
        this.handleSocketClose();
      });
    } catch (err: any) {
      console.warn('[TwelveDataMarketDataAdapter] Failed to establish WebSocket:', err.message);
      this.handleSocketClose();
    }
  }

  private sendSubscriptionFrame(symbols: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      const payload = {
        action: 'subscribe',
        params: {
          symbols: symbols.join(','),
        },
      };
      this.ws.send(JSON.stringify(payload));
    } catch (err) {
      console.warn('[TwelveDataMarketDataAdapter] Subscription transmission error:', err);
    }
  }

  private handleSocketClose(): void {
    this.status = 'DISCONNECTED';
    this.ws = null;

    if (!this.isRunning) return;

    this.reconnectAttempts++;
    const delay = Math.min(
      this.initialReconnectDelayMs * Math.pow(1.5, this.reconnectAttempts - 1),
      this.maxReconnectDelayMs
    );

    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectWebSocket();
    }, delay);
  }

  // --- Message Ingestion & Normalization ---

  public handleMessage(rawMessage: string): void {
    let parsed: any;
    try {
      parsed = JSON.parse(rawMessage);
    } catch {
      return;
    }

    if (!parsed || typeof parsed !== 'object') return;

    // Handle heartbeats & acknowledgements
    if (parsed.event === 'heartbeat' || parsed.event === 'subscribe-status') {
      return;
    }

    if (parsed.event === 'price' && parsed.symbol && typeof parsed.price === 'number') {
      this.processPriceEvent(parsed as RawTwelveDataPriceEvent);
    }
  }

  private processPriceEvent(event: RawTwelveDataPriceEvent): void {
    if (!event.symbol || typeof event.price !== 'number') return;

    const canonical = getCanonicalFromTwelveData(event.symbol);
    if (!canonical) return;

    const mapping = getSymbolMapping(canonical);
    if (!mapping) return;

    const digits = mapping.digits;
    const mid = Number(event.price.toFixed(digits));

    // Derive or extract bid and ask
    let bid: number;
    let ask: number;

    if (typeof event.bid === 'number' && typeof event.ask === 'number' && event.ask >= event.bid) {
      bid = Number(event.bid.toFixed(digits));
      ask = Number(event.ask.toFixed(digits));
    } else {
      const halfSpread = (mapping.defaultSpreadPoints * Math.pow(10, -digits)) / 2;
      bid = Number((mid - halfSpread).toFixed(digits));
      ask = Number((mid + halfSpread).toFixed(digits));
    }

    const spread = Number(
      ((ask - bid) * Math.pow(10, digits === 3 || digits === 5 ? digits - 1 : 0)).toFixed(1)
    );

    const now = Date.now();
    const tickTime = event.timestamp ? event.timestamp * 1000 : now;

    const existing = this.quotes.get(canonical);
    let tickDirection: 'UP' | 'DOWN' | 'FLAT' = 'FLAT';
    if (existing) {
      if (bid > existing.bid) tickDirection = 'UP';
      else if (bid < existing.bid) tickDirection = 'DOWN';
    }

    const normalized: NormalizedInternalQuote = {
      symbol: canonical,
      bid,
      ask,
      mid,
      spread,
      timestamp: tickTime,
      providerTimestamp: tickTime,
      receivedTimestamp: now,
      marketStatus: 'LIVE',
      providerId: this.providerId,
      assetClass: mapping.category,
      digits,
      tickSize: Math.pow(10, -digits),
      tickDirection,
      high24h: Number((mid * 1.01).toFixed(digits)),
      low24h: Number((mid * 0.99).toFixed(digits)),
      change24h: 0,
      change24hPct: 0,
    };

    this.ticksReceivedCount++;
    this.quotes.set(canonical, normalized);
    this.emitQuote(normalized);
  }

  private emitQuote(quote: NormalizedInternalQuote): void {
    for (const listener of this.quoteListeners) {
      try {
        listener(quote);
      } catch (err) {
        console.error('[TwelveDataMarketDataAdapter] Error in quote listener:', err);
      }
    }
  }

  // --- REST Initial Quote Seeding (Part 13) ---

  public async seedInitialQuotesRest(): Promise<void> {
    if (this.restSeedPerformed || !this.isKeyConfigured()) return;
    this.restSeedPerformed = true;

    const symbolsToFetch: string[] = [];
    for (const can of this.subscribedCanonicalSymbols) {
      const mapping = getSymbolMapping(can);
      if (mapping?.twelveDataSymbol) {
        symbolsToFetch.push(mapping.twelveDataSymbol);
      }
    }

    if (symbolsToFetch.length === 0) return;

    try {
      const url = `${this.restBaseUrl}/quote?symbol=${encodeURIComponent(symbolsToFetch.join(','))}&apikey=${encodeURIComponent(this.apiKey)}`;
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!res.ok) return;

      const data = await res.json();
      if (!data) return;

      // Twelve Data returns single object if 1 symbol, or Record<symbol, object> if multiple
      const processQuoteObj = (item: any) => {
        if (!item || !item.symbol || !item.close) return;
        const closePrice = parseFloat(item.close);
        if (isNaN(closePrice) || closePrice <= 0) return;

        const canonical = getCanonicalFromTwelveData(item.symbol);
        if (!canonical) return;
        const mapping = getSymbolMapping(canonical);
        if (!mapping) return;

        // Only seed if WebSocket hasn't already received a live tick
        if (this.quotes.has(canonical)) return;

        const digits = mapping.digits;
        const halfSpread = (mapping.defaultSpreadPoints * Math.pow(10, -digits)) / 2;
        const bid = Number((closePrice - halfSpread).toFixed(digits));
        const ask = Number((closePrice + halfSpread).toFixed(digits));
        const spread = Number(
          ((ask - bid) * Math.pow(10, digits === 3 || digits === 5 ? digits - 1 : 0)).toFixed(1)
        );

        const changePct = item.percent_change ? parseFloat(item.percent_change) : 0;
        const change = item.change ? parseFloat(item.change) : 0;
        const now = Date.now();

        const seededQuote: NormalizedInternalQuote = {
          symbol: canonical,
          bid,
          ask,
          mid: closePrice,
          spread,
          timestamp: item.timestamp ? item.timestamp * 1000 : now,
          providerTimestamp: item.timestamp ? item.timestamp * 1000 : now,
          receivedTimestamp: now,
          marketStatus: 'LIVE',
          providerId: this.providerId,
          assetClass: mapping.category,
          digits,
          tickSize: Math.pow(10, -digits),
          tickDirection: 'FLAT',
          high24h: item.high ? parseFloat(item.high) : closePrice,
          low24h: item.low ? parseFloat(item.low) : closePrice,
          change24h: change,
          change24hPct: changePct,
        };

        this.quotes.set(canonical, seededQuote);
        this.emitQuote(seededQuote);
      };

      if (data.symbol && data.close) {
        processQuoteObj(data);
      } else if (typeof data === 'object') {
        for (const item of Object.values(data)) {
          processQuoteObj(item);
        }
      }
    } catch {
      // Non-fatal: WebSocket stream will deliver quotes as ticks occur
    }
  }

  private checkStale(): void {
    const now = Date.now();
    for (const [sym, quote] of this.quotes.entries()) {
      if (quote.marketStatus === 'LIVE' && now - quote.timestamp > this.staleThresholdMs) {
        quote.marketStatus = 'STALE';
        this.emitQuote({ ...quote });
      }
    }
  }
}
