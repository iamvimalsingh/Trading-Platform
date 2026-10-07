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
import { isMarketSessionClosed } from './MarketDataRouter';
import { InstrumentRegistry } from './InstrumentRegistry';

export interface TwelveDataAdapterOptions {
  apiKey?: string;
  wsUrl?: string;
  restBaseUrl?: string;
  symbols?: string[]; // Canonical symbols, e.g. ['BTCUSD', 'ETHUSD', 'XAUUSD', 'XAGUSD', 'WTIUSD']
  autoStart?: boolean;
  staleThresholdMs?: number;
  restStaleThresholdMs?: number;
  restPollIntervalMs?: number;
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
  private readonly restStaleThresholdMs: number;
  private readonly restPollIntervalMs: number;
  private readonly initialReconnectDelayMs: number;
  private readonly maxReconnectDelayMs: number;

  private ws: WebSocket | null = null;
  private isRunning: boolean = false;
  private reconnectAttempts: number = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private staleWatchdogTimer: NodeJS.Timeout | null = null;
  private stableTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private restSeedPerformed: boolean = false;
  private rateLimitedUntil: number = 0;

  private subscribedCanonicalSymbols: Set<string> = new Set();
  private activeWebSocketSymbols: Set<string> = new Set();
  private unsupportedWebSocketSymbols: Set<string> = new Set();
  private quoteListeners: Set<QuoteListener> = new Set();
  private quotes: Map<string, NormalizedInternalQuote> = new Map();
  private status: 'CONNECTED' | 'CONNECTING' | 'RECONNECTING' | 'DISCONNECTED' | 'DEGRADED' = 'DISCONNECTED';
  private lastMessageTimestamp: number = 0;
  private ticksReceivedCount: number = 0;
  private restPollTimer: NodeJS.Timeout | null = null;
  private isPollingRest: boolean = false;

  constructor(options?: TwelveDataAdapterOptions) {
    this.apiKey = (options?.apiKey || process.env.TWELVE_DATA_API_KEY || '').trim();
    this.wsUrl = options?.wsUrl || 'wss://ws.twelvedata.com/v1/quotes/price';
    this.restBaseUrl = options?.restBaseUrl || 'https://api.twelvedata.com';
    this.staleThresholdMs = options?.staleThresholdMs || 15000;
    this.restStaleThresholdMs = options?.restStaleThresholdMs || 45000; // 3x 15s REST polling cadence
    this.restPollIntervalMs = options?.restPollIntervalMs || 25000;
    this.initialReconnectDelayMs = options?.initialReconnectDelayMs || 8000;
    this.maxReconnectDelayMs = options?.maxReconnectDelayMs || 45000;

    // Default canonical symbols managed by Twelve Data
    const initialSymbols = options?.symbols || ['BTCUSD', 'ETHUSD', 'BNBUSD', 'SOLUSD', 'XRPUSD', 'XAUUSD', 'XAGUSD', 'WTIUSD'];
    for (const sym of initialSymbols) {
      const mapping = getSymbolMapping(sym);
      if (mapping && mapping.twelveDataSymbol) {
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
      console.warn('[TwelveDataMarketDataAdapter] WARNING: TWELVE_DATA_API_KEY is not configured. Running in idle/standby mode. WTI/USD (Crude Oil) and Twelve Data secondary feeds will not receive live market quotes.');
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

    // Start periodic REST polling watchdog for non-streaming symbols
    this.restPollTimer = setInterval(() => {
      if (this.unsupportedWebSocketSymbols.size > 0 || !this.isHealthy()) {
        this.pollRestQuotes().catch(() => {});
      }
    }, this.restPollIntervalMs);
  }

  public stop(): void {
    this.isRunning = false;

    this.stopHeartbeat();

    if (this.stableTimer) {
      clearTimeout(this.stableTimer);
      this.stableTimer = null;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.staleWatchdogTimer) {
      clearInterval(this.staleWatchdogTimer);
      this.staleWatchdogTimer = null;
    }

    if (this.restPollTimer) {
      clearInterval(this.restPollTimer);
      this.restPollTimer = null;
    }

    if (this.ws) {
      const socket = this.ws;
      this.ws = null;
      socket.removeAllListeners();
      socket.on('error', () => {});
      try {
        if (socket.readyState === WebSocket.OPEN) {
          socket.close();
        } else {
          socket.terminate();
        }
      } catch {
        // ignore
      }
    }

    this.status = 'DISCONNECTED';
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        // Only send heartbeat if connection has been idle for >= 20s to conserve event quota
        if (Date.now() - this.lastMessageTimestamp >= 20000) {
          try {
            this.ws.send(JSON.stringify({ action: 'heartbeat' }));
          } catch {
            // ignore
          }
        }
      }
    }, 15000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
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
      if (mapping && mapping.twelveDataSymbol) {
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
    if (!this.isRunning) return false;
    if (this.status === 'CONNECTED') {
      return Date.now() - this.lastMessageTimestamp < this.staleThresholdMs;
    }
    if (this.unsupportedWebSocketSymbols.size > 0 && this.lastMessageTimestamp > 0) {
      return Date.now() - this.lastMessageTimestamp < this.restStaleThresholdMs;
    }
    return false;
  }

  public getStaleThresholdForSymbol(symbol: string): number {
    const canonical = symbol.toUpperCase();
    if (this.unsupportedWebSocketSymbols.has(canonical)) {
      return this.restStaleThresholdMs;
    }
    const mapping = getSymbolMapping(canonical);
    if (mapping?.category === 'COMMODITIES') {
      return this.restStaleThresholdMs;
    }
    return this.staleThresholdMs;
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

    if (this.rateLimitedUntil > Date.now()) {
      const waitMs = this.rateLimitedUntil - Date.now() + 1000;
      console.log(`[TwelveDataMarketDataAdapter] Currently rate-limited (100 events/min quota). Deferring connect by ${Math.round(waitMs / 1000)}s.`);
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connectWebSocket();
      }, waitMs);
      return;
    }

    // Clean up any existing connection before opening a new one to prevent concurrent socket collisions
    if (this.ws) {
      const oldWs = this.ws;
      this.ws = null;
      this.stopHeartbeat();
      oldWs.removeAllListeners();
      try {
        if (oldWs.readyState === WebSocket.OPEN) {
          oldWs.close();
        } else {
          oldWs.terminate();
        }
      } catch {
        // ignore
      }
    }

    this.status = this.reconnectAttempts > 0 ? 'RECONNECTING' : 'CONNECTING';

    const fullUrl = `${this.wsUrl}?apikey=${encodeURIComponent(this.apiKey)}`;

    try {
      this.ws = new WebSocket(fullUrl);

      this.ws.on('open', () => {
        this.status = 'CONNECTED';
        this.lastMessageTimestamp = Date.now();
        console.log(`[TwelveDataMarketDataAdapter] Connected to WebSocket at ${this.wsUrl}`);

        // Start heartbeat keepalive (every 10s per Twelve Data specification)
        this.startHeartbeat();

        // Only mark connection as stable and reset attempts counter after 30s of uninterrupted uptime
        if (this.stableTimer) clearTimeout(this.stableTimer);
        this.stableTimer = setTimeout(() => {
          this.reconnectAttempts = 0;
          this.stableTimer = null;
        }, 30000);

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

      this.ws.on('close', (code: number, reason: Buffer) => {
        this.handleSocketClose(code, reason ? reason.toString() : undefined);
      });
    } catch (err: any) {
      console.warn('[TwelveDataMarketDataAdapter] Failed to establish WebSocket:', err.message);
      this.handleSocketClose();
    }
  }

  private sendSubscriptionFrame(symbols: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      // Exclude symbols that the provider explicitly rejected on WebSocket
      const eligible = symbols.filter((s) => {
        const can = getCanonicalFromTwelveData(s);
        return !can || !this.unsupportedWebSocketSymbols.has(can);
      });
      if (eligible.length === 0) return;

      const payload = {
        action: 'subscribe',
        params: {
          symbols: eligible.join(','),
        },
      };
      this.ws.send(JSON.stringify(payload));
    } catch (err) {
      console.warn('[TwelveDataMarketDataAdapter] Subscription transmission error:', err);
    }
  }

  private handleSocketClose(code?: number, reason?: string): void {
    this.stopHeartbeat();

    if (this.stableTimer) {
      clearTimeout(this.stableTimer);
      this.stableTimer = null;
    }

    this.status = 'DISCONNECTED';
    this.ws = null;

    if (!this.isRunning) return;

    this.reconnectAttempts++;
    // Apply backoff with jitter to prevent concurrent instance lockstep / thundering herd
    const jitter = Math.floor(Math.random() * 2000) + 1000;
    let delay = Math.min(
      this.initialReconnectDelayMs * Math.pow(1.5, this.reconnectAttempts - 1) + jitter,
      this.maxReconnectDelayMs
    );

    if (this.rateLimitedUntil > Date.now()) {
      delay = Math.max(delay, this.rateLimitedUntil - Date.now() + 2000);
    }

    console.log(`[TwelveDataMarketDataAdapter] Connection closed (code: ${code || 'unknown'}, reason: ${reason || 'none'}). Scheduling reconnect in ${Math.round(delay / 1000)}s (attempt ${this.reconnectAttempts})...`);

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
    if (parsed.event === 'heartbeat') {
      return;
    }

    if (parsed.event === 'subscribe-status') {
      const successList: any[] = Array.isArray(parsed.success) ? parsed.success : [];
      const failsList: any[] = Array.isArray(parsed.fails) ? parsed.fails : [];

      for (const item of successList) {
        if (item && item.symbol) {
          const canonical = getCanonicalFromTwelveData(item.symbol);
          if (canonical) {
            this.activeWebSocketSymbols.add(canonical);
            this.unsupportedWebSocketSymbols.delete(canonical);
          }
        }
      }

      for (const item of failsList) {
        if (item && item.symbol) {
          const canonical = getCanonicalFromTwelveData(item.symbol);
          if (canonical) {
            this.activeWebSocketSymbols.delete(canonical);
            this.unsupportedWebSocketSymbols.add(canonical);
          }
        }
      }

      console.log(
        `[TwelveDataMarketDataAdapter] Subscription status processed: ${this.activeWebSocketSymbols.size} symbols streaming via WebSocket, ${this.unsupportedWebSocketSymbols.size} symbols routed to REST live feed.`
      );

      // Trigger immediate REST poll for failed/unsupported WebSocket symbols
      if (this.unsupportedWebSocketSymbols.size > 0) {
        this.pollRestQuotes().catch(() => {});
      }
      return;
    }

    if (parsed.event === 'error' || parsed.status === 'error' || parsed.event === 'message-processing') {
      const rawMsg = JSON.stringify(parsed);
      const isRateLimited = rawMsg.includes('exceeds the limit') ||
                            rawMsg.includes('100 events per minute') ||
                            rawMsg.includes('limit of 100') ||
                            rawMsg.includes('rate limit');
      if (isRateLimited) {
        this.rateLimitedUntil = Date.now() + 75000;
        this.status = 'DEGRADED';
        this.stopHeartbeat();
        console.log('[TwelveDataMarketDataAdapter] Event rate limit detected (100 events/min quota). Pausing WebSocket reconnects and REST polling for 75s.');

        // Close socket cleanly so Twelve Data terminates the session and resets the quota
        if (this.ws) {
          const socket = this.ws;
          this.ws = null;
          socket.removeAllListeners();
          socket.on('error', () => {});
          try {
            socket.close();
          } catch {
            // ignore
          }
        }

        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        const resumeDelay = 76000 + Math.floor(Math.random() * 4000);
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          this.connectWebSocket();
        }, resumeDelay);
        return;
      }

      const note = parsed.message || (Array.isArray(parsed.messages) ? parsed.messages.join('; ') : 'Provider notice received');
      console.log(`[TwelveDataMarketDataAdapter] Provider note: ${note}`);
      return;
    }

    if (parsed.event === 'price' && parsed.symbol && typeof parsed.price === 'number') {
      this.processPriceEvent(parsed as RawTwelveDataPriceEvent);
    }
  }

  public async pollRestQuotes(): Promise<void> {
    if (this.isPollingRest || !this.isRunning || !this.isKeyConfigured() || this.rateLimitedUntil > Date.now()) return;

    const targets: string[] = [];
    for (const can of this.subscribedCanonicalSymbols) {
      if (this.unsupportedWebSocketSymbols.has(can) || (!this.isHealthy() && this.status !== 'DEGRADED')) {
        const mapping = getSymbolMapping(can);
        if (mapping?.twelveDataSymbol) {
          targets.push(mapping.twelveDataSymbol);
        }
      }
    }

    if (targets.length === 0) return;

    this.isPollingRest = true;
    try {
      // Query all target symbols in a single batch request to avoid exhausting REST quota
      const url = `${this.restBaseUrl}/price?symbol=${encodeURIComponent(targets.join(','))}&apikey=${encodeURIComponent(this.apiKey)}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      try {
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (res.status === 429) {
          this.rateLimitedUntil = Date.now() + 75000;
          this.status = 'DEGRADED';
          return;
        }

        if (!res.ok) return;
        const data = await res.json();
        if (!data) return;

        if (data.code === 429 || (data.status === 'error' && JSON.stringify(data).includes('limit'))) {
          this.rateLimitedUntil = Date.now() + 75000;
          this.status = 'DEGRADED';
          return;
        }

        if (data.status === 'error' || data.code) return;

        const now = Date.now();
        this.lastMessageTimestamp = now;

        if (targets.length === 1 && data.price) {
          const can = getCanonicalFromTwelveData(targets[0]);
          if (can) {
            this.applyRestPrice(can, parseFloat(data.price), now);
          }
        } else if (typeof data === 'object') {
          for (const [providerSym, val] of Object.entries<any>(data)) {
            if (val && val.price) {
              const can = getCanonicalFromTwelveData(providerSym);
              if (can) {
                this.applyRestPrice(can, parseFloat(val.price), now);
              }
            }
          }
        }
      } catch {
        clearTimeout(timeoutId);
      }
    } finally {
      this.isPollingRest = false;
    }
  }

  private applyRestPrice(canonical: string, rawPrice: number, timestamp: number): void {
    if (isNaN(rawPrice) || rawPrice <= 0) return;
    const mapping = getSymbolMapping(canonical);
    if (!mapping) return;

    const digits = mapping.digits;
    const mid = Number(rawPrice.toFixed(digits));
    const halfSpread = (mapping.defaultSpreadPoints * Math.pow(10, -digits)) / 2;
    const bid = Number((mid - halfSpread).toFixed(digits));
    const ask = Number((mid + halfSpread).toFixed(digits));
    const spread = Number(
      ((ask - bid) * Math.pow(10, digits === 3 || digits === 5 ? digits - 1 : 0)).toFixed(1)
    );

    const existing = this.quotes.get(canonical);
    let tickDirection: 'UP' | 'DOWN' | 'FLAT' = 'FLAT';
    if (existing) {
      if (bid > existing.bid) tickDirection = 'UP';
      else if (bid < existing.bid) tickDirection = 'DOWN';
    }

    const now = Date.now();
    const isClosed = isMarketSessionClosed(mapping.category, now);

    const normalized: NormalizedInternalQuote = {
      symbol: canonical,
      bid,
      ask,
      mid,
      spread,
      timestamp,
      providerTimestamp: timestamp,
      receivedTimestamp: now,
      marketStatus: isClosed ? 'CLOSED' : 'LIVE',
      providerId: this.providerId,
      assetClass: mapping.category,
      digits,
      tickSize: Math.pow(10, -digits),
      tickDirection,
      high24h: existing ? Math.max(existing.high24h, mid) : Number((mid * 1.01).toFixed(digits)),
      low24h: existing ? Math.min(existing.low24h, mid) : Number((mid * 0.99).toFixed(digits)),
      change24h: existing ? Number((mid - existing.mid).toFixed(digits)) : 0,
      change24hPct: 0,
    };

    this.ticksReceivedCount++;
    this.quotes.set(canonical, normalized);
    this.emitQuote(normalized);
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
    let tickTime = now;
    if (typeof event.timestamp === 'number' && event.timestamp > 0) {
      // Exact-once conversion: epoch seconds (< 1e11) to epoch milliseconds
      tickTime = event.timestamp > 1e11 ? event.timestamp : event.timestamp * 1000;
    }

    const isClosed = isMarketSessionClosed(mapping.category, now);

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
      marketStatus: isClosed ? 'CLOSED' : 'LIVE',
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

        let tickTime = now;
        if (typeof item.timestamp === 'number' && item.timestamp > 0) {
          // Exact-once conversion: epoch seconds (< 1e11) to epoch milliseconds
          tickTime = item.timestamp > 1e11 ? item.timestamp : item.timestamp * 1000;
        } else if (typeof item.timestamp === 'string') {
          const parsed = Date.parse(item.timestamp);
          if (!isNaN(parsed) && parsed > 0) {
            tickTime = parsed;
          }
        }

        const isClosed = isMarketSessionClosed(mapping.category, now);

        const seededQuote: NormalizedInternalQuote = {
          symbol: canonical,
          bid,
          ask,
          mid: closePrice,
          spread,
          timestamp: tickTime,
          providerTimestamp: tickTime,
          receivedTimestamp: now,
          marketStatus: isClosed ? 'CLOSED' : 'LIVE',
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
      const mapping = getSymbolMapping(sym);
      const isClosed = isMarketSessionClosed(mapping?.category || 'FOREX', now);
      if (isClosed) {
        if (quote.marketStatus !== 'CLOSED') {
          quote.marketStatus = 'CLOSED';
          this.emitQuote({ ...quote });
        }
      } else {
        const threshold = this.getStaleThresholdForSymbol(sym);
        const quoteTime = quote.receivedTimestamp || quote.timestamp;
        const quoteAge = now - quoteTime;
        if (quote.marketStatus === 'LIVE' && quoteAge > threshold) {
          quote.marketStatus = 'STALE';
          this.emitQuote({ ...quote });
        }
      }
    }
  }
}
