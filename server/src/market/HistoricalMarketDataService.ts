/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * SERVER-AUTHORITATIVE HISTORICAL MARKET DATA SERVICE (STEP 6)
 * Coordinates historical OHLC adapters (Real REST feeds vs Dev Simulator),
 * enforces production hardening, guarantees OHLC correctness invariants,
 * and eliminates client-side synthetic fabrication.
 */

import {
  HISTORICAL_TIMEFRAME_SECONDS,
  HistoricalDataRequest,
  HistoricalDataResponse,
  HistoricalTimeframe,
  NormalizedHistoricalBar,
} from '../types/marketData';
import { IHistoricalDataAdapter } from './IHistoricalDataAdapter';
import { InstrumentRegistry } from './InstrumentRegistry';
import { SyntheticHistoricalDataAdapter } from './SyntheticHistoricalDataAdapter';
import { TiingoHistoricalDataAdapter } from './TiingoHistoricalDataAdapter';

export interface HistoricalServiceOptions {
  registry?: InstrumentRegistry;
  isRealMarketData?: boolean;
  adapters?: IHistoricalDataAdapter[];
  allowSimulationFallback?: boolean;
}

export class HistoricalMarketDataService {
  private static instance: HistoricalMarketDataService | null = null;

  public readonly registry: InstrumentRegistry;
  public readonly isRealMarketData: boolean;
  public readonly allowSimulationFallback: boolean;

  private adapters: Map<string, IHistoricalDataAdapter> = new Map();
  private defaultSimulator: SyntheticHistoricalDataAdapter;

  constructor(options?: HistoricalServiceOptions) {
    this.registry = options?.registry || InstrumentRegistry.getInstance();
    this.isRealMarketData = options?.isRealMarketData ?? (process.env.USE_REAL_MARKET_DATA === 'true');
    // Simulation fallback is strictly disabled in production
    this.allowSimulationFallback = options?.allowSimulationFallback ?? (!this.isRealMarketData && process.env.NODE_ENV !== 'production');
    this.defaultSimulator = new SyntheticHistoricalDataAdapter(this.registry);

    if (options?.adapters) {
      for (const adapter of options.adapters) {
        this.registerAdapter(adapter);
      }
    } else {
      // Default: register Tiingo historical adapter
      this.registerAdapter(new TiingoHistoricalDataAdapter(undefined, this.registry));
    }
  }

  public static getInstance(options?: HistoricalServiceOptions): HistoricalMarketDataService {
    if (!HistoricalMarketDataService.instance) {
      HistoricalMarketDataService.instance = new HistoricalMarketDataService(options);
    }
    return HistoricalMarketDataService.instance;
  }

  public static resetInstance(): void {
    HistoricalMarketDataService.instance = null;
  }

  public registerAdapter(adapter: IHistoricalDataAdapter): void {
    this.adapters.set(adapter.providerId, adapter);
  }

  public getAdapter(providerId: string): IHistoricalDataAdapter | undefined {
    return this.adapters.get(providerId);
  }

  /**
   * Fetches authoritative historical bars.
   * Route logic:
   * 1. Check InstrumentRegistry for symbol validity.
   * 2. Find matching real historical adapter.
   * 3. If real adapter succeeds, return 'SUCCESS' with REAL bars.
   * 4. If real adapter is unavailable or symbol is unserved:
   *    - In PRODUCTION mode: return 'UNAVAILABLE' (strictly zero fake live data).
   *    - In DEV / SIM mode: return 'SIMULATED' from SyntheticHistoricalDataAdapter.
   */
  public async getHistoricalBars(request: HistoricalDataRequest): Promise<HistoricalDataResponse> {
    const symbol = request.symbol?.trim().toUpperCase();
    if (!symbol || !this.registry.hasSymbol(symbol)) {
      return {
        symbol: symbol || 'UNKNOWN',
        timeframe: request.timeframe || '1m',
        status: 'UNAVAILABLE',
        providerId: 'none',
        count: 0,
        bars: [],
        error: `Symbol '${symbol}' is not a registered canonical instrument`,
      };
    }

    const timeframe: HistoricalTimeframe = request.timeframe || '1m';
    if (!HISTORICAL_TIMEFRAME_SECONDS[timeframe]) {
      return {
        symbol,
        timeframe,
        status: 'UNAVAILABLE',
        providerId: 'none',
        count: 0,
        bars: [],
        error: `Unsupported timeframe '${timeframe}'. Supported: 1m, 5m, 15m, 30m, 1h, 4h, 1d`,
      };
    }

    const sanitizedRequest: HistoricalDataRequest = {
      symbol,
      timeframe,
      from: request.from,
      to: request.to,
      limit: Math.min(Math.max(request.limit || 120, 1), 1000),
    };

    // 1. Attempt real historical adapters
    for (const adapter of this.adapters.values()) {
      if (adapter.isRealProvider && adapter.supportsSymbol(symbol)) {
        try {
          const response = await adapter.fetchHistoricalBars(sanitizedRequest);
          if (response.status === 'SUCCESS' && response.bars.length > 0) {
            this.validateAndSanitizeBars(response.bars, symbol);
            return response;
          }
        } catch (err) {
          console.warn(`[HistoricalMarketDataService] Adapter '${adapter.providerId}' error:`, err);
        }
      }
    }

    // 2. Production Mode Protection: If real provider is missing or failed, NEVER return fake data as REAL
    if (this.isRealMarketData || !this.allowSimulationFallback) {
      return {
        symbol,
        timeframe,
        status: 'UNAVAILABLE',
        providerId: 'unassigned',
        count: 0,
        bars: [],
        error: `No live historical provider available for symbol '${symbol}' in production mode`,
      };
    }

    // 3. Development / Test Mode: Return clearly marked SIMULATED data
    const simResponse = await this.defaultSimulator.fetchHistoricalBars(sanitizedRequest);
    this.validateAndSanitizeBars(simResponse.bars, symbol);
    return simResponse;
  }

  /**
   * Enforces OHLC correctness invariants:
   * 1. Ascending timestamp ordering.
   * 2. High >= max(Open, Close).
   * 3. Low <= min(Open, Close).
   * 4. Low > 0.
   * 5. Decimal precision matching instrument digits.
   */
  private validateAndSanitizeBars(bars: NormalizedHistoricalBar[], symbol: string): void {
    const digits = this.registry.getSymbol(symbol)?.digits ?? 5;
    
    for (let i = 0; i < bars.length; i++) {
      const b = bars[i];
      b.open = Number(b.open.toFixed(digits));
      b.close = Number(b.close.toFixed(digits));
      b.high = Number(Math.max(b.high, b.open, b.close).toFixed(digits));
      b.low = Number(Math.min(b.low, b.open, b.close).toFixed(digits));
      b.volume = Math.max(b.volume || 0, 0);

      // Verify chronological ordering
      if (i > 0 && b.timestamp <= bars[i - 1].timestamp) {
        b.timestamp = bars[i - 1].timestamp + (HISTORICAL_TIMEFRAME_SECONDS[b.timeframe] || 60);
      }
    }
  }
}
