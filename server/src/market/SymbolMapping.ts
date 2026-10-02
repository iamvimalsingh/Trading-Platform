/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * CENTRAL SYMBOL MAPPING & PROVIDER ROUTING LAYER (STEP 4)
 * Defines authoritative mappings between internal trading platform symbols and
 * external provider representations (Tiingo and Twelve Data).
 * 
 * Rules:
 * - Tiingo is primary for FX majors (EURUSD, GBPUSD, USDJPY, USDCHF, AUDUSD, USDCAD).
 * - Twelve Data is primary for Metals (XAUUSD, XAGUSD) and Crypto (BTCUSD, ETHUSD).
 * - Twelve Data acts as secondary/fallback for FX.
 * - US500 is explicitly marked unavailable without Twelve Data Enterprise/Pro indices license.
 */

export type ProviderId = 'tiingo_fx' | 'twelve_data' | 'unassigned';

export interface SymbolMappingDefinition {
  canonical: string;
  name: string;
  category: 'FOREX' | 'METALS' | 'CRYPTO' | 'INDICES';
  digits: number;
  defaultSpreadPoints: number;
  tiingoSymbol?: string;
  twelveDataSymbol?: string;
  primaryProvider: ProviderId;
  secondaryProvider?: ProviderId;
  isAvailableOnStandardTier: boolean;
  unavailabilityReason?: string;
}

export const CENTRAL_SYMBOL_MAPPINGS: SymbolMappingDefinition[] = [
  // --- FOREX (Primary: Tiingo FX, Secondary: Twelve Data) ---
  {
    canonical: 'EURUSD',
    name: 'Euro / US Dollar',
    category: 'FOREX',
    digits: 5,
    defaultSpreadPoints: 1.2,
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
    defaultSpreadPoints: 1.8,
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
    defaultSpreadPoints: 1.5,
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
    defaultSpreadPoints: 1.5,
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
    defaultSpreadPoints: 1.4,
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
    defaultSpreadPoints: 1.6,
    tiingoSymbol: 'usdcad',
    twelveDataSymbol: 'USD/CAD',
    primaryProvider: 'tiingo_fx',
    secondaryProvider: 'twelve_data',
    isAvailableOnStandardTier: true,
  },

  // --- METALS (Primary: Twelve Data) ---
  {
    canonical: 'XAUUSD',
    name: 'Gold (Troy Ounce) / USD',
    category: 'METALS',
    digits: 2,
    defaultSpreadPoints: 25.0,
    twelveDataSymbol: 'XAU/USD',
    primaryProvider: 'twelve_data',
    isAvailableOnStandardTier: true,
  },
  {
    canonical: 'XAGUSD',
    name: 'Silver (Troy Ounce) / USD',
    category: 'METALS',
    digits: 3,
    defaultSpreadPoints: 3.5,
    twelveDataSymbol: 'XAG/USD',
    primaryProvider: 'twelve_data',
    isAvailableOnStandardTier: true,
  },

  // --- CRYPTO (Primary: Twelve Data) ---
  {
    canonical: 'BTCUSD',
    name: 'Bitcoin / US Dollar',
    category: 'CRYPTO',
    digits: 2,
    defaultSpreadPoints: 120.0,
    twelveDataSymbol: 'BTC/USD',
    primaryProvider: 'twelve_data',
    isAvailableOnStandardTier: true,
  },
  {
    canonical: 'ETHUSD',
    name: 'Ethereum / US Dollar',
    category: 'CRYPTO',
    digits: 2,
    defaultSpreadPoints: 20.0,
    twelveDataSymbol: 'ETH/USD',
    primaryProvider: 'twelve_data',
    isAvailableOnStandardTier: true,
  },

  // --- INDICES (Special attention: Verified provider limitation) ---
  {
    canonical: 'US500',
    name: 'S&P 500 Index Cash',
    category: 'INDICES',
    digits: 2,
    defaultSpreadPoints: 40.0,
    primaryProvider: 'unassigned',
    isAvailableOnStandardTier: false,
    unavailabilityReason: 'S&P 500 Index real-time stream requires Twelve Data Enterprise/Pro indices license. Synthetic fake quotes strictly prohibited.',
  },
];

const CANONICAL_MAP = new Map<string, SymbolMappingDefinition>();
const TWELVE_DATA_MAP = new Map<string, SymbolMappingDefinition>();
const TIINGO_MAP = new Map<string, SymbolMappingDefinition>();

for (const mapping of CENTRAL_SYMBOL_MAPPINGS) {
  CANONICAL_MAP.set(mapping.canonical.toUpperCase(), mapping);
  if (mapping.twelveDataSymbol) {
    TWELVE_DATA_MAP.set(mapping.twelveDataSymbol.toUpperCase(), mapping);
    // Also support normalized version without slash (e.g. BTCUSD)
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
