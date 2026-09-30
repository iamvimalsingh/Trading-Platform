/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * LIGHTWEIGHT CHARTS RENDERER ADAPTER (CANDLESTICK ONLY)
 * Encapsulates TradingView Lightweight Charts (v5.2.1) behind domain abstraction boundaries.
 * Implements IChartOverlayAdapter and dispatches interactions to IChartInteractionAdapter.
 */

import {
  createChart,
  CandlestickSeries,
  IChartApi,
  ISeriesApi,
  IPriceLine,
  CandlestickData,
  Time,
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

const DEFAULT_LEVEL_COLORS: Record<PriceLevelType, string> = {
  ENTRY: '#3b82f6',
  STOP_LOSS: '#ef4444',
  TAKE_PROFIT: '#10b981',
  ORDER: '#f59e0b',
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

  public setBidAsk(bid?: number, ask?: number): void {
    if (!this.series) return;
    if (this.currentBid === bid && this.currentAsk === ask) return;
    this.currentBid = bid;
    this.currentAsk = ask;

    if (typeof bid === 'number' && !isNaN(bid)) {
      if (this.bidLine) {
        this.bidLine.applyOptions({ price: bid, title: `Bid ${bid.toFixed(5)}` });
      } else {
        this.bidLine = this.series.createPriceLine({
          price: bid,
          color: '#f59e0b',
          lineWidth: 1,
          lineStyle: 3,
          axisLabelVisible: true,
          title: `Bid ${bid.toFixed(5)}`,
        });
      }
    } else if (this.bidLine) {
      this.series.removePriceLine(this.bidLine);
      this.bidLine = null;
    }

    if (typeof ask === 'number' && !isNaN(ask)) {
      if (this.askLine) {
        this.askLine.applyOptions({ price: ask, title: `Ask ${ask.toFixed(5)}` });
      } else {
        this.askLine = this.series.createPriceLine({
          price: ask,
          color: '#38bdf8',
          lineWidth: 1,
          lineStyle: 3,
          axisLabelVisible: true,
          title: `Ask ${ask.toFixed(5)}`,
        });
      }
    } else if (this.askLine) {
      this.series.removePriceLine(this.askLine);
      this.askLine = null;
    }
  }

  public applyTheme(theme: 'light' | 'dark'): void {
    if (!this.chart) return;
    const isLight = theme === 'light';
    this.chart.applyOptions({
      layout: {
        background: { color: isLight ? '#ffffff' : '#09090b' },
        textColor: isLight ? '#64748b' : '#a1a1aa',
      },
      grid: {
        vertLines: { color: isLight ? '#f1f5f9' : '#18181b' },
        horzLines: { color: isLight ? '#f1f5f9' : '#18181b' },
      },
      crosshair: {
        vertLine: { color: isLight ? '#94a3b8' : '#3f3f46', width: 1, style: 2 },
        horzLine: { color: isLight ? '#94a3b8' : '#3f3f46', width: 1, style: 2 },
      },
      rightPriceScale: {
        borderColor: isLight ? '#e2e8f0' : '#27272a',
      },
      timeScale: {
        borderColor: isLight ? '#e2e8f0' : '#27272a',
      },
    });
  }

  public init(initialBars: CandleBar[], theme: 'light' | 'dark' = 'dark'): void {
    if (!this.container) return;

    const isLight = theme === 'light';

    this.chart = createChart(this.container, {
      width: this.container.clientWidth || 600,
      height: this.container.clientHeight || 400,
      layout: {
        background: { color: isLight ? '#ffffff' : '#09090b' },
        textColor: isLight ? '#64748b' : '#a1a1aa',
      },
      grid: {
        vertLines: { color: isLight ? '#f1f5f9' : '#18181b' },
        horzLines: { color: isLight ? '#f1f5f9' : '#18181b' },
      },
      crosshair: {
        vertLine: { color: isLight ? '#94a3b8' : '#3f3f46', width: 1, style: 2 },
        horzLine: { color: isLight ? '#94a3b8' : '#3f3f46', width: 1, style: 2 },
      },
      rightPriceScale: {
        borderColor: isLight ? '#e2e8f0' : '#27272a',
        scaleMargins: { top: 0.1, bottom: 0.15 },
      },
      timeScale: {
        borderColor: isLight ? '#e2e8f0' : '#27272a',
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

    this.chart.subscribeClick((param) => {
      if (!this.interactionAdapter?.onPriceSelected || !this.series || !param.point) return;
      const clickedPrice = this.series.coordinateToPrice(param.point.y);
      if (clickedPrice !== null && !isNaN(clickedPrice)) {
        this.interactionAdapter.onPriceSelected(clickedPrice);
      }
    });

    this.resizeObserver = new ResizeObserver((entries) => {
      if (entries.length === 0 || !entries[0].contentRect) return;
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0 && this.chart) {
        this.chart.applyOptions({ width, height });
      }
    });

    this.resizeObserver.observe(this.container);
  }

  public setBars(bars: CandleBar[]): void {
    if (!this.series || !this.chart) return;

    const barMap = new Map<number, CandleBar>();
    for (const b of bars) {
      if (
        typeof b.time !== 'number' || isNaN(b.time) ||
        typeof b.open !== 'number' || isNaN(b.open) || !isFinite(b.open) ||
        typeof b.high !== 'number' || isNaN(b.high) || !isFinite(b.high) ||
        typeof b.low !== 'number' || isNaN(b.low) || !isFinite(b.low) ||
        typeof b.close !== 'number' || isNaN(b.close) || !isFinite(b.close) ||
        b.low > b.open || b.low > b.close || b.high < b.open || b.high < b.close
      ) {
        continue;
      }
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

  public updateBar(bar: CandleBar): void {
    if (!this.series) return;

    const integerTime = Math.floor(bar.time);
    const normalizedBar: CandleBar = { ...bar, time: integerTime };

    if (this.lastBarTime === null || this.currentBars.length === 0) {
      this.setBars([normalizedBar]);
      return;
    }

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

        if (this.currentBars.length > 0 && this.currentBars[this.currentBars.length - 1].time === integerTime) {
          this.currentBars[this.currentBars.length - 1] = normalizedBar;
        } else {
          this.currentBars.push(normalizedBar);
        }
        this.lastBarTime = integerTime;
      } catch {
        this.appendOrUpdateLocalBar(normalizedBar);
      }
    } else {
      this.appendOrUpdateLocalBar(normalizedBar);
    }
  }

  private appendOrUpdateLocalBar(bar: CandleBar): void {
    const idx = this.currentBars.findIndex((b) => b.time === bar.time);
    if (idx >= 0) {
      this.currentBars[idx] = bar;
    } else {
      this.currentBars.push(bar);
      this.currentBars.sort((a, b) => a.time - b.time);
    }
    this.setBars(this.currentBars);
  }

  public setPriceLevels(levels: ChartPriceLevel[]): void {
    this.clearPriceLevels();
    if (!this.series) return;

    for (const lvl of levels) {
      const color = DEFAULT_LEVEL_COLORS[lvl.type] || '#3b82f6';
      const pl = this.series.createPriceLine({
        price: lvl.price,
        color,
        lineWidth: 1,
        lineStyle: lvl.type === 'ENTRY' ? 1 : 2,
        axisLabelVisible: true,
        title: lvl.label,
      });
      this.priceLines.set(lvl.id, { line: pl, price: lvl.price, label: lvl.label });
    }
  }

  public removePriceLevel(id: string): void {
    const pl = this.priceLines.get(id);
    if (pl && this.series) {
      this.series.removePriceLine(pl.line);
      this.priceLines.delete(id);
    }
  }

  public clearPriceLevels(): void {
    for (const [id, pl] of this.priceLines.entries()) {
      if (this.series) {
        this.series.removePriceLine(pl.line);
      }
    }
    this.priceLines.clear();
  }

  public setOrderMarkers(markers: ChartOrderMarker[]): void {
    // Clean chart rule: zero historical markers by default
  }

  public destroy(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.chart) {
      this.chart.remove();
      this.chart = null;
    }
    this.series = null;
    this.priceLines.clear();
    this.bidLine = null;
    this.askLine = null;
  }
}
