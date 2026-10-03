/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * SERVER-AUTHORITATIVE INSTRUMENT / SYMBOL REGISTRY (18 INSTRUMENTS)
 * Single authoritative source of truth for instrument definitions, asset classes,
 * price precision (digits), tick size, contract sizes, provider symbol mappings, and trading status.
 * 
 * Final 18 Active Instruments:
 * FOREX (10): EURUSD, GBPUSD, USDJPY, USDCHF, AUDUSD, USDCAD, NZDUSD, USDCNH, EURJPY, GBPJPY
 * CRYPTO (5): BTCUSD, ETHUSD, BNBUSD, SOLUSD, XRPUSD
 * COMMODITIES (3): XAUUSD, XAGUSD, WTIUSD
 */

import { AssetCategory, SymbolConfig } from '../types/trading';

export type TradingStatus = 'TRADING' | 'HALTED' | 'CLOSE_ONLY' | 'UNAVAILABLE';

export interface InstrumentDefinition extends SymbolConfig {
  tickSize: number;
  marketDataProvider: string;          // 'tiingo_fx' | 'twelve_data' | 'unassigned'
  providerSymbolMapping: Record<string, string>;
  enabled: boolean;
  tradingStatus: TradingStatus;
}

export const CANONICAL_INSTRUMENTS: InstrumentDefinition[] = [
  // --- FOREX — 10 ---
  {
    id: 's_eurusd',
    symbol: 'EURUSD',
    name: 'Euro / US Dollar',
    category: 'FOREX',
    digits: 5,
    tickSize: 0.00001,
    contractSize: 100000,
    minVolume: 0.01,
    maxVolume: 100.0,
    volumeStep: 0.01,
    defaultSpreadPoints: 1.2,
    baseCurrency: 'EUR',
    quoteCurrency: 'USD',
    description: 'Major FX pair with tight institutional spreads.',
    enabled: true,
    marketDataProvider: 'tiingo_fx',
    providerSymbolMapping: { tiingo_fx: 'eurusd', twelve_data: 'EUR/USD' },
    tradingStatus: 'TRADING',
  },
  {
    id: 's_gbpusd',
    symbol: 'GBPUSD',
    name: 'British Pound / US Dollar',
    category: 'FOREX',
    digits: 5,
    tickSize: 0.00001,
    contractSize: 100000,
    minVolume: 0.01,
    maxVolume: 100.0,
    volumeStep: 0.01,
    defaultSpreadPoints: 1.8,
    baseCurrency: 'GBP',
    quoteCurrency: 'USD',
    description: 'Cable: High intraday liquidity and volatility.',
    enabled: true,
    marketDataProvider: 'tiingo_fx',
    providerSymbolMapping: { tiingo_fx: 'gbpusd', twelve_data: 'GBP/USD' },
    tradingStatus: 'TRADING',
  },
  {
    id: 's_usdjpy',
    symbol: 'USDJPY',
    name: 'US Dollar / Japanese Yen',
    category: 'FOREX',
    digits: 3,
    tickSize: 0.001,
    contractSize: 100000,
    minVolume: 0.01,
    maxVolume: 100.0,
    volumeStep: 0.01,
    defaultSpreadPoints: 1.5,
    baseCurrency: 'USD',
    quoteCurrency: 'JPY',
    description: 'Asian session benchmark FX instrument.',
    enabled: true,
    marketDataProvider: 'tiingo_fx',
    providerSymbolMapping: { tiingo_fx: 'usdjpy', twelve_data: 'USD/JPY' },
    tradingStatus: 'TRADING',
  },
  {
    id: 's_usdchf',
    symbol: 'USDCHF',
    name: 'US Dollar / Swiss Franc',
    category: 'FOREX',
    digits: 5,
    tickSize: 0.00001,
    contractSize: 100000,
    minVolume: 0.01,
    maxVolume: 100.0,
    volumeStep: 0.01,
    defaultSpreadPoints: 1.5,
    baseCurrency: 'USD',
    quoteCurrency: 'CHF',
    description: 'Safe-haven currency pair.',
    enabled: true,
    marketDataProvider: 'tiingo_fx',
    providerSymbolMapping: { tiingo_fx: 'usdchf', twelve_data: 'USD/CHF' },
    tradingStatus: 'TRADING',
  },
  {
    id: 's_audusd',
    symbol: 'AUDUSD',
    name: 'Australian Dollar / USD',
    category: 'FOREX',
    digits: 5,
    tickSize: 0.00001,
    contractSize: 100000,
    minVolume: 0.01,
    maxVolume: 100.0,
    volumeStep: 0.01,
    defaultSpreadPoints: 1.4,
    baseCurrency: 'AUD',
    quoteCurrency: 'USD',
    description: 'Commodity currency benchmark.',
    enabled: true,
    marketDataProvider: 'tiingo_fx',
    providerSymbolMapping: { tiingo_fx: 'audusd', twelve_data: 'AUD/USD' },
    tradingStatus: 'TRADING',
  },
  {
    id: 's_usdcad',
    symbol: 'USDCAD',
    name: 'US Dollar / Canadian Dollar',
    category: 'FOREX',
    digits: 5,
    tickSize: 0.00001,
    contractSize: 100000,
    minVolume: 0.01,
    maxVolume: 100.0,
    volumeStep: 0.01,
    defaultSpreadPoints: 1.6,
    baseCurrency: 'USD',
    quoteCurrency: 'CAD',
    description: 'North American trade pair.',
    enabled: true,
    marketDataProvider: 'tiingo_fx',
    providerSymbolMapping: { tiingo_fx: 'usdcad', twelve_data: 'USD/CAD' },
    tradingStatus: 'TRADING',
  },
  {
    id: 's_nzdusd',
    symbol: 'NZDUSD',
    name: 'New Zealand Dollar / US Dollar',
    category: 'FOREX',
    digits: 5,
    tickSize: 0.00001,
    contractSize: 100000,
    minVolume: 0.01,
    maxVolume: 100.0,
    volumeStep: 0.01,
    defaultSpreadPoints: 1.8,
    baseCurrency: 'NZD',
    quoteCurrency: 'USD',
    description: 'Kiwi: Asia-Pacific commodity benchmark.',
    enabled: true,
    marketDataProvider: 'tiingo_fx',
    providerSymbolMapping: { tiingo_fx: 'nzdusd', twelve_data: 'NZD/USD' },
    tradingStatus: 'TRADING',
  },
  {
    id: 's_usdcnh',
    symbol: 'USDCNH',
    name: 'US Dollar / Chinese Yuan (Offshore)',
    category: 'FOREX',
    digits: 4,
    tickSize: 0.0001,
    contractSize: 100000,
    minVolume: 0.01,
    maxVolume: 100.0,
    volumeStep: 0.01,
    defaultSpreadPoints: 2.5,
    baseCurrency: 'USD',
    quoteCurrency: 'CNH',
    description: 'Offshore Chinese Yuan / RMB currency instrument.',
    enabled: true,
    marketDataProvider: 'tiingo_fx',
    providerSymbolMapping: { tiingo_fx: 'usdcnh', twelve_data: 'USD/CNH' },
    tradingStatus: 'TRADING',
  },
  {
    id: 's_eurjpy',
    symbol: 'EURJPY',
    name: 'Euro / Japanese Yen',
    category: 'FOREX',
    digits: 3,
    tickSize: 0.001,
    contractSize: 100000,
    minVolume: 0.01,
    maxVolume: 100.0,
    volumeStep: 0.01,
    defaultSpreadPoints: 2.0,
    baseCurrency: 'EUR',
    quoteCurrency: 'JPY',
    description: 'Major cross pair with dynamic trends.',
    enabled: true,
    marketDataProvider: 'tiingo_fx',
    providerSymbolMapping: { tiingo_fx: 'eurjpy', twelve_data: 'EUR/JPY' },
    tradingStatus: 'TRADING',
  },
  {
    id: 's_gbpjpy',
    symbol: 'GBPJPY',
    name: 'British Pound / Japanese Yen',
    category: 'FOREX',
    digits: 3,
    tickSize: 0.001,
    contractSize: 100000,
    minVolume: 0.01,
    maxVolume: 100.0,
    volumeStep: 0.01,
    defaultSpreadPoints: 2.4,
    baseCurrency: 'GBP',
    quoteCurrency: 'JPY',
    description: 'Geppy: High-volatility cross pair.',
    enabled: true,
    marketDataProvider: 'tiingo_fx',
    providerSymbolMapping: { tiingo_fx: 'gbpjpy', twelve_data: 'GBP/JPY' },
    tradingStatus: 'TRADING',
  },

  // --- CRYPTO — 5 ---
  {
    id: 's_btcusd',
    symbol: 'BTCUSD',
    name: 'Bitcoin / US Dollar',
    category: 'CRYPTO',
    digits: 2,
    tickSize: 0.01,
    contractSize: 1,
    minVolume: 0.01,
    maxVolume: 10.0,
    volumeStep: 0.01,
    defaultSpreadPoints: 120.0,
    baseCurrency: 'BTC',
    quoteCurrency: 'USD',
    description: 'Crypto flagship with 24/7 continuous price action.',
    enabled: true,
    marketDataProvider: 'twelve_data',
    providerSymbolMapping: { twelve_data: 'BTC/USD', crypto_feed: 'BTCUSD' },
    tradingStatus: 'TRADING',
  },
  {
    id: 's_ethusd',
    symbol: 'ETHUSD',
    name: 'Ethereum / US Dollar',
    category: 'CRYPTO',
    digits: 2,
    tickSize: 0.01,
    contractSize: 1,
    minVolume: 0.01,
    maxVolume: 50.0,
    volumeStep: 0.01,
    defaultSpreadPoints: 20.0,
    baseCurrency: 'ETH',
    quoteCurrency: 'USD',
    description: 'Smart contract layer-1 crypto flagship.',
    enabled: true,
    marketDataProvider: 'twelve_data',
    providerSymbolMapping: { twelve_data: 'ETH/USD', crypto_feed: 'ETHUSD' },
    tradingStatus: 'TRADING',
  },
  {
    id: 's_bnbusd',
    symbol: 'BNBUSD',
    name: 'Binance Coin / US Dollar',
    category: 'CRYPTO',
    digits: 2,
    tickSize: 0.01,
    contractSize: 1,
    minVolume: 0.01,
    maxVolume: 50.0,
    volumeStep: 0.01,
    defaultSpreadPoints: 15.0,
    baseCurrency: 'BNB',
    quoteCurrency: 'USD',
    description: 'Binance ecosystem token.',
    enabled: true,
    marketDataProvider: 'twelve_data',
    providerSymbolMapping: { twelve_data: 'BNB/USD', crypto_feed: 'BNBUSD' },
    tradingStatus: 'TRADING',
  },
  {
    id: 's_solusd',
    symbol: 'SOLUSD',
    name: 'Solana / US Dollar',
    category: 'CRYPTO',
    digits: 2,
    tickSize: 0.01,
    contractSize: 1,
    minVolume: 0.01,
    maxVolume: 100.0,
    volumeStep: 0.01,
    defaultSpreadPoints: 10.0,
    baseCurrency: 'SOL',
    quoteCurrency: 'USD',
    description: 'High-throughput layer-1 blockchain.',
    enabled: true,
    marketDataProvider: 'twelve_data',
    providerSymbolMapping: { twelve_data: 'SOL/USD', crypto_feed: 'SOLUSD' },
    tradingStatus: 'TRADING',
  },
  {
    id: 's_xrpusd',
    symbol: 'XRPUSD',
    name: 'Ripple / US Dollar',
    category: 'CRYPTO',
    digits: 4,
    tickSize: 0.0001,
    contractSize: 1,
    minVolume: 1.0,
    maxVolume: 10000.0,
    volumeStep: 1.0,
    defaultSpreadPoints: 5.0,
    baseCurrency: 'XRP',
    quoteCurrency: 'USD',
    description: 'Cross-border digital settlement asset.',
    enabled: true,
    marketDataProvider: 'twelve_data',
    providerSymbolMapping: { twelve_data: 'XRP/USD', crypto_feed: 'XRPUSD' },
    tradingStatus: 'TRADING',
  },

  // --- COMMODITIES — 3 ---
  {
    id: 's_xauusd',
    symbol: 'XAUUSD',
    name: 'Gold (Troy Ounce) / USD',
    category: 'COMMODITIES',
    digits: 2,
    tickSize: 0.01,
    contractSize: 100,
    minVolume: 0.01,
    maxVolume: 50.0,
    volumeStep: 0.01,
    defaultSpreadPoints: 25.0,
    baseCurrency: 'XAU',
    quoteCurrency: 'USD',
    description: 'Spot Gold with high pip value and fast momentum.',
    enabled: true,
    marketDataProvider: 'twelve_data',
    providerSymbolMapping: { twelve_data: 'XAU/USD', metals_feed: 'XAUUSD' },
    tradingStatus: 'TRADING',
  },
  {
    id: 's_xagusd',
    symbol: 'XAGUSD',
    name: 'Silver (Troy Ounce) / USD',
    category: 'COMMODITIES',
    digits: 3,
    tickSize: 0.001,
    contractSize: 5000,
    minVolume: 0.01,
    maxVolume: 50.0,
    volumeStep: 0.01,
    defaultSpreadPoints: 3.5,
    baseCurrency: 'XAG',
    quoteCurrency: 'USD',
    description: 'Spot Silver with industrial and monetary demand.',
    enabled: true,
    marketDataProvider: 'twelve_data',
    providerSymbolMapping: { twelve_data: 'XAG/USD', metals_feed: 'XAGUSD' },
    tradingStatus: 'TRADING',
  },
  {
    id: 's_wtiusd',
    symbol: 'WTIUSD',
    name: 'WTI Crude Oil / US Dollar',
    category: 'COMMODITIES',
    digits: 2,
    tickSize: 0.01,
    contractSize: 1000,
    minVolume: 0.01,
    maxVolume: 50.0,
    volumeStep: 0.01,
    defaultSpreadPoints: 4.0,
    baseCurrency: 'WTI',
    quoteCurrency: 'USD',
    description: 'West Texas Intermediate Light Sweet Crude Oil benchmark.',
    enabled: true,
    marketDataProvider: 'twelve_data',
    providerSymbolMapping: { twelve_data: 'WTI/USD', oil_feed: 'WTIUSD' },
    tradingStatus: 'TRADING',
  },
];

export class InstrumentRegistry {
  private static instance: InstrumentRegistry | null = null;
  private instruments: Map<string, InstrumentDefinition> = new Map();

  constructor(customList?: InstrumentDefinition[]) {
    const list = customList || CANONICAL_INSTRUMENTS;
    for (const inst of list) {
      this.instruments.set(inst.symbol.toUpperCase(), { ...inst });
    }
  }

  public static getInstance(): InstrumentRegistry {
    if (!InstrumentRegistry.instance) {
      InstrumentRegistry.instance = new InstrumentRegistry();
    }
    return InstrumentRegistry.instance;
  }

  public static resetInstance(): void {
    InstrumentRegistry.instance = null;
  }

  public getSymbol(symbol: string): InstrumentDefinition | undefined {
    if (!symbol) return undefined;
    return this.instruments.get(symbol.trim().toUpperCase());
  }

  public hasSymbol(symbol: string): boolean {
    if (!symbol) return false;
    return this.instruments.has(symbol.trim().toUpperCase());
  }

  public getAllSymbols(): InstrumentDefinition[] {
    return Array.from(this.instruments.values());
  }

  public getActiveSymbols(limit: number = 18): InstrumentDefinition[] {
    return this.getAllSymbols()
      .filter((s) => s.enabled)
      .slice(0, limit);
  }

  public getSymbolsByCategory(category: AssetCategory): InstrumentDefinition[] {
    return this.getAllSymbols().filter((s) => s.category === category);
  }

  public getSymbolsForProvider(providerId: string): InstrumentDefinition[] {
    return this.getAllSymbols().filter(
      (s) => s.marketDataProvider === providerId || (s.providerSymbolMapping && s.providerSymbolMapping[providerId])
    );
  }

  public resolveProviderSymbol(providerId: string, canonicalSymbol: string): string | undefined {
    const def = this.getSymbol(canonicalSymbol);
    if (!def) return undefined;
    return def.providerSymbolMapping[providerId] || def.symbol.toLowerCase();
  }

  public resolveCanonicalSymbol(providerId: string, providerSymbol: string): string | undefined {
    const lower = providerSymbol.trim().toLowerCase();
    for (const def of this.instruments.values()) {
      const mapped = def.providerSymbolMapping[providerId];
      if (mapped && mapped.toLowerCase() === lower) {
        return def.symbol;
      }
      if (def.symbol.toLowerCase() === lower) {
        return def.symbol;
      }
    }
    return undefined;
  }

  public getDigits(symbol: string): number {
    return this.getSymbol(symbol)?.digits ?? 5;
  }

  public getTickSize(symbol: string): number {
    return this.getSymbol(symbol)?.tickSize ?? 0.00001;
  }

  public roundPrice(symbol: string, price: number): number {
    const digits = this.getDigits(symbol);
    return Number(price.toFixed(digits));
  }

  public formatPrice(symbol: string, price: number): string {
    const digits = this.getDigits(symbol);
    return price.toFixed(digits);
  }

  public registerInstrument(def: InstrumentDefinition): void {
    this.instruments.set(def.symbol.toUpperCase(), { ...def });
  }

  public updateInstrument(symbol: string, updates: Partial<InstrumentDefinition>): InstrumentDefinition | undefined {
    const existing = this.getSymbol(symbol);
    if (!existing) return undefined;
    const updated: InstrumentDefinition = {
      ...existing,
      ...updates,
      symbol: existing.symbol, // immutable canonical symbol
      id: existing.id,
    };
    this.instruments.set(existing.symbol.toUpperCase(), updated);
    return { ...updated };
  }
}
