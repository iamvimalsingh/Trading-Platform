/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * TIINGO HISTORICAL DATA ADAPTER (STEP 6)
 * Fetches real historical OHLC candle data from Tiingo REST API for supported FX Majors.
 * Fallback to explicit UNAVAILABLE status when credentials are missing or upstream is unavailable.
 */

import {
  HISTORICAL_TIMEFRAME_SECONDS,
  HistoricalDataRequest,
  HistoricalDataResponse,
  NormalizedHistoricalBar,
} from '../types/marketData';
import { IHistoricalDataAdapter } from './IHistoricalDataAdapter';
import { InstrumentRegistry } from './InstrumentRegistry';

export class TiingoHistoricalDataAdapter implements IHistoricalDataAdapter {
  public readonly providerId: string = 'tiingo_fx_history';
  public readonly providerName: string = 'TiingoHistoricalRestFeed';
  public readonly isRealProvider: boolean = true;

  private supportedSymbols: Set<string> = new Set([
    'EURUSD',
    'GBPUSD',
    'USDJPY',
    'USDCHF',
    'AUDUSD',
  ]);

  constructor(
    private apiKey?: string,
    private registry: InstrumentRegistry = InstrumentRegistry.getInstance()
  ) {
    this.apiKey =
      apiKey ||
      process.env.TIINGO_API_TOKEN ||
      process.env.VITE_TIINGO_API_TOKEN ||
      '';
  }

  public supportsSymbol(symbol: string): boolean {
    return this.supportedSymbols.has(symbol.trim().toUpperCase());
  }

  public async fetchHistoricalBars(request: HistoricalDataRequest): Promise<HistoricalDataResponse> {
    const symbol = request.symbol.trim().toUpperCase();
    const timeframe = request.timeframe;

    if (!this.supportsSymbol(symbol)) {
      return {
        symbol,
        timeframe,
        status: 'UNAVAILABLE',
        providerId: this.providerId,
        count: 0,
        bars: [],
        error: `Tiingo historical feed does not support symbol '${symbol}'`,
      };
    }

    const token = this.apiKey?.trim();
    if (!token) {
      return {
        symbol,
        timeframe,
        status: 'UNAVAILABLE',
        providerId: this.providerId,
        count: 0,
        bars: [],
        error: 'Tiingo API token not configured for live historical fetching',
      };
    }

    try {
      const limit = Math.min(Math.max(request.limit || 120, 1), 1000);
      const intervalSec = HISTORICAL_TIMEFRAME_SECONDS[timeframe] || 60;
      const resampleFreq = timeframe === '1d' ? '1day' : `${intervalSec / 60}min`;
      
      const now = Math.floor(Date.now() / 1000);
      const fromSec = request.from || (now - limit * intervalSec);
      const startDate = new Date(fromSec * 1000).toISOString().split('T')[0];

      const url = `https://api.tiingo.com/tiingo/fx/prices?tickers=${symbol.toLowerCase()}&startDate=${startDate}&resampleFreq=${resampleFreq}&token=${token}`;

      const res = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!res.ok) {
        return {
          symbol,
          timeframe,
          status: 'UNAVAILABLE',
          providerId: this.providerId,
          count: 0,
          bars: [],
          error: `Tiingo REST API HTTP error ${res.status}`,
        };
      }

      const rawData = await res.json();
      if (!Array.isArray(rawData) || rawData.length === 0 || !Array.isArray(rawData[0]?.priceData)) {
        return {
          symbol,
          timeframe,
          status: 'UNAVAILABLE',
          providerId: this.providerId,
          count: 0,
          bars: [],
          error: 'No historical price data returned from Tiingo',
        };
      }

      const priceData = rawData[0].priceData;
      const digits = this.registry.getSymbol(symbol)?.digits ?? 5;

      const normalizedBars: NormalizedHistoricalBar[] = [];
      for (const item of priceData) {
        const itemTimeSec = Math.floor(new Date(item.date).getTime() / 1000);
        const alignedTime = Math.floor(itemTimeSec / intervalSec) * intervalSec;

        const open = Number(Number(item.open).toFixed(digits));
        const high = Number(Number(item.high).toFixed(digits));
        const low = Number(Number(item.low).toFixed(digits));
        const close = Number(Number(item.close).toFixed(digits));

        if (isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close) || low <= 0) {
          continue;
        }

        normalizedBars.push({
          symbol,
          timeframe,
          timestamp: alignedTime,
          open,
          high: Math.max(high, open, close),
          low: Math.min(low, open, close),
          close,
          volume: item.volume || 100,
          source: 'REAL',
          providerId: this.providerId,
        });
      }

      // Sort strictly ascending
      normalizedBars.sort((a, b) => a.timestamp - b.timestamp);

      return {
        symbol,
        timeframe,
        status: 'SUCCESS',
        providerId: this.providerId,
        count: normalizedBars.length,
        bars: normalizedBars.slice(-limit),
      };
    } catch (err: any) {
      return {
        symbol,
        timeframe,
        status: 'UNAVAILABLE',
        providerId: this.providerId,
        count: 0,
        bars: [],
        error: err?.message || 'Failed to fetch historical data from Tiingo',
      };
    }
  }
}
