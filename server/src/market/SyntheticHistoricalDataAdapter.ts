/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * SYNTHETIC HISTORICAL DATA ADAPTER (STEP 6)
 * Development & testing fallback provider.
 * Generates mathematically sound, timestamp-aligned candle bars explicitly marked 'SIMULATED'.
 * 
 * Production Hardening Invariants:
 * 1. source is strictly 'SIMULATED' (never spoofed as REAL).
 * 2. status is strictly 'SIMULATED'.
 * 3. High >= max(Open, Close) and Low <= min(Open, Close).
 * 4. Timestamps are strictly aligned to the timeframe interval grid in ascending order.
 * 5. Price precision adheres strictly to InstrumentRegistry.
 */

import {
  HISTORICAL_TIMEFRAME_SECONDS,
  HistoricalDataRequest,
  HistoricalDataResponse,
  NormalizedHistoricalBar,
} from '../types/marketData';
import { IHistoricalDataAdapter } from './IHistoricalDataAdapter';
import { InstrumentRegistry } from './InstrumentRegistry';

const BASE_PRICES: Record<string, number> = {
  EURUSD: 1.08500,
  GBPUSD: 1.29800,
  USDJPY: 154.200,
  USDCHF: 0.88400,
  AUDUSD: 0.65500,
  XAUUSD: 2735.50,
  XAGUSD: 33.75,
  BTCUSD: 68500.00,
  ETHUSD: 2640.00,
  US500: 5860.00,
};

export class SyntheticHistoricalDataAdapter implements IHistoricalDataAdapter {
  public readonly providerId: string = 'synthetic_history_sim';
  public readonly providerName: string = 'SyntheticHistoricalSimulator';
  public readonly isRealProvider: boolean = false;

  constructor(private registry: InstrumentRegistry = InstrumentRegistry.getInstance()) {}

  public supportsSymbol(symbol: string): boolean {
    return this.registry.hasSymbol(symbol.trim().toUpperCase());
  }

  public async fetchHistoricalBars(request: HistoricalDataRequest): Promise<HistoricalDataResponse> {
    const symbol = request.symbol.trim().toUpperCase();
    const timeframe = request.timeframe;
    const intervalSec = HISTORICAL_TIMEFRAME_SECONDS[timeframe] || 60;
    const limit = Math.min(Math.max(request.limit || 120, 1), 1000);

    const symbolDef = this.registry.getSymbol(symbol);
    const digits = symbolDef?.digits ?? 5;
    const tickSize = symbolDef?.tickSize ?? 0.00001;
    const basePrice = BASE_PRICES[symbol] ?? 100.00;

    const nowSec = Math.floor(Date.now() / 1000);
    const currentSlotTime = Math.floor(nowSec / intervalSec) * intervalSec;

    const bars: NormalizedHistoricalBar[] = [];
    let currentClose = basePrice;

    // Deterministic pseudo-random walk anchored to symbol
    const seed = symbol.split('').reduce((acc, char) => acc + char.charCodeAt(0), 42);

    for (let i = limit; i > 0; i--) {
      const barTimestamp = currentSlotTime - (i * intervalSec);
      
      const stepFactor = ((Math.sin(barTimestamp + seed) * 10000) % 1) * 2 - 1;
      const volatility = tickSize * 25;
      
      const open = currentClose;
      const change = stepFactor * volatility;
      const close = Math.max(Number((open + change).toFixed(digits)), tickSize);
      
      const maxOC = Math.max(open, close);
      const minOC = Math.min(open, close);
      const highOffset = Math.abs(Math.cos(barTimestamp) * volatility * 1.5);
      const lowOffset = Math.abs(Math.sin(barTimestamp) * volatility * 1.5);

      const high = Number((maxOC + highOffset).toFixed(digits));
      const low = Math.max(Number((minOC - lowOffset).toFixed(digits)), tickSize);
      const volume = Math.floor(Math.abs(Math.sin(barTimestamp) * 500) + 50);

      bars.push({
        symbol,
        timeframe,
        timestamp: barTimestamp,
        open,
        high: Math.max(high, open, close),
        low: Math.min(low, open, close),
        close,
        volume,
        source: 'SIMULATED',
        providerId: this.providerId,
      });

      currentClose = close;
    }

    return {
      symbol,
      timeframe,
      status: 'SIMULATED',
      providerId: this.providerId,
      count: bars.length,
      bars,
    };
  }
}
