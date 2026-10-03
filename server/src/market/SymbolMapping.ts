/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * CENTRAL SYMBOL MAPPING & PROVIDER ROUTING LAYER (18 INSTRUMENTS)
 * Authoritative mappings between internal trading platform symbols and
 * external provider representations (Tiingo and Twelve Data).
 * 
 * Final 18 Active Instruments:
 * FOREX (10): EURUSD, GBPUSD, USDJPY, USDCHF, AUDUSD, USDCAD, NZDUSD, USDCNH, EURJPY, GBPJPY
 * CRYPTO (5): BTCUSD, ETHUSD, BNBUSD, SOLUSD, XRPUSD
 * COMMODITIES (3): XAUUSD (Gold), XAGUSD (Silver), WTIUSD (Crude Oil)
 */

import { AssetCategory } from '../types/trading';

export type ProviderId = 'tiingo_fx' | 'twelve_data' | 'unassigned';

export interface SymbolMappingDefinition {
  canonical: string;
  name: string;
  category: AssetCategory;
  digits: number;
  contractSize: number;
  minVolume: number;
  maxVolume: number;
  volumeStep: number;
  defaultSpreadPoints: number;
  baseCurrency: string;
  quoteCurrency: string;
  description: string;
  tiingoSymbol?: string;
  twelveDataSymbol?: string;
  primaryProvider: ProviderId;
  secondaryProvider?: ProviderId;
  isAvailableOnStandardTier: boolean;
  unavailabilityReason?: string;
}

export const CENTRAL_SYMBOL_MAPPINGS: SymbolMappingDefinition[] = [
  // --- FOREX — 10 (Primary: Tiingo FX, Secondary: Twelve Data) ---
  {
    canonical: 'EURUSD',
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
    tiingoSymbol: 'eurusd',
    twelveDataSymbol: 'EUR/USD',
    primaryProvider: 'tiingo_fx',
    secondaryProvider: 'twelve_data',
    isAvailableOnStandardTier: true,
  },
  {
    canonical: 'GBPUSD',
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
    tiingoSymbol: 'gbpusd',
    twelveDataSymbol: 'GBP/USD',
    primaryProvider: 'tiingo_fx',
    secondaryProvider: 'twelve_data',
    isAvailableOnStandardTier: true,
  },
  {
    canonical: 'USDJPY',
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
    tiingoSymbol: 'usdjpy',
    twelveDataSymbol: 'USD/JPY',
    primaryProvider: 'tiingo_fx',
    secondaryProvider: 'twelve_data',
    isAvailableOnStandardTier: true,
  },
  {
    canonical: 'USDCHF',
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
    tiingoSymbol: 'usdchf',
    twelveDataSymbol: 'USD/CHF',
    primaryProvider: 'tiingo_fx',
    secondaryProvider: 'twelve_data',
    isAvailableOnStandardTier: true,
  },
  {
    canonical: 'AUDUSD',
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
    tiingoSymbol: 'audusd',
    twelveDataSymbol: 'AUD/USD',
    primaryProvider: 'tiingo_fx',
    secondaryProvider: 'twelve_data',
    isAvailableOnStandardTier: true,
  },
  {
    canonical: 'USDCAD',
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
    tiingoSymbol: 'usdcad',
    twelveDataSymbol: 'USD/CAD',
    primaryProvider: 'tiingo_fx',
    secondaryProvider: 'twelve_data',
    isAvailableOnStandardTier: true,
  },
  {
    canonical: 'NZDUSD',
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
    tiingoSymbol: 'nzdusd',
    twelveDataSymbol: 'NZD/USD',
    primaryProvider: 'tiingo_fx',
    secondaryProvider: 'twelve_data',
    isAvailableOnStandardTier: true,
  },
  {
    canonical: 'USDCNH',
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
    tiingoSymbol: 'usdcnh',
    twelveDataSymbol: 'USD/CNH',
    primaryProvider: 'tiingo_fx',
    secondaryProvider: 'twelve_data',
    isAvailableOnStandardTier: true,
  },
  {
    canonical: 'EURJPY',
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
    tiingoSymbol: 'eurjpy',
    twelveDataSymbol: 'EUR/JPY',
    primaryProvider: 'tiingo_fx',
    secondaryProvider: 'twelve_data',
    isAvailableOnStandardTier: true,
  },
  {
    canonical: 'GBPJPY',
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
    tiingoSymbol: 'gbpjpy',
    twelveDataSymbol: 'GBP/JPY',
    primaryProvider: 'tiingo_fx',
    secondaryProvider: 'twelve_data',
    isAvailableOnStandardTier: true,
  },

  // --- CRYPTO — 5 (Primary: Twelve Data) ---
  {
    canonical: 'BTCUSD',
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
    twelveDataSymbol: 'BTC/USD',
    primaryProvider: 'twelve_data',
    isAvailableOnStandardTier: true,
  },
  {
    canonical: 'ETHUSD',
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
    twelveDataSymbol: 'ETH/USD',
    primaryProvider: 'twelve_data',
    isAvailableOnStandardTier: true,
  },
  {
    canonical: 'BNBUSD',
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
    twelveDataSymbol: 'BNB/USD',
    primaryProvider: 'twelve_data',
    isAvailableOnStandardTier: true,
  },
  {
    canonical: 'SOLUSD',
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
    twelveDataSymbol: 'SOL/USD',
    primaryProvider: 'twelve_data',
    isAvailableOnStandardTier: true,
  },
  {
    canonical: 'XRPUSD',
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
    twelveDataSymbol: 'XRP/USD',
    primaryProvider: 'twelve_data',
    isAvailableOnStandardTier: true,
  },

  // --- COMMODITIES — 3 (Primary: Twelve Data) ---
  {
    canonical: 'XAUUSD',
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
    twelveDataSymbol: 'XAU/USD',
    primaryProvider: 'twelve_data',
    isAvailableOnStandardTier: true,
  },
  {
    canonical: 'XAGUSD',
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
    twelveDataSymbol: 'XAG/USD',
    primaryProvider: 'twelve_data',
    isAvailableOnStandardTier: true,
  },
  {
    canonical: 'WTIUSD',
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
    twelveDataSymbol: 'WTI/USD',
    primaryProvider: 'twelve_data',
    isAvailableOnStandardTier: true,
  },
];

const CANONICAL_MAP = new Map<string, SymbolMappingDefinition>();
const TWELVE_DATA_MAP = new Map<string, SymbolMappingDefinition>();
const TIINGO_MAP = new Map<string, SymbolMappingDefinition>();

for (const mapping of CENTRAL_SYMBOL_MAPPINGS) {
  CANONICAL_MAP.set(mapping.canonical.toUpperCase(), mapping);
  if (mapping.twelveDataSymbol) {
    TWELVE_DATA_MAP.set(mapping.twelveDataSymbol.toUpperCase(), mapping);
    // Also support normalized version without slash (e.g. BTCUSD, XAUUSD, WTIUSD)
    TWELVE_DATA_MAP.set(mapping.twelveDataSymbol.replace('/', '').toUpperCase(), mapping);
  }
  if (mapping.tiingoSymbol) {
    TIINGO_MAP.set(mapping.tiingoSymbol.toLowerCase(), mapping);
    TIINGO_MAP.set(mapping.tiingoSymbol.toUpperCase(), mapping);
  }
}

export function getSymbolMapping(canonical: string): SymbolMappingDefinition | undefined {
  return CANONICAL_MAP.get(canonical.toUpperCase());
}

export function getCanonicalFromTwelveData(providerSymbol: string): string | undefined {
  const norm = providerSymbol.trim().toUpperCase();
  const found = TWELVE_DATA_MAP.get(norm) || TWELVE_DATA_MAP.get(norm.replace('/', ''));
  return found?.canonical;
}

export function getCanonicalFromTiingo(providerSymbol: string): string | undefined {
  const norm = providerSymbol.trim().toLowerCase();
  return TIINGO_MAP.get(norm)?.canonical;
}

export function getAllSymbolMappings(): SymbolMappingDefinition[] {
  return CENTRAL_SYMBOL_MAPPINGS;
}
