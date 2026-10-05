/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * SERVER-AUTHORITATIVE MARKET ENGINE (18 ACTIVE INSTRUMENTS)
 * Deterministic quote generation and controlled tick loop.
 * 
 * Final 18 Active Instruments:
 * FOREX (10): EURUSD, GBPUSD, USDJPY, USDCHF, AUDUSD, USDCAD, NZDUSD, USDCNH, EURJPY, GBPJPY
 * CRYPTO (5): BTCUSD, ETHUSD, BNBUSD, SOLUSD, XRPUSD
 * COMMODITIES (3): XAUUSD, XAGUSD, WTIUSD
 */

import { OHLCVBar, Quote, SymbolConfig } from '../types/trading';
import type { IMarketDataProvider, MarketMetrics, QuoteBatchListener } from './IMarketDataProvider';

export const INITIAL_SYMBOLS: SymbolConfig[] = [
  // FOREX (10)
  {
    id: 's_eurusd',
    symbol: 'EURUSD',
    name: 'Euro / US Dollar',
    category: 'FOREX',
    digits: 5,
    contractSize: 100000,
    minVolume: 0.01,
    maxVolume: 100.0,
    volumeStep: 0.01,
    defaultSpreadPoints: 1.2,
    baseCurrency: 'EUR',
    quoteCurrency: 'USD',
    description: 'Major FX pair with tight institutional spreads.',
  },
  {
    id: 's_gbpusd',
    symbol: 'GBPUSD',
    name: 'British Pound / US Dollar',
    category: 'FOREX',
    digits: 5,
    contractSize: 100000,
    minVolume: 0.01,
    maxVolume: 100.0,
    volumeStep: 0.01,
    defaultSpreadPoints: 1.8,
    baseCurrency: 'GBP',
    quoteCurrency: 'USD',
    description: 'Cable: High intraday liquidity and volatility.',
  },
  {
    id: 's_usdjpy',
    symbol: 'USDJPY',
    name: 'US Dollar / Japanese Yen',
    category: 'FOREX',
    digits: 3,
    contractSize: 100000,
    minVolume: 0.01,
    maxVolume: 100.0,
    volumeStep: 0.01,
    defaultSpreadPoints: 1.5,
    baseCurrency: 'USD',
    quoteCurrency: 'JPY',
    description: 'Asian session benchmark FX instrument.',
  },
  {
    id: 's_usdchf',
    symbol: 'USDCHF',
    name: 'US Dollar / Swiss Franc',
    category: 'FOREX',
    digits: 5,
    contractSize: 100000,
    minVolume: 0.01,
    maxVolume: 100.0,
    volumeStep: 0.01,
    defaultSpreadPoints: 1.5,
    baseCurrency: 'USD',
    quoteCurrency: 'CHF',
    description: 'Safe-haven currency pair.',
  },
  {
    id: 's_audusd',
    symbol: 'AUDUSD',
    name: 'Australian Dollar / USD',
    category: 'FOREX',
    digits: 5,
    contractSize: 100000,
    minVolume: 0.01,
    maxVolume: 100.0,
    volumeStep: 0.01,
    defaultSpreadPoints: 1.4,
    baseCurrency: 'AUD',
    quoteCurrency: 'USD',
    description: 'Commodity currency benchmark.',
  },
  {
    id: 's_usdcad',
    symbol: 'USDCAD',
    name: 'US Dollar / Canadian Dollar',
    category: 'FOREX',
    digits: 5,
    contractSize: 100000,
    minVolume: 0.01,
    maxVolume: 100.0,
    volumeStep: 0.01,
    defaultSpreadPoints: 1.6,
    baseCurrency: 'USD',
    quoteCurrency: 'CAD',
    description: 'North American trade pair.',
  },
  {
    id: 's_nzdusd',
    symbol: 'NZDUSD',
    name: 'New Zealand Dollar / US Dollar',
    category: 'FOREX',
    digits: 5,
    contractSize: 100000,
    minVolume: 0.01,
    maxVolume: 100.0,
    volumeStep: 0.01,
    defaultSpreadPoints: 1.8,
    baseCurrency: 'NZD',
    quoteCurrency: 'USD',
    description: 'Kiwi: Asia-Pacific commodity benchmark.',
  },
  {
    id: 's_usdcnh',
    symbol: 'USDCNH',
    name: 'US Dollar / Chinese Yuan (Offshore)',
    category: 'FOREX',
    digits: 4,
    contractSize: 100000,
    minVolume: 0.01,
    maxVolume: 100.0,
    volumeStep: 0.01,
    defaultSpreadPoints: 2.5,
    baseCurrency: 'USD',
    quoteCurrency: 'CNH',
    description: 'Offshore Chinese Yuan / RMB currency instrument.',
  },
  {
    id: 's_eurjpy',
    symbol: 'EURJPY',
    name: 'Euro / Japanese Yen',
    category: 'FOREX',
    digits: 3,
    contractSize: 100000,
    minVolume: 0.01,
    maxVolume: 100.0,
    volumeStep: 0.01,
    defaultSpreadPoints: 2.0,
    baseCurrency: 'EUR',
    quoteCurrency: 'JPY',
    description: 'Major cross pair with dynamic trends.',
  },
  {
    id: 's_gbpjpy',
    symbol: 'GBPJPY',
    name: 'British Pound / Japanese Yen',
    category: 'FOREX',
    digits: 3,
    contractSize: 100000,
    minVolume: 0.01,
    maxVolume: 100.0,
    volumeStep: 0.01,
    defaultSpreadPoints: 2.4,
    baseCurrency: 'GBP',
    quoteCurrency: 'JPY',
    description: 'Geppy: High-volatility cross pair.',
  },

  // CRYPTO (5)
  {
    id: 's_btcusd',
    symbol: 'BTCUSD',
    name: 'Bitcoin / US Dollar',
    category: 'CRYPTO',
    digits: 2,
    contractSize: 1,
    minVolume: 0.01,
    maxVolume: 10.0,
    volumeStep: 0.01,
    defaultSpreadPoints: 120.0,
    baseCurrency: 'BTC',
    quoteCurrency: 'USD',
    description: 'Crypto flagship with 24/7 continuous price action.',
  },
  {
    id: 's_ethusd',
    symbol: 'ETHUSD',
    name: 'Ethereum / US Dollar',
    category: 'CRYPTO',
    digits: 2,
    contractSize: 1,
    minVolume: 0.01,
    maxVolume: 50.0,
    volumeStep: 0.01,
    defaultSpreadPoints: 20.0,
    baseCurrency: 'ETH',
    quoteCurrency: 'USD',
    description: 'Smart contract layer-1 crypto flagship.',
  },
  {
    id: 's_bnbusd',
    symbol: 'BNBUSD',
    name: 'Binance Coin / US Dollar',
    category: 'CRYPTO',
    digits: 2,
    contractSize: 1,
    minVolume: 0.01,
    maxVolume: 50.0,
    volumeStep: 0.01,
    defaultSpreadPoints: 15.0,
    baseCurrency: 'BNB',
    quoteCurrency: 'USD',
    description: 'Binance ecosystem token.',
  },
  {
    id: 's_solusd',
    symbol: 'SOLUSD',
    name: 'Solana / US Dollar',
    category: 'CRYPTO',
    digits: 2,
    contractSize: 1,
    minVolume: 0.01,
    maxVolume: 100.0,
    volumeStep: 0.01,
    defaultSpreadPoints: 10.0,
    baseCurrency: 'SOL',
    quoteCurrency: 'USD',
    description: 'High-throughput layer-1 blockchain.',
  },
  {
    id: 's_xrpusd',
    symbol: 'XRPUSD',
    name: 'Ripple / US Dollar',
    category: 'CRYPTO',
    digits: 4,
    contractSize: 1,
    minVolume: 1.0,
    maxVolume: 10000.0,
    volumeStep: 1.0,
    defaultSpreadPoints: 5.0,
    baseCurrency: 'XRP',
    quoteCurrency: 'USD',
    description: 'Cross-border digital settlement asset.',
  },

  // COMMODITIES (3)
  {
    id: 's_xauusd',
    symbol: 'XAUUSD',
    name: 'Gold (Troy Ounce) / USD',
    category: 'COMMODITIES',
    digits: 2,
    contractSize: 100,
    minVolume: 0.01,
    maxVolume: 50.0,
    volumeStep: 0.01,
    defaultSpreadPoints: 25.0,
    baseCurrency: 'XAU',
    quoteCurrency: 'USD',
    description: 'Spot Gold with high pip value and fast momentum.',
  },
  {
    id: 's_xagusd',
    symbol: 'XAGUSD',
    name: 'Silver (Troy Ounce) / USD',
    category: 'COMMODITIES',
    digits: 3,
    contractSize: 5000,
    minVolume: 0.01,
    maxVolume: 50.0,
    volumeStep: 0.01,
    defaultSpreadPoints: 3.5,
    baseCurrency: 'XAG',
    quoteCurrency: 'USD',
    description: 'Spot Silver with industrial and monetary demand.',
  },
  {
    id: 's_wtiusd',
    symbol: 'WTIUSD',
    name: 'WTI Crude Oil / US Dollar',
    category: 'COMMODITIES',
    digits: 2,
    contractSize: 1000,
    minVolume: 0.01,
    maxVolume: 50.0,
    volumeStep: 0.01,
    defaultSpreadPoints: 4.0,
    baseCurrency: 'WTI',
    quoteCurrency: 'USD',
    description: 'West Texas Intermediate Light Sweet Crude Oil benchmark.',
  },
];

export const ALL_SYMBOLS = [...INITIAL_SYMBOLS];

export const BASE_PRICES: Record<string, { price: number; step: number }> = {
  EURUSD: { price: 1.08450, step: 0.00008 },
  GBPUSD: { price: 1.28820, step: 0.00012 },
  USDJPY: { price: 152.450, step: 0.025 },
  USDCHF: { price: 0.86430, step: 0.00008 },
  AUDUSD: { price: 0.65820, step: 0.00009 },
  USDCAD: { price: 1.38540, step: 0.00010 },
  NZDUSD: { price: 0.59820, step: 0.00009 },
  USDCNH: { price: 7.1245, step: 0.0008 },
  EURJPY: { price: 165.350, step: 0.030 },
  GBPJPY: { price: 196.420, step: 0.035 },
  BTCUSD: { price: 68420.00, step: 18.50 },
  ETHUSD: { price: 2540.20, step: 1.20 },
  BNBUSD: { price: 585.50, step: 0.45 },
  SOLUSD: { price: 175.40, step: 0.25 },
  XRPUSD: { price: 0.5420, step: 0.0008 },
  XAUUSD: { price: 2735.50, step: 0.45 },
  XAGUSD: { price: 32.450, step: 0.015 },
  WTIUSD: { price: 71.80, step: 0.08 },
};

export type { QuoteBatchListener };

export class MarketEngine implements IMarketDataProvider {
  public readonly providerName: string = 'SyntheticMarketSimulator';
  private symbolsMap: Map<string, SymbolConfig> = new Map();
  private activeSymbols: SymbolConfig[] = [];
  private currentQuotes: Map<string, Quote> = new Map();
  private historicalBarsCache: Map<string, OHLCVBar[]> = new Map();
  private listeners: Set<QuoteBatchListener> = new Set();
  private timer: NodeJS.Timeout | null = null;
  private intervalMs: number = 80;
  private ticksGeneratedCount: number = 0;
  private lastTickTimestamp: number = Date.now();

  constructor(initialSymbolCount: number = 18) {
    for (const sym of ALL_SYMBOLS) {
      this.symbolsMap.set(sym.symbol, sym);
    }
    this.setActiveSymbolCount(initialSymbolCount);
    this.initializeQuotes();
  }

  public setActiveSymbolCount(count: number): void {
    const targetCount = Math.min(Math.max(count, 5), ALL_SYMBOLS.length);
    this.activeSymbols = ALL_SYMBOLS.slice(0, targetCount);
    this.initializeQuotes();
  }

  public getActiveSymbols(): SymbolConfig[] {
    return this.activeSymbols;
  }

  public getAllSymbols(): SymbolConfig[] {
    return ALL_SYMBOLS;
  }

  public getSymbolConfig(symbol: string): SymbolConfig | undefined {
    return this.symbolsMap.get(symbol);
  }

  private initializeQuotes(): void {
    const now = Date.now();
    for (const sym of this.activeSymbols) {
      if (!this.currentQuotes.has(sym.symbol)) {
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
          marketStatus: 'LIVE',
          isStale: false,
          source: 'synthetic',
        };
        this.currentQuotes.set(sym.symbol, quote);
      }
    }
  }

  public setQuote(quote: Quote): void {
    this.currentQuotes.set(quote.symbol, quote);
  }

  public getQuote(symbol: string): Quote | undefined {
    return this.currentQuotes.get(symbol);
  }

  public getAllQuotes(): Record<string, Quote> {
    const result: Record<string, Quote> = {};
    for (const [sym, quote] of this.currentQuotes.entries()) {
      result[sym] = quote;
    }
    return result;
  }

  public subscribe(listener: QuoteBatchListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      this.generateTickBatch();
    }, this.intervalMs);
  }

  public stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public setUpdateInterval(intervalMs: number): void {
    this.intervalMs = intervalMs;
    if (this.timer !== null) {
      this.stop();
      this.start();
    }
  }

  public getMetrics(): {
    ticksGeneratedCount: number;
    activeSymbolsCount: number;
    intervalMs: number;
    lastTickTimestamp: number;
  } {
    return {
      ticksGeneratedCount: this.ticksGeneratedCount,
      activeSymbolsCount: this.activeSymbols.length,
      intervalMs: this.intervalMs,
      lastTickTimestamp: this.lastTickTimestamp,
    };
  }

  public generateTickBatch(): Record<string, Quote> {
    const now = Date.now();
    const updatedBatch: Record<string, Quote> = {};

    for (const sym of this.activeSymbols) {
      const current = this.currentQuotes.get(sym.symbol);
      if (!current) continue;

      const seed = BASE_PRICES[sym.symbol] || { price: 100.0, step: 0.05 };
      const maxDelta = seed.step;
      const meanReversionDrift = (seed.price - current.mid) * 0.002;
      const randomNoise = (Math.random() - 0.498) * maxDelta;
      const newMid = current.mid + meanReversionDrift + randomNoise;

      const spreadOffset = (sym.defaultSpreadPoints * Math.pow(10, -sym.digits)) / 2;
      const newBid = Number((newMid - spreadOffset).toFixed(sym.digits));
      const newAsk = Number((newMid + spreadOffset).toFixed(sym.digits));

      const direction = newBid > current.bid ? 'UP' : newBid < current.bid ? 'DOWN' : 'FLAT';
      const change24h = Number((newMid - seed.price).toFixed(sym.digits));
      const change24hPct = Number(((change24h / seed.price) * 100).toFixed(2));

      const updatedQuote: Quote = {
        ...current,
        bid: newBid,
        ask: newAsk,
        mid: newMid,
        high24h: Math.max(current.high24h, newAsk),
        low24h: Math.min(current.low24h, newBid),
        change24h,
        change24hPct,
        timestamp: now,
        tickDirection: direction,
        marketStatus: current.marketStatus || 'LIVE',
        isStale: current.isStale ?? false,
      };

      this.currentQuotes.set(sym.symbol, updatedQuote);
      updatedBatch[sym.symbol] = updatedQuote;
      this.ticksGeneratedCount++;
    }

    this.lastTickTimestamp = now;

    if (Object.keys(updatedBatch).length > 0) {
      for (const listener of this.listeners) {
        listener(updatedBatch);
      }
    }

    return updatedBatch;
  }

  public getHistoricalBars(symbol: string, count: number = 100): OHLCVBar[] {
    const cached = this.historicalBarsCache.get(symbol);
    if (cached && cached.length >= count) return cached;

    const symCfg = this.symbolsMap.get(symbol) || INITIAL_SYMBOLS[0];
    const seed = BASE_PRICES[symbol] || { price: 100.0, step: 0.05 };
    const bars: OHLCVBar[] = [];

    const nowSec = Math.floor(Date.now() / 1000);
    const barIntervalSec = 60;
    let currentClose = seed.price * 0.995;

    for (let i = count - 1; i >= 0; i--) {
      const time = nowSec - i * barIntervalSec;
      const volatility = seed.step * 4;
      const open = currentClose;
      const change = (Math.random() - 0.49) * volatility;
      const close = Number((open + change).toFixed(symCfg.digits));
      const high = Number((Math.max(open, close) + Math.random() * volatility * 0.5).toFixed(symCfg.digits));
      const low = Number((Math.min(open, close) - Math.random() * volatility * 0.5).toFixed(symCfg.digits));
      const volume = Math.floor(50 + Math.random() * 200);

      bars.push({ time, open, high, low, close, volume });
      currentClose = close;
    }

    if (this.historicalBarsCache.size > 50) {
      const firstKey = this.historicalBarsCache.keys().next().value;
      if (firstKey) this.historicalBarsCache.delete(firstKey);
    }
    const boundedBars = bars.length > 500 ? bars.slice(-500) : bars;
    this.historicalBarsCache.set(symbol, boundedBars);
    return boundedBars;
  }
}
