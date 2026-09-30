/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * CHART DOMAIN & ABSTRACTION CONTRACTS
 * Pure domain interfaces decoupling the trading platform from specific chart renderers.
 */

/**
 * Normalized candlestick bar model.
 * Independent of any charting engine.
 */
export interface CandleBar {
  /** Unix timestamp in seconds */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/**
 * Supported chart overlay price level classifications.
 */
export type PriceLevelType = 'ENTRY' | 'STOP_LOSS' | 'TAKE_PROFIT' | 'ORDER';

/**
 * Normalized trading price level overlay descriptor.
 */
export interface ChartPriceLevel {
  id: string;
  type: PriceLevelType;
  price: number;
  label: string;
  isDraggable: boolean;
  color?: string;
  lineStyle?: 'solid' | 'dashed' | 'dotted';
}

/**
 * Normalized trade execution / order marker descriptor.
 */
export interface ChartOrderMarker {
  id: string;
  time: number;
  text: string;
  side: 'BUY' | 'SELL';
  price?: number;
}

/**
 * 1. Chart Data Provider Abstraction
 * Feeds historical candles and streaming bar updates to the renderer.
 */
export interface IChartDataProvider {
  /**
   * Retrieve historical candle bars for a symbol and timeframe.
   */
  getHistoricalBars(symbol: string, timeframe: string, count: number): Promise<CandleBar[]>;

  /**
   * Subscribe to live bar updates for the current active candle.
   * Returns an unsubscribe function.
   */
  subscribeBarUpdates(
    symbol: string,
    timeframe: string,
    onUpdate: (bar: CandleBar) => void
  ): () => void;
}

/**
 * 2. Trading Overlay Adapter Abstraction
 * Manages order levels, entry lines, SL/TP levels, and execution markers.
 */
export interface IChartOverlayAdapter {
  setPriceLevels(levels: ChartPriceLevel[]): void;
  removePriceLevel(id: string): void;
  clearPriceLevels(): void;
  setOrderMarkers(markers: ChartOrderMarker[]): void;
}

/**
 * 3. Chart Interaction Adapter Abstraction
 * Dispatches user chart interactions (click, drag, level modification)
 * to the domain trading command layer.
 */
export interface IChartInteractionAdapter {
  onPriceSelected?: (price: number) => void;
  onLevelModified?: (id: string, newPrice: number) => void;
}
