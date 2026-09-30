/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * SERVER-AUTHORITATIVE MARKET ENGINE
 * Deterministic quote generation and controlled tick loop.
 */

import { OHLCVBar, Quote, SymbolConfig } from '../types/trading';
import type { IMarketDataProvider, MarketMetrics, QuoteBatchListener } from './IMarketDataProvider';

export const INITIAL_SYMBOLS: SymbolConfig[] = [
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
    id: 's_xauusd',
    symbol: 'XAUUSD',
    name: 'Gold (Troy Ounce) / USD',
    category: 'METALS',
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
    description: 'Commodity currency.',
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
    description: 'Smart contract layer-1 crypto.',
  },
  {
    id: 's_us500',
    symbol: 'US500',
    name: 'S&P 500 Index Cash',
    category: 'INDICES',
    digits: 2,
    contractSize: 10,
    minVolume: 0.1,
    maxVolume: 50.0,
    volumeStep: 0.1,
    defaultSpreadPoints: 40.0,
    baseCurrency: 'USD',
    quoteCurrency: 'USD',
    description: 'US Broad market equities index.',
  },
];

function generateExtendedSymbolList(): SymbolConfig[] {
  const list = [...INITIAL_SYMBOLS];
  const fxBases = ['NZD', 'EUR', 'GBP', 'AUD', 'CAD', 'CHF', 'JPY', 'SEK', 'NOK', 'SGD'];
  const fxQuotes = ['USD', 'EUR', 'GBP', 'JPY', 'CHF'];

  for (const b of fxBases) {
    for (const q of fxQuotes) {
      if (b === q) continue;
      const pair = `${b}${q}`;
      if (list.some((s) => s.symbol === pair)) continue;

      list.push({
        id: `s_${pair.toLowerCase()}`,
        symbol: pair,
        name: `${b} / ${q}`,
        category: 'FOREX',
        digits: q === 'JPY' ? 3 : 5,
        contractSize: 100000,
        minVolume: 0.01,
        maxVolume: 50.0,
        volumeStep: 0.01,
        defaultSpreadPoints: q === 'JPY' ? 2.5 : 2.0,
        baseCurrency: b,
        quoteCurrency: q,
        description: `Cross pair ${pair}`,
      });

      if (list.length >= 50) return list;
    }
  }

  const cryptoExtras = ['SOLUSD', 'XRPUSD', 'ADAUSD', 'AVAXUSD', 'LINKUSD', 'DOTUSD', 'DOGEUSD'];
  for (const c of cryptoExtras) {
    if (list.length >= 50) break;
    list.push({
      id: `s_${c.toLowerCase()}`,
      symbol: c,
      name: `${c} Perpetual`,
      category: 'CRYPTO',
      digits: 2,
      contractSize: 10,
      minVolume: 0.1,
      maxVolume: 100.0,
      volumeStep: 0.1,
      defaultSpreadPoints: 15.0,
      baseCurrency: c.substring(0, 3),
      quoteCurrency: 'USD',
      description: 'High volatility crypto asset',
    });
  }

  return list;
}

export const ALL_SYMBOLS = generateExtendedSymbolList();

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

  constructor(initialSymbolCount: number = 10) {
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
        };
        this.currentQuotes.set(sym.symbol, quote);
      }
    }
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
      if (Math.random() < 0.25 && this.activeSymbols.length > 10) continue;

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

    this.historicalBarsCache.set(symbol, bars);
    return bars;
  }
}
