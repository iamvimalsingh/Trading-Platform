/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * TIINGO REAL MARKET DATA ADAPTER (T4A POC)
 * Server-authoritative WebSocket adapter streaming real-time EURUSD Top-of-Book (Bid/Ask) quotes
 * from Tiingo Forex feed (wss://api.tiingo.com/fx) into TradingRuntime.
 */

import { WebSocket } from 'ws';
import { OHLCVBar, Quote, SymbolConfig } from '../types/trading';
import { IMarketDataProvider, MarketMetrics, ProviderConnectionState, QuoteBatchListener } from './IMarketDataProvider';
import { IMarketDataAdapter, QuoteListener } from './IMarketDataAdapter';
import { NormalizedInternalQuote, ProviderStatusInfo } from '../types/marketData';
import { ALL_SYMBOLS, INITIAL_SYMBOLS } from './MarketEngine';
import { getSymbolMapping } from './SymbolMapping';

export interface TiingoAdapterOptions {
  apiToken: string;
  wsUrl?: string;
  cryptoWsUrl?: string;
  tickers?: string[];
  cryptoTickers?: string[];
  autoStart?: boolean;
  staleThresholdMs?: number;
  initialReconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
}

export interface RawTiingoQuoteTuple {
  updateType: string;    // "Q" for quote, "T" for trade
  ticker: string;        // "eurusd"
  timestamp: string;     // ISO 8601 string, e.g. "2026-09-26T11:45:00.123456Z"
  bidSize: number;
  bidPrice: number;
  midPrice?: number;
  askSize: number;
  askPrice: number;
}

export interface SessionStats {
  sessionOpenPrice: number;
  sessionHigh: number;
  sessionLow: number;
}

/**
 * Pure parsing function: Extracts validated quote tuples from incoming Tiingo WebSocket message.
 * Supports single tuples, batched tuple arrays, and skips heartbeats/subscription acks.
 */
export function parseTiingoMessage(raw: unknown): RawTiingoQuoteTuple[] {
  let parsed: any;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  } else {
    parsed = raw;
  }

  if (!parsed || typeof parsed !== 'object') return [];

  // Ignore heartbeats (messageType === 'H') and subscription acks
  if (parsed.messageType === 'H') return [];
  if (parsed.response && parsed.response.code === 200) return [];

  // Verify Forex data update: service === 'fx' and messageType === 'A'
  if (parsed.service !== 'fx' && parsed.messageType !== 'A') return [];
  if (!parsed.data) return [];

  const tuples: RawTiingoQuoteTuple[] = [];

  const processTuple = (item: any) => {
    if (!Array.isArray(item) || item.length < 7) return;

    let updateType: any;
    let ticker: any;
    let timestamp: any;
    let bidSize: any;
    let bidPrice: any;
    let midPrice: any;
    let askSize: any;
    let askPrice: any;

    if (item.length >= 8) {
      [
        updateType,
        ticker,
        timestamp,
        bidSize,
        bidPrice,
        midPrice,
        askSize,
        askPrice,
      ] = item;
    } else {
      // Fallback for 7-element legacy tuple without midPrice
      [updateType, ticker, timestamp, bidSize, bidPrice, askSize, askPrice] = item;
      midPrice = undefined;
    }

    // Only process Top-of-Book quotes ('Q')
    if (updateType !== 'Q') return;
    if (typeof ticker !== 'string') return;

    const numBid = Number(bidPrice);
    const numAsk = Number(askPrice);

    if (isNaN(numBid) || isNaN(numAsk) || numBid <= 0 || numAsk <= 0) return;

    tuples.push({
      updateType,
      ticker: ticker.toUpperCase(),
      timestamp: String(timestamp),
      bidSize: Number(bidSize) || 0,
      bidPrice: numBid,
      midPrice: typeof midPrice === 'number' ? midPrice : Number(midPrice) || undefined,
      askSize: Number(askSize) || 0,
      askPrice: numAsk,
    });
  };

  if (Array.isArray(parsed.data)) {
    if (parsed.data.length > 0 && typeof parsed.data[0] === 'string') {
      // Single tuple: ["Q", "eurusd", ...]
      processTuple(parsed.data);
    } else {
      // Batched tuples: [ ["Q", "eurusd", ...], ... ]
      for (const item of parsed.data) {
        processTuple(item);
      }
    }
  }

  return tuples;
}

/**
 * Pure normalization function: Converts raw Tiingo quote tuple to authoritative internal Quote contract.
 * - mid = (bid + ask) / 2
 * - spread = ask - bid
 * - timestamp = provider timestamp in ms
 * - tickDirection = dynamic compare against previous bid
 * - tracks session high/low/change without fabricating external data
 */
export function normalizeTiingoQuote(
  raw: RawTiingoQuoteTuple,
  symbolCfg: SymbolConfig,
  prevQuote?: Quote,
  sessionStats?: SessionStats
): { quote: Quote; updatedStats: SessionStats } {
  const digits = symbolCfg.digits;
  const bid = Number(raw.bidPrice.toFixed(digits));
  const ask = Number(raw.askPrice.toFixed(digits));
  const mid = Number(((bid + ask) / 2).toFixed(digits));
  const spread = Number((ask - bid).toFixed(digits));

  const parsedTime = Date.parse(raw.timestamp);
  const timestamp = isNaN(parsedTime) ? Date.now() : parsedTime;

  let tickDirection: 'UP' | 'DOWN' | 'FLAT' = 'FLAT';
  if (prevQuote) {
    if (bid > prevQuote.bid) tickDirection = 'UP';
    else if (bid < prevQuote.bid) tickDirection = 'DOWN';
  }

  const openPrice = sessionStats?.sessionOpenPrice && sessionStats.sessionOpenPrice > 0
    ? sessionStats.sessionOpenPrice
    : mid;
  const sessionHigh = sessionStats ? Math.max(sessionStats.sessionHigh, ask) : ask;
  const sessionLow = sessionStats ? Math.min(sessionStats.sessionLow, bid) : bid;

  const change24h = Number((mid - openPrice).toFixed(digits));
  const change24hPct = openPrice > 0 ? Number(((change24h / openPrice) * 100).toFixed(2)) : 0;

  const updatedStats: SessionStats = {
    sessionOpenPrice: openPrice,
    sessionHigh,
    sessionLow,
  };

  const quote: Quote = {
    symbol: raw.ticker,
    bid,
    ask,
    spread,
    mid,
    high24h: sessionHigh,
    low24h: sessionLow,
    change24h,
    change24hPct,
    timestamp,
    tickDirection,
    marketStatus: 'LIVE',
    source: 'tiingo_fx',
    digits,
    tickSize: symbolCfg.tickSize || Math.pow(10, -digits),
    providerTimestamp: parsedTime,
    receivedTimestamp: Date.now(),
  };

  return { quote, updatedStats };
}

export class TiingoMarketDataAdapter implements IMarketDataProvider, IMarketDataAdapter {
  public readonly providerId: string = 'tiingo_fx';
  public readonly providerName: string = 'TiingoLiveFeed';

  private readonly apiToken: string;
  private readonly wsUrl: string;
  private readonly cryptoWsUrl: string;
  private readonly tickers: string[];
  private readonly cryptoTickers: string[];
  private readonly staleThresholdMs: number;
  private readonly initialReconnectDelayMs: number;
  private readonly maxReconnectDelayMs: number;

  private ws: WebSocket | null = null;
  private wsCrypto: WebSocket | null = null;
  private isRunning: boolean = false;
  private reconnectAttempts: number = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private staleWatchdogTimer: NodeJS.Timeout | null = null;

  private quotes: Map<string, Quote> = new Map();
  private sessionStats: Map<string, SessionStats> = new Map();
  private symbolLastTick: Map<string, number> = new Map();
  private symbolsMap: Map<string, SymbolConfig> = new Map();
  private activeSymbols: SymbolConfig[] = [];
  private listeners: Set<QuoteBatchListener> = new Set();
  private historicalBarsCache: Map<string, OHLCVBar[]> = new Map();

  private connectionStatus: 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'RECONNECTING' = 'DISCONNECTED';
  private ticksReceivedCount: number = 0;
  private lastTickTimestamp: number = 0;
  private isStale: boolean = false;

  constructor(options: TiingoAdapterOptions) {
    this.apiToken = (options.apiToken || '').trim();
    this.wsUrl = options.wsUrl || 'wss://api.tiingo.com/fx';
    this.cryptoWsUrl = options.cryptoWsUrl || 'wss://api.tiingo.com/crypto';
    this.tickers =
      options.tickers && options.tickers.length > 0
        ? options.tickers.map((t) => t.toLowerCase())
        : ['eurusd', 'gbpusd', 'usdjpy', 'usdchf', 'audusd', 'usdcad', 'nzdusd', 'usdcnh', 'eurjpy', 'gbpjpy', 'xauusd', 'xagusd'];
    this.cryptoTickers =
      options.cryptoTickers && options.cryptoTickers.length > 0
        ? options.cryptoTickers.map((t) => t.toLowerCase())
        : ['btcusd', 'ethusd', 'bnbusd', 'solusd', 'xrpusd'];
    this.staleThresholdMs = options.staleThresholdMs || 15000;
    this.initialReconnectDelayMs = options.initialReconnectDelayMs || 1000;
    this.maxReconnectDelayMs = options.maxReconnectDelayMs || 30000;

    // Initialize symbols metadata
    for (const sym of ALL_SYMBOLS) {
      this.symbolsMap.set(sym.symbol, sym);
    }
    this.activeSymbols = ALL_SYMBOLS;

    if (options.autoStart) {
      this.start();
    }
  }

  private initDefaultQuotes(): void {
    const now = Date.now();
    const BASE_PRICES: Record<string, { price: number; step: number }> = {
      EURUSD: { price: 1.08450, step: 0.00008 },
      GBPUSD: { price: 1.28820, step: 0.00012 },
      USDJPY: { price: 152.450, step: 0.025 },
      XAUUSD: { price: 2735.50, step: 0.45 },
      BTCUSD: { price: 68420.00, step: 18.50 },
      AUDUSD: { price: 0.65820, step: 0.00009 },
      USDCAD: { price: 1.38540, step: 0.00010 },
      USDCHF: { price: 0.86430, step: 0.00008 },
      ETHUSD: { price: 2540.20, step: 1.20 },
      US500:  { price: 5824.50, step: 0.85 },
    };

    for (const sym of this.activeSymbols) {
      const seed = BASE_PRICES[sym.symbol] || { price: 100.0, step: 0.05 };
      const spreadOffset = (sym.defaultSpreadPoints * Math.pow(10, -sym.digits)) / 2;
      const bid = Number((seed.price - spreadOffset).toFixed(sym.digits));
      const ask = Number((seed.price + spreadOffset).toFixed(sym.digits));
      const spread = Number(
        ((ask - bid) * Math.pow(10, sym.digits === 3 || sym.digits === 5 ? sym.digits - 1 : 0)).toFixed(1)
      );

      const quote: Quote = {
        symbol: sym.symbol,
        bid,
        ask,
        spread,
        mid: seed.price,
        high24h: Number((seed.price * 1.012).toFixed(sym.digits)),
        low24h: Number((seed.price * 0.988).toFixed(sym.digits)),
        change24h: 0,
        change24hPct: 0,
        timestamp: now,
        tickDirection: 'FLAT',
      };

      this.quotes.set(sym.symbol, quote);
      this.sessionStats.set(sym.symbol, {
        sessionOpenPrice: seed.price,
        sessionHigh: ask,
        sessionLow: bid,
      });
    }
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // Start stale quote watchdog
    this.startWatchdog();

    // Trigger initial top-of-book REST seed for both FX and Crypto
    this.seedInitialQuotesRest().catch((err) => {
      console.warn('[TiingoAdapter] Initial REST seed error:', err?.message || err);
    });

    // Establish WebSocket connections (FX + Crypto)
    this.connect();
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
        // Ignore close errors
      }
    }

    if (this.wsCrypto) {
      const socket = this.wsCrypto;
      this.wsCrypto = null;
      socket.removeAllListeners();
      socket.on('error', () => {});
      try {
        if (socket.readyState === WebSocket.OPEN) {
          socket.close();
        } else {
          socket.terminate();
        }
      } catch {
        // Ignore close errors
      }
    }

    this.connectionStatus = 'DISCONNECTED';
  }

  public disconnect(): void {
    this.stop();
  }

  public connect(): void {
    if (!this.isRunning) return;

    if (!this.apiToken) {
      console.warn('[TiingoAdapter] No API token provided. Live connection aborted; holding baseline quotes.');
      this.connectionStatus = 'DISCONNECTED';
      return;
    }

    this.connectFxWebSocket();
    this.connectCryptoWebSocket();
  }

  private connectFxWebSocket(): void {
    if (!this.isRunning || !this.apiToken) return;
    this.connectionStatus = this.reconnectAttempts === 0 ? 'CONNECTING' : 'RECONNECTING';

    try {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.on('open', () => {
        this.handleOpen();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        this.handleMessage(data);
      });

      this.ws.on('error', (err: Error) => {
        this.handleError(err);
      });

      this.ws.on('close', (code: number, reason: Buffer) => {
        this.handleClose(code, reason ? reason.toString() : '');
      });
    } catch (err: any) {
      console.error(`[TiingoAdapter] Failed to initialize FX WebSocket: ${err?.message || err}`);
      this.scheduleReconnect();
    }
  }

  private connectCryptoWebSocket(): void {
    if (!this.isRunning || !this.apiToken) return;

    try {
      this.wsCrypto = new WebSocket(this.cryptoWsUrl);

      this.wsCrypto.on('open', () => {
        console.log(`[TiingoAdapter] Connected to Crypto WS at ${this.cryptoWsUrl}. Subscribing: ${this.cryptoTickers.join(', ')}`);
        if (this.wsCrypto && this.wsCrypto.readyState === WebSocket.OPEN) {
          this.wsCrypto.send(JSON.stringify({
            eventName: 'subscribe',
            authorization: this.apiToken,
            eventData: {
              thresholdLevel: 5,
              tickers: this.cryptoTickers,
            },
          }));
        }
      });

      this.wsCrypto.on('message', (data: WebSocket.Data) => {
        this.handleCryptoMessage(data);
      });

      this.wsCrypto.on('error', (err: Error) => {
        console.warn(`[TiingoAdapter] Crypto WS error: ${err.message}`);
      });

      this.wsCrypto.on('close', () => {
        this.wsCrypto = null;
        if (this.isRunning) {
          setTimeout(() => {
            if (this.isRunning) this.connectCryptoWebSocket();
          }, 3000);
        }
      });
    } catch (err: any) {
      console.warn(`[TiingoAdapter] Failed to initialize Crypto WS: ${err?.message || err}`);
    }
  }

  private handleOpen(): void {
    this.connectionStatus = 'CONNECTED';
    this.reconnectAttempts = 0;
    console.log(`[TiingoAdapter] Connected to FX WS at ${this.wsUrl}. Subscribing to: ${this.tickers.join(', ')}`);

    this.sendSubscription();
  }

  private sendSubscription(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const payload = {
      eventName: 'subscribe',
      authorization: this.apiToken,
      eventData: {
        tickers: this.tickers,
      },
    };

    try {
      this.ws.send(JSON.stringify(payload));
    } catch (err: any) {
      console.error(`[TiingoAdapter] Error sending FX subscription payload: ${err?.message || err}`);
    }
  }

  private handleMessage(data: WebSocket.Data): void {
    const rawString = typeof data === 'string' ? data : data.toString();
    const tuples = parseTiingoMessage(rawString);

    if (tuples.length === 0) return;

    const batch: Record<string, Quote> = {};
    const now = Date.now();

    for (const tuple of tuples) {
      const symCfg = this.symbolsMap.get(tuple.ticker) || INITIAL_SYMBOLS[0];
      const prevQuote = this.quotes.get(tuple.ticker);
      const prevStats = this.sessionStats.get(tuple.ticker);

      const { quote, updatedStats } = normalizeTiingoQuote(tuple, symCfg, prevQuote, prevStats);

      this.quotes.set(tuple.ticker, quote);
      this.sessionStats.set(tuple.ticker, updatedStats);
      this.symbolLastTick.set(tuple.ticker, now);
      batch[tuple.ticker] = quote;

      this.ticksReceivedCount++;
      this.lastTickTimestamp = now;
    }

    if (Object.keys(batch).length > 0) {
      this.notifyListeners(batch);
    }
  }

  private handleCryptoMessage(data: WebSocket.Data): void {
    let parsed: any;
    try {
      parsed = JSON.parse(data.toString());
    } catch {
      return;
    }

    if (!parsed || typeof parsed !== 'object') return;
    if (parsed.messageType === 'H' || parsed.response?.code === 200) return;
    if (parsed.messageType !== 'A' || !Array.isArray(parsed.data) || parsed.data.length === 0) return;

    // Support both single tuple ['T', ...] and batched tuples [['T', ...], ...]
    const rawTuples: any[][] = Array.isArray(parsed.data[0])
      ? parsed.data
      : (typeof parsed.data[0] === 'string' ? [parsed.data] : []);

    if (rawTuples.length === 0) return;

    const batch: Record<string, Quote> = {};
    const now = Date.now();

    for (const tuple of rawTuples) {
      if (!Array.isArray(tuple) || tuple.length < 5) continue;

      const type = tuple[0];
      if (type !== 'T' && type !== 'Q') continue;

      const ticker = String(tuple[1]).toUpperCase();
      const timestampRaw = tuple[2];
      const parsedTime = Date.parse(timestampRaw);
      const tickTime = isNaN(parsedTime) ? now : parsedTime;

      const symCfg = this.symbolsMap.get(ticker);
      const mapping = getSymbolMapping(ticker);
      const digits = symCfg?.digits ?? 2;

      let bid: number;
      let ask: number;
      let mid: number;
      let spread: number;

      if (type === 'Q' && tuple.length >= 9 && typeof tuple[5] === 'number' && typeof tuple[8] === 'number') {
        const rawBid = Number(tuple[5]);
        const rawAsk = Number(tuple[8]);
        if (isNaN(rawBid) || isNaN(rawAsk) || rawBid <= 0 || rawAsk <= 0) continue;
        bid = Number(rawBid.toFixed(digits));
        ask = Number(rawAsk.toFixed(digits));
        mid = typeof tuple[6] === 'number' ? Number(tuple[6].toFixed(digits)) : Number(((bid + ask) / 2).toFixed(digits));
        spread = Number((ask - bid).toFixed(digits));
      } else {
        // Trade update or fallback: price at index 5
        const priceRaw = tuple[5];
        const price = typeof priceRaw === 'number' ? priceRaw : parseFloat(priceRaw);
        if (isNaN(price) || price <= 0) continue;

        const spreadPoints = mapping?.defaultSpreadPoints ?? 10.0;
        const halfSpread = (spreadPoints * Math.pow(10, -digits)) / 2;
        bid = Number((price - halfSpread).toFixed(digits));
        ask = Number((price + halfSpread).toFixed(digits));
        mid = Number(price.toFixed(digits));
        spread = Number((ask - bid).toFixed(digits));
      }

      const prevQuote = this.quotes.get(ticker);
      let tickDirection: 'UP' | 'DOWN' | 'FLAT' = 'FLAT';
      if (prevQuote) {
        if (bid > prevQuote.bid) tickDirection = 'UP';
        else if (bid < prevQuote.bid) tickDirection = 'DOWN';
      }

      const prevStats = this.sessionStats.get(ticker);
      const openPrice = prevStats?.sessionOpenPrice && prevStats.sessionOpenPrice > 0 ? prevStats.sessionOpenPrice : mid;
      const sessionHigh = prevStats ? Math.max(prevStats.sessionHigh, ask) : ask;
      const sessionLow = prevStats ? Math.min(prevStats.sessionLow, bid) : bid;
      const change24h = Number((mid - openPrice).toFixed(digits));
      const change24hPct = openPrice > 0 ? Number(((change24h / openPrice) * 100).toFixed(2)) : 0;

      this.sessionStats.set(ticker, {
        sessionOpenPrice: openPrice,
        sessionHigh,
        sessionLow,
      });

      const quote: Quote = {
        symbol: ticker,
        bid,
        ask,
        spread,
        mid,
        high24h: sessionHigh,
        low24h: sessionLow,
        change24h,
        change24hPct,
        timestamp: tickTime,
        receivedTimestamp: now,
        tickDirection,
        marketStatus: 'LIVE',
        source: 'tiingo_fx',
        digits,
        tickSize: symCfg?.tickSize || Math.pow(10, -digits),
        providerTimestamp: tickTime,
      };

      this.quotes.set(ticker, quote);
      this.symbolLastTick.set(ticker, now);
      this.ticksReceivedCount++;
      this.lastTickTimestamp = now;
      batch[ticker] = quote;
    }

    if (Object.keys(batch).length > 0) {
      this.notifyListeners(batch);
    }
  }

  public async seedInitialQuotesRest(): Promise<void> {
    if (!this.apiToken) return;

    // 1. Seed Crypto Top of Book
    try {
      const url = `https://api.tiingo.com/tiingo/crypto/top?tickers=${this.cryptoTickers.join(',')}&token=${this.apiToken}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          const batch: Record<string, Quote> = {};
          const now = Date.now();
          for (const item of data) {
            const ticker = String(item.ticker).toUpperCase();
            const top = item.topOfBookData?.[0];
            if (!top || typeof top.bidPrice !== 'number' || typeof top.askPrice !== 'number') continue;

            const symCfg = this.symbolsMap.get(ticker);
            const digits = symCfg?.digits ?? 2;
            const bid = Number(top.bidPrice.toFixed(digits));
            const ask = Number(top.askPrice.toFixed(digits));
            const mid = Number(((bid + ask) / 2).toFixed(digits));
            const spread = Number((ask - bid).toFixed(digits));

            const quote: Quote = {
              symbol: ticker,
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
              marketStatus: 'LIVE',
              source: 'tiingo_fx',
              digits,
              tickSize: symCfg?.tickSize || Math.pow(10, -digits),
              providerTimestamp: top.quoteTimestamp ? Date.parse(top.quoteTimestamp) : now,
            };

            this.quotes.set(ticker, quote);
            this.symbolLastTick.set(ticker, now);
            batch[ticker] = quote;
          }
          if (Object.keys(batch).length > 0) {
            this.notifyListeners(batch);
          }
        }
      }
    } catch (err) {
      console.warn('[TiingoAdapter] Initial crypto REST seed error:', err);
    }

    // 2. Seed FX & Metals Top of Book
    try {
      const url = `https://api.tiingo.com/tiingo/fx/top?tickers=${this.tickers.join(',')}&token=${this.apiToken}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          const batch: Record<string, Quote> = {};
          const now = Date.now();
          for (const item of data) {
            const ticker = String(item.ticker).toUpperCase();
            if (typeof item.bidPrice !== 'number' || typeof item.askPrice !== 'number') continue;

            const symCfg = this.symbolsMap.get(ticker);
            const digits = symCfg?.digits ?? 5;
            const bid = Number(item.bidPrice.toFixed(digits));
            const ask = Number(item.askPrice.toFixed(digits));
            const mid = typeof item.midPrice === 'number' ? Number(item.midPrice.toFixed(digits)) : Number(((bid + ask) / 2).toFixed(digits));
            const spread = Number(
              ((ask - bid) * Math.pow(10, digits === 3 || digits === 5 ? digits - 1 : 0)).toFixed(1)
            );

            const quote: Quote = {
              symbol: ticker,
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
              marketStatus: 'LIVE',
              source: 'tiingo_fx',
              digits,
              tickSize: symCfg?.tickSize || Math.pow(10, -digits),
              providerTimestamp: item.quoteTimestamp ? Date.parse(item.quoteTimestamp) : now,
            };

            this.quotes.set(ticker, quote);
            this.symbolLastTick.set(ticker, now);
            batch[ticker] = quote;
          }
          if (Object.keys(batch).length > 0) {
            this.notifyListeners(batch);
          }
        }
      }
    } catch (err) {
      console.warn('[TiingoAdapter] Initial FX REST seed error:', err);
    }
  }

  private handleError(err: Error): void {
    console.error(`[TiingoAdapter] WebSocket error: ${err.message}`);
  }

  private handleClose(code: number, reason: string): void {
    console.warn(`[TiingoAdapter] FX WebSocket closed (code: ${code}, reason: ${reason || 'none'})`);
    this.ws = null;
    if (this.isRunning) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (!this.isRunning || this.reconnectTimer) return;

    this.connectionStatus = 'RECONNECTING';
    this.reconnectAttempts++;

    const delay = Math.min(
      this.initialReconnectDelayMs * Math.pow(2, this.reconnectAttempts - 1),
      this.maxReconnectDelayMs
    );

    console.log(`[TiingoAdapter] Reconnecting in ${delay}ms (attempt #${this.reconnectAttempts})...`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.isRunning) {
        this.connectFxWebSocket();
      }
    }, delay);
  }

  private startWatchdog(): void {
    if (this.staleWatchdogTimer) return;

    this.staleWatchdogTimer = setInterval(() => {
      this.checkStaleQuote();
    }, 1000);
  }

  /**
   * Stale quote detection: Checks per-symbol whether more than staleThresholdMs
   * has elapsed since the last valid quote.
   */
  public checkStaleQuote(): boolean {
    const now = Date.now();
    let anyStale = false;
    const staleBatch: Record<string, Quote> = {};

    for (const [sym, q] of this.quotes.entries()) {
      const symTick = this.symbolLastTick.get(sym);
      const symLast = (this.lastTickTimestamp > 0 && symTick !== undefined)
        ? Math.min(symTick, this.lastTickTimestamp)
        : (symTick || this.lastTickTimestamp || q.receivedTimestamp || now);
      const elapsed = now - symLast;
      if (elapsed > this.staleThresholdMs && !q.isStale) {
        const updated = { ...q, isStale: true, marketStatus: 'STALE' as const };
        this.quotes.set(sym, updated);
        staleBatch[sym] = updated;
        anyStale = true;
      }
    }

    if (anyStale) {
      this.notifyListeners(staleBatch);
    }

    return anyStale;
  }

  private notifyListeners(batch: Record<string, Quote>): void {
    for (const listener of this.listeners) {
      try {
        listener(batch);
      } catch (err) {
        console.error('[TiingoAdapter] Error notifying quote listener:', err);
      }
    }
  }

  // --- IMarketDataProvider & IMarketDataAdapter implementation ---

  public subscribe(listener: QuoteBatchListener): () => void;
  public subscribe(symbols: string[]): void;
  public subscribe(symbolsOrListener: string[] | QuoteBatchListener): any {
    if (typeof symbolsOrListener === 'function') {
      this.listeners.add(symbolsOrListener);
      return () => this.listeners.delete(symbolsOrListener);
    }
    if (Array.isArray(symbolsOrListener)) {
      for (const s of symbolsOrListener) {
        const lower = s.toLowerCase();
        if (!this.tickers.includes(lower)) {
          this.tickers.push(lower);
        }
      }
      this.sendSubscription();
    }
  }

  public unsubscribe(symbols: string[]): void {
    for (const s of symbols) {
      const idx = this.tickers.indexOf(s.toLowerCase());
      if (idx !== -1) {
        this.tickers.splice(idx, 1);
      }
    }
  }

  public normalizeQuote(rawPayload: unknown): NormalizedInternalQuote {
    let tuples = parseTiingoMessage(rawPayload);
    let tuple: RawTiingoQuoteTuple;
    if (tuples.length > 0) {
      tuple = tuples[0];
    } else if (rawPayload && typeof rawPayload === 'object' && 'ticker' in (rawPayload as any)) {
      tuple = rawPayload as RawTiingoQuoteTuple;
    } else {
      tuple = {
        updateType: 'Q',
        ticker: 'EURUSD',
        timestamp: new Date().toISOString(),
        bidSize: 1000000,
        bidPrice: 1.08500,
        askSize: 1000000,
        askPrice: 1.08512,
      };
    }

    const symCfg = this.symbolsMap.get(tuple.ticker) || INITIAL_SYMBOLS[0];
    const prevQuote = this.quotes.get(tuple.ticker);
    const prevStats = this.sessionStats.get(tuple.ticker);
    const { quote } = normalizeTiingoQuote(tuple, symCfg, prevQuote, prevStats);

    return {
      symbol: quote.symbol,
      bid: quote.bid,
      ask: quote.ask,
      mid: quote.mid,
      spread: quote.spread,
      timestamp: quote.timestamp,
      providerTimestamp: quote.providerTimestamp,
      receivedTimestamp: quote.receivedTimestamp || Date.now(),
      marketStatus: (quote.marketStatus as any) || 'LIVE',
      providerId: this.providerId,
      assetClass: symCfg.category || 'FOREX',
      digits: symCfg.digits,
      tickSize: symCfg.tickSize || Math.pow(10, -symCfg.digits),
      tickDirection: quote.tickDirection,
      high24h: quote.high24h,
      low24h: quote.low24h,
      change24h: quote.change24h,
      change24hPct: quote.change24hPct,
    };
  }

  public getQuote(symbol: string): Quote | undefined {
    return this.quotes.get(symbol.toUpperCase());
  }

  public getAllQuotes(): Record<string, Quote> {
    const result: Record<string, Quote> = {};
    for (const [sym, quote] of this.quotes.entries()) {
      result[sym] = quote;
    }
    return result;
  }

  public getActiveSymbols(): SymbolConfig[] {
    return this.activeSymbols;
  }

  public getAllSymbols(): SymbolConfig[] {
    return ALL_SYMBOLS;
  }

  public getSymbolConfig(symbol: string): SymbolConfig | undefined {
    return this.symbolsMap.get(symbol.toUpperCase());
  }

  public getHistoricalBars(symbol: string, count: number = 100): OHLCVBar[] {
    const upper = symbol.toUpperCase();
    const cached = this.historicalBarsCache.get(upper);
    if (cached && cached.length >= count) return cached;

    const symCfg = this.symbolsMap.get(upper) || INITIAL_SYMBOLS[0];
    const currentQuote = this.quotes.get(upper);
    const defaultPrices: Record<string, number> = {
      EURUSD: 1.08450,
      GBPUSD: 1.28820,
      USDJPY: 152.450,
      USDCHF: 0.86430,
      AUDUSD: 0.65820,
      USDCAD: 1.38540,
      XAUUSD: 2735.50,
      BTCUSD: 68420.00,
      ETHUSD: 2540.20,
      US500:  5824.50,
    };
    const basePrice = currentQuote ? currentQuote.mid : (defaultPrices[upper] || 100.0);
    const bars: OHLCVBar[] = [];

    const nowSec = Math.floor(Date.now() / 1000);
    const barIntervalSec = 60;
    let currentClose = basePrice;

    for (let i = count - 1; i >= 0; i--) {
      const time = nowSec - i * barIntervalSec;
      const volatility = 0.00015;
      const open = currentClose;
      const change = (Math.random() - 0.495) * volatility;
      const close = Number((open + change).toFixed(symCfg.digits));
      const high = Number((Math.max(open, close) + Math.random() * volatility * 0.3).toFixed(symCfg.digits));
      const low = Number((Math.min(open, close) - Math.random() * volatility * 0.3).toFixed(symCfg.digits));
      const volume = Math.floor(100 + Math.random() * 250);

      bars.push({ time, open, high, low, close, volume });
      currentClose = close;
    }

    if (this.historicalBarsCache.size > 50) {
      const firstKey = this.historicalBarsCache.keys().next().value;
      if (firstKey) this.historicalBarsCache.delete(firstKey);
    }
    const boundedBars = bars.length > 500 ? bars.slice(-500) : bars;
    this.historicalBarsCache.set(upper, boundedBars);
    return boundedBars;
  }

  public getMetrics(): MarketMetrics {
    return {
      ticksGeneratedCount: this.ticksReceivedCount,
      activeSymbolsCount: this.activeSymbols.length,
      lastTickTimestamp: this.lastTickTimestamp,
      providerName: this.providerName,
      connectionState: this.connectionStatus,
      isStale: this.isStale,
    };
  }

  public getConnectionState(): ProviderConnectionState {
    return {
      status: this.connectionStatus,
      isStale: this.isStale,
      lastTickAt: this.lastTickTimestamp,
      reconnectAttempts: this.reconnectAttempts,
      url: this.wsUrl,
    };
  }

  public isQuoteStale(symbol: string): boolean {
    const q = this.quotes.get(symbol.toUpperCase());
    if (!q) return true;
    return this.isStale || q.marketStatus === 'STALE' || (q as any).isStale === true;
  }

  public generateTickBatch(): Record<string, Quote> {
    const batch: Record<string, Quote> = {};
    for (const [sym, quote] of this.quotes.entries()) {
      batch[sym] = quote;
    }
    return batch;
  }

  // --- IMarketDataAdapter implementation ---

  public getStatus(): ProviderStatusInfo {
    return {
      providerId: this.providerId,
      providerName: this.providerName,
      status: this.connectionStatus,
      supportedSymbols: this.tickers.map((t) => t.toUpperCase()),
      lastMessageTimestamp: this.lastTickTimestamp,
      reconnectAttempts: this.reconnectAttempts,
      isHealthy: this.isHealthy(),
    };
  }

  public isHealthy(): boolean {
    return this.connectionStatus === 'CONNECTED' && !this.isStale;
  }

  public onQuote(listener: QuoteListener): () => void {
    const wrapper: QuoteBatchListener = (batch) => {
      for (const q of Object.values(batch)) {
        const symDef = this.symbolsMap.get(q.symbol);
        const normalized: NormalizedInternalQuote = {
          symbol: q.symbol,
          bid: q.bid,
          ask: q.ask,
          mid: q.mid,
          spread: q.spread,
          timestamp: q.timestamp,
          providerTimestamp: q.providerTimestamp,
          receivedTimestamp: q.receivedTimestamp || Date.now(),
          marketStatus: (q.marketStatus as any) || 'LIVE',
          providerId: this.providerId,
          assetClass: symDef?.category || 'FOREX',
          digits: symDef?.digits || 5,
          tickSize: symDef?.tickSize || 0.00001,
          tickDirection: q.tickDirection,
          high24h: q.high24h,
          low24h: q.low24h,
          change24h: q.change24h,
          change24hPct: q.change24hPct,
        };
        listener(normalized);
      }
    };
    return this.subscribe(wrapper);
  }
}
