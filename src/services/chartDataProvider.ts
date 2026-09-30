/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * CHART DATA PROVIDER IMPLEMENTATION (CORRECTNESS & CONTINUITY)
 * Normalizes historical bar loading and realtime tick updates into the IChartDataProvider contract.
 * Guarantees provider-timestamp bucketing, strict mid-price OHLC aggregation,
 * deterministic historical-to-live transition, and out-of-order rejection.
 */

import { CandleBar, IChartDataProvider } from '../types/chart';
import { marketSimulator } from './marketDataSimulator';
import { useTradingStore } from '../store/useTradingStore';

export const TIMEFRAME_SECONDS: Record<string, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
};

/**
 * Standard data provider adapting market quote stream to the domain IChartDataProvider contract.
 */
export class ChartDataProvider implements IChartDataProvider {
  /**
   * Retrieves normalized historical candle bars.
   * Anchors historical baseline to current live/authoritative market quote to eliminate
   * artificial price discontinuity between historical bars and initial live ticks.
   */
  public async getHistoricalBars(
    symbol: string,
    timeframe: string = '1m',
    count: number = 120
  ): Promise<CandleBar[]> {
    const intervalSec = TIMEFRAME_SECONDS[timeframe] || 60;
    let currentQuote = useTradingStore.getState().quotes[symbol];
    if (!currentQuote || typeof currentQuote.mid !== 'number') {
      const simQuote = marketSimulator.getQuote(symbol);
      if (simQuote) {
        currentQuote = simQuote;
      }
    }
    const symbolCfg = useTradingStore.getState().symbols[symbol];
    const digits = symbolCfg?.digits ?? 5;

    // Anchor time to provider quote timestamp if available
    const anchorTimestampSec =
      currentQuote && typeof currentQuote.timestamp === 'number' && currentQuote.timestamp > 0
        ? Math.floor(currentQuote.timestamp / 1000)
        : Math.floor(Date.now() / 1000);
    const currentSlotTime = Math.floor(anchorTimestampSec / intervalSec) * intervalSec;

    // Anchor price to authoritative mid price if available
    const anchorPrice =
      currentQuote && typeof currentQuote.mid === 'number'
        ? currentQuote.mid
        : 1.08500;

    const rawBars = marketSimulator.getHistoricalBars(symbol, count);

    // Calculate offset delta to bridge synthetic baseline smoothly to anchorPrice
    const rawLastBar = rawBars[rawBars.length - 1];
    const rawLastClose = rawLastBar ? Number(rawLastBar.close) : anchorPrice;
    const shiftDelta = anchorPrice - rawLastClose;

    // Normalize timestamps to exact interval grid and anchor prices
    const normalized: CandleBar[] = rawBars.map((b, index) => {
      // Bar index count - 1 ends at (currentSlotTime - intervalSec)
      const barTime = currentSlotTime - (count - index) * intervalSec;
      
      const open = Number((Number(b.open) + shiftDelta).toFixed(digits));
      const close = Number((Number(b.close) + shiftDelta).toFixed(digits));
      const rawHigh = Number((Number(b.high) + shiftDelta).toFixed(digits));
      const rawLow = Number((Number(b.low) + shiftDelta).toFixed(digits));
      
      const high = Number(Math.max(rawHigh, open, close).toFixed(digits));
      const low = Number(Math.min(rawLow, open, close).toFixed(digits));

      return {
        time: barTime,
        open,
        high,
        low,
        close,
        volume: b.volume || 100,
      };
    });

    return normalized;
  }

  /**
   * Subscribes to live bar updates for a symbol and timeframe.
   * Enforces provider quote.timestamp bucketing, strict mid-price aggregation (mid = (bid + ask) / 2),
   * incremental candle updates, and out-of-order rejection.
   */
  public subscribeBarUpdates(
    symbol: string,
    timeframe: string = '1m',
    onUpdate: (bar: CandleBar) => void
  ): () => void {
    const intervalSec = TIMEFRAME_SECONDS[timeframe] || 60;
    let activeBar: CandleBar | null = null;
    let prevQuote = useTradingStore.getState().quotes[symbol];

    const unsubscribe = useTradingStore.subscribe((state) => {
      const quote = state.quotes[symbol];
      if (!quote || quote === prevQuote) return;
      prevQuote = quote;

      // 1. Timestamp resolution: strictly prefer provider quote.timestamp
      const tickTimestampSec =
        typeof quote.timestamp === 'number' && quote.timestamp > 0
          ? Math.floor(quote.timestamp / 1000)
          : Math.floor(Date.now() / 1000);

      const barSlotTime = Math.floor(tickTimestampSec / intervalSec) * intervalSec;

      // 2. Reject out-of-order tick that belongs to an already completed historical bucket
      if (activeBar && barSlotTime < activeBar.time) {
        return;
      }

      // 3. Strict mid-price calculation: (bid + ask) / 2
      const midPrice =
        typeof quote.bid === 'number' && typeof quote.ask === 'number'
          ? (quote.bid + quote.ask) / 2
          : quote.mid;

      // 4. Same-bucket update vs new-bucket creation
      if (!activeBar || activeBar.time !== barSlotTime) {
        // Initialize exactly one new candle for the timeframe slot
        activeBar = {
          time: barSlotTime,
          open: midPrice,
          high: midPrice,
          low: midPrice,
          close: midPrice,
          volume: 1,
        };
      } else {
        // Incremental update of active candle
        activeBar = {
          ...activeBar,
          high: Math.max(activeBar.high, midPrice),
          low: Math.min(activeBar.low, midPrice),
          close: midPrice,
          volume: (activeBar.volume || 0) + 1,
        };
      }

      onUpdate(activeBar);
    });

    return () => {
      unsubscribe();
      activeBar = null;
    };
  }
}

// Singleton provider instance
export const defaultChartDataProvider = new ChartDataProvider();
