/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * LIGHTWEIGHT CHARTS RENDERER ADAPTER
 * Encapsulates TradingView Lightweight Charts (v5.2.1) behind domain abstraction boundaries.
 * Implements IChartOverlayAdapter and dispatches interactions to IChartInteractionAdapter.
 * 
 * TRADINGVIEW ATTRIBUTION COMPLIANCE NOTE:
 * The TradingView attribution logo is intentionally preserved with default behavior
 * per project instructions. We do NOT disable, CSS-hide, or intercept clicks on the logo.
 * Future production branding decisions will address external attribution requirements formally.
 */

import {
  createChart,
  CandlestickSeries,
  IChartApi,
  ISeriesApi,
  IPriceLine,
  CandlestickData,
  Time,
  SeriesMarker,
  createSeriesMarkers,
  ISeriesMarkersPluginApi,
} from 'lightweight-charts';
import {
  CandleBar,
  ChartOrderMarker,
  ChartPriceLevel,
  IChartInteractionAdapter,
  IChartOverlayAdapter,
  PriceLevelType,
} from '../../types/chart';

/**
 * Default color palette for domain price level overlays.
 */
const DEFAULT_LEVEL_COLORS: Record<PriceLevelType, string> = {
  ENTRY: '#3b82f6',      // Blue
  STOP_LOSS: '#ef4444',  // Rose / Red
  TAKE_PROFIT: '#10b981',// Emerald / Green
  ORDER: '#f59e0b',      // Amber
};

export class LightweightChartsAdapter implements IChartOverlayAdapter {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<'Candlestick'> | null = null;
  private markersPlugin: ISeriesMarkersPluginApi<Time> | null = null;
  private priceLines: Map<string, { line: IPriceLine; price: number; label: string }> = new Map();
  private bidLine: IPriceLine | null = null;
  private askLine: IPriceLine | null = null;
  private currentBid?: number;
  private currentAsk?: number;
  private resizeObserver: ResizeObserver | null = null;
  private interactionAdapter?: IChartInteractionAdapter;
  private currentBars: CandleBar[] = [];
  private lastBarTime: number | null = null;

  constructor(
    private readonly container: HTMLElement,
    interactionAdapter?: IChartInteractionAdapter
  ) {
    this.interactionAdapter = interactionAdapter;
  }

  /**
   * Synchronizes live Bid and Ask price lines on the chart.
   */
  public setBidAsk(bid?: number, ask?: number): void {
    if (!this.series) return;
    if (this.currentBid === bid && this.currentAsk === ask) return;
    this.currentBid = bid;
    this.currentAsk = ask;

    // Update or create Bid line
    if (typeof bid === 'number' && !isNaN(bid)) {
      if (this.bidLine) {
        this.bidLine.applyOptions({ price: bid, title: `Bid ${bid.toFixed(5)}` });
      } else {
        this.bidLine = this.series.createPriceLine({
          price: bid,
          color: '#f59e0b',
          lineWidth: 1,
          lineStyle: 3, // Dotted
          axisLabelVisible: true,
          title: `Bid ${bid.toFixed(5)}`,
        });
      }
    } else if (this.bidLine) {
      this.series.removePriceLine(this.bidLine);
      this.bidLine = null;
    }

    // Update or create Ask line
    if (typeof ask === 'number' && !isNaN(ask)) {
      if (this.askLine) {
        this.askLine.applyOptions({ price: ask, title: `Ask ${ask.toFixed(5)}` });
      } else {
        this.askLine = this.series.createPriceLine({
          price: ask,
          color: '#38bdf8',
          lineWidth: 1,
          lineStyle: 3, // Dotted
          axisLabelVisible: true,
          title: `Ask ${ask.toFixed(5)}`,
        });
      }
    } else if (this.askLine) {
      this.series.removePriceLine(this.askLine);
      this.askLine = null;
    }
  }

  /**
   * Initializes the chart engine with normalized baseline bars.
   */
  public init(initialBars: CandleBar[]): void {
    if (!this.container) return;

    // Initialize chart with professional dark theme
    // NOTE: attributionLogo is intentionally NOT set to false. Default attribution is preserved.
    this.chart = createChart(this.container, {
      width: this.container.clientWidth || 600,
      height: this.container.clientHeight || 400,
      layout: {
        background: { color: '#09090b' },
        textColor: '#71717a',
      },
      grid: {
        vertLines: { color: '#18181b' },
        horzLines: { color: '#18181b' },
      },
      crosshair: {
        vertLine: { color: '#3f3f46', width: 1, style: 2 },
        horzLine: { color: '#3f3f46', width: 1, style: 2 },
      },
      rightPriceScale: {
        borderColor: '#27272a',
        scaleMargins: { top: 0.1, bottom: 0.15 },
      },
      timeScale: {
        borderColor: '#27272a',
        timeVisible: true,
        secondsVisible: false,
      },
    });

    this.series = this.chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#f43f5e',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#f43f5e',
    });

    this.setBars(initialBars);

    // Coordinate chart clicks to interaction adapter
    this.chart.subscribeClick((param) => {
      if (!this.interactionAdapter?.onPriceSelected || !this.series || !param.point) return;
      const clickedPrice = this.series.coordinateToPrice(param.point.y);
      if (clickedPrice !== null && !isNaN(clickedPrice)) {
        this.interactionAdapter.onPriceSelected(clickedPrice);
      }
    });

    // Auto-resize observing the container element
    this.resizeObserver = new ResizeObserver((entries) => {
      if (entries.length === 0 || !entries[0].contentRect) return;
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0 && this.chart) {
        this.chart.applyOptions({ width, height });
      }
    });

    this.resizeObserver.observe(this.container);
  }

  /**
   * Sets or replaces all candle bars in the series.
   */
  public setBars(bars: CandleBar[]): void {
    if (!this.series || !this.chart) return;

    // Deduplicate by time and ensure strictly ascending chronological order
    const barMap = new Map<number, CandleBar>();
    for (const b of bars) {
      const integerTime = Math.floor(b.time);
      barMap.set(integerTime, { ...b, time: integerTime });
    }
    const sortedBars = Array.from(barMap.values()).sort((a, b) => a.time - b.time);

    this.currentBars = sortedBars;
    this.lastBarTime = sortedBars.length > 0 ? sortedBars[sortedBars.length - 1].time : null;

    const formattedData: CandlestickData<Time>[] = sortedBars.map((b) => ({
      time: b.time as Time,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    }));

    try {
      this.series.setData(formattedData);
      this.chart.timeScale().fitContent();
    } catch (err) {
      console.warn('[LightweightChartsAdapter] series.setData error caught:', err);
    }
  }

  /**
   * Ingests a realtime update for the head/active candle bar.
   */
  public updateBar(bar: CandleBar): void {
    if (!this.series) return;

    const integerTime = Math.floor(bar.time);
    const normalizedBar: CandleBar = { ...bar, time: integerTime };

    // If no bars exist yet, initialize dataset
    if (this.lastBarTime === null || this.currentBars.length === 0) {
      this.setBars([normalizedBar]);
      return;
    }

    // Normal path: bar is for the current active candle or a new subsequent candle
    if (integerTime >= this.lastBarTime) {
      const updatedData: CandlestickData<Time> = {
        time: integerTime as Time,
        open: normalizedBar.open,
        high: normalizedBar.high,
        low: normalizedBar.low,
        close: normalizedBar.close,
      };

      try {
        this.series.update(updatedData);

        // Maintain local bar list
        if (this.currentBars.length > 0 && this.currentBars[this.currentBars.length - 1].time === integerTime) {
          this.currentBars[this.currentBars.length - 1] = normalizedBar;
        } else {
          this.currentBars.push(normalizedBar);
        }
        this.lastBarTime = integerTime;
      } catch {
        // Fallback to full dataset sync if series.update fails
        this.appendOrUpdateLocalBar(normalizedBar);
      }
    } else {
      // Historical or older timestamp tick arrival: merge into dataset and refresh cleanly
      this.appendOrUpdateLocalBar(normalizedBar);
    }
  }

  private appendOrUpdateLocalBar(bar: CandleBar): void {
    const existingIndex = this.currentBars.findIndex((b) => b.time === bar.time);
    if (existingIndex >= 0) {
      this.currentBars[existingIndex] = { ...bar };
    } else {
      this.currentBars.push({ ...bar });
      this.currentBars.sort((a, b) => a.time - b.time);
    }

    this.setBars(this.currentBars);
  }

  // =========================================================================
  // IChartOverlayAdapter Implementation
  // =========================================================================

  /**
   * Synchronizes domain price levels (Entry, SL, TP, Orders) to native price lines.
   */
  public setPriceLevels(levels: ChartPriceLevel[]): void {
    if (!this.series) return;

    const currentIds = new Set(levels.map((l) => l.id));

    // Remove obsolete lines
    for (const [id, entry] of this.priceLines.entries()) {
      if (!currentIds.has(id)) {
        this.series.removePriceLine(entry.line);
        this.priceLines.delete(id);
      }
    }

    // Add or update active lines
    for (const level of levels) {
      const existing = this.priceLines.get(level.id);

      // If price or label changed, replace line
      if (existing) {
        if (existing.price === level.price && existing.label === level.label) {
          continue;
        }
        this.series.removePriceLine(existing.line);
        this.priceLines.delete(level.id);
      }

      const color = level.color || DEFAULT_LEVEL_COLORS[level.type] || '#71717a';
      const lineStyle = level.type === 'ENTRY' ? 0 : 2; // Solid for Entry, Dashed for SL/TP

      const newLine = this.series.createPriceLine({
        price: level.price,
        color,
        lineWidth: 1,
        lineStyle,
        axisLabelVisible: true,
        title: level.label,
      });

      this.priceLines.set(level.id, {
        line: newLine,
        price: level.price,
        label: level.label,
      });
    }
  }

  /**
   * Removes a specific price level overlay.
   */
  public removePriceLevel(id: string): void {
    if (!this.series) return;
    const existing = this.priceLines.get(id);
    if (existing) {
      this.series.removePriceLine(existing.line);
      this.priceLines.delete(id);
    }
  }

  /**
   * Clears all price line overlays from the chart series.
   */
  public clearPriceLevels(): void {
    if (!this.series) return;
    for (const entry of this.priceLines.values()) {
      this.series.removePriceLine(entry.line);
    }
    this.priceLines.clear();
  }

  /**
   * Sets trade execution / order markers on historical bars.
   */
  public setOrderMarkers(markers: ChartOrderMarker[]): void {
    if (!this.series) return;

    const formattedMarkers: SeriesMarker<Time>[] = markers.map((m) => ({
      time: m.time as Time,
      position: m.side === 'BUY' ? 'belowBar' : 'aboveBar',
      color: m.side === 'BUY' ? '#10b981' : '#f43f5e',
      shape: m.side === 'BUY' ? 'arrowUp' : 'arrowDown',
      text: m.text,
    }));

    if (!this.markersPlugin) {
      this.markersPlugin = createSeriesMarkers(this.series, formattedMarkers);
    } else {
      this.markersPlugin.setMarkers(formattedMarkers);
    }
  }

  /**
   * Teardown observer and chart resources cleanly.
   */
  public destroy(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    this.clearPriceLevels();
    this.bidLine = null;
    this.askLine = null;
    if (this.chart) {
      this.chart.remove();
      this.chart = null;
      this.series = null;
      this.markersPlugin = null;
    }
  }
}
