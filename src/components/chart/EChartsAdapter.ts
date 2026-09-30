/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * APACHE ECHARTS RENDERER ADAPTER (POC)
 * Evaluates Apache ECharts (v5.x, Apache-2.0) as an alternative charting engine.
 * Decoupled behind IChartOverlayAdapter and IChartDataProvider boundaries.
 * 
 * NO TRADINGVIEW ATTRIBUTION:
 * This component is an isolated POC under Apache-2.0 license.
 */

import * as echarts from 'echarts';
import {
  CandleBar,
  ChartOrderMarker,
  ChartPriceLevel,
  IChartInteractionAdapter,
  IChartOverlayAdapter,
  PriceLevelType,
} from '../../types/chart';

const DEFAULT_LEVEL_COLORS: Record<PriceLevelType, string> = {
  ENTRY: '#3b82f6',      // Blue
  STOP_LOSS: '#ef4444',  // Rose / Red
  TAKE_PROFIT: '#10b981',// Emerald / Green
  ORDER: '#f59e0b',      // Amber
};

export interface EChartsMetrics {
  initRenderTimeMs: number;
  lastUpdateLatencyMs: number;
  totalTicksRendered: number;
  barCount: number;
}

export class EChartsAdapter implements IChartOverlayAdapter {
  private chart: echarts.ECharts | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private rawBars: CandleBar[] = [];
  private priceLevels: Map<string, ChartPriceLevel> = new Map();
  private interactionAdapter?: IChartInteractionAdapter;
  private currentBid?: number;
  private currentAsk?: number;

  // Performance telemetry
  private metrics: EChartsMetrics = {
    initRenderTimeMs: 0,
    lastUpdateLatencyMs: 0,
    totalTicksRendered: 0,
    barCount: 0,
  };

  constructor(
    private readonly container: HTMLElement,
    interactionAdapter?: IChartInteractionAdapter
  ) {
    this.interactionAdapter = interactionAdapter;
  }

  /**
   * Updates real-time Bid and Ask price levels.
   */
  public setBidAsk(bid?: number, ask?: number): void {
    if (this.currentBid === bid && this.currentAsk === ask) return;
    this.currentBid = bid;
    this.currentAsk = ask;
    if (this.chart) {
      this.chart.setOption(this.buildChartOption(), false);
    }
  }

  /**
   * Initializes the ECharts instance with dark trading theme and initial bars.
   */
  public init(initialBars: CandleBar[]): void {
    if (!this.container) return;

    const startTime = performance.now();

    // Dispose any existing instance in container
    const existing = echarts.getInstanceByDom(this.container);
    if (existing) {
      existing.dispose();
    }

    this.chart = echarts.init(this.container, 'dark', {
      renderer: 'canvas',
    });

    this.rawBars = [...initialBars];
    this.metrics.barCount = this.rawBars.length;

    const option = this.buildChartOption();
    this.chart.setOption(option, true);

    this.metrics.initRenderTimeMs = Math.round((performance.now() - startTime) * 100) / 100;

    // Handle clicks for IChartInteractionAdapter
    this.chart.on('click', (params: any) => {
      if (!this.interactionAdapter?.onPriceSelected) return;
      if (params.data && Array.isArray(params.data)) {
        // params.data is [open, close, low, high]
        const clickedPrice = params.data[1]; // Close
        if (typeof clickedPrice === 'number' && !isNaN(clickedPrice)) {
          this.interactionAdapter.onPriceSelected(clickedPrice);
        }
      }
    });

    // Resize observer
    this.resizeObserver = new ResizeObserver((entries) => {
      if (entries.length === 0 || !entries[0].contentRect) return;
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0 && this.chart) {
        this.chart.resize();
      }
    });

    this.resizeObserver.observe(this.container);
  }

  /**
   * Formats time for X axis category display (HH:mm or DD/MM HH:mm).
   */
  private formatTime(timestampSec: number): string {
    const d = new Date(timestampSec * 1000);
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  /**
   * Builds the complete ECharts configuration object.
   */
  private buildChartOption(): echarts.EChartsOption {
    const times = this.rawBars.map((b) => this.formatTime(b.time));
    // ECharts Candlestick format: [open, close, lowest, highest]
    const values = this.rawBars.map((b) => [b.open, b.close, b.low, b.high]);

    // Build markLine data from active price levels
    const markLineData: any[] = [];

    // Live Ask price line
    if (typeof this.currentAsk === 'number') {
      markLineData.push({
        name: 'Ask',
        yAxis: this.currentAsk,
        lineStyle: {
          color: '#38bdf8',
          type: 'dotted',
          width: 1,
        },
        label: {
          show: true,
          position: 'insideEndTop',
          formatter: `Ask ${this.currentAsk.toFixed(5)}`,
          color: '#ffffff',
          backgroundColor: '#0284c7',
          padding: [2, 5],
          borderRadius: 2,
          fontSize: 9,
          fontFamily: 'monospace',
        },
      });
    }

    // Live Bid price line
    if (typeof this.currentBid === 'number') {
      markLineData.push({
        name: 'Bid',
        yAxis: this.currentBid,
        lineStyle: {
          color: '#f59e0b',
          type: 'dotted',
          width: 1,
        },
        label: {
          show: true,
          position: 'insideEndBottom',
          formatter: `Bid ${this.currentBid.toFixed(5)}`,
          color: '#ffffff',
          backgroundColor: '#d97706',
          padding: [2, 5],
          borderRadius: 2,
          fontSize: 9,
          fontFamily: 'monospace',
        },
      });
    }

    // Position Overlays (Entry, SL, TP)
    for (const level of this.priceLevels.values()) {
      const color = level.color || DEFAULT_LEVEL_COLORS[level.type] || '#71717a';
      const isDashed = level.type !== 'ENTRY';
      markLineData.push({
        name: level.label,
        yAxis: level.price,
        lineStyle: {
          color,
          type: isDashed ? 'dashed' : 'solid',
          width: 1.5,
        },
        label: {
          show: true,
          position: 'insideEndTop',
          formatter: `${level.label}`,
          color: '#ffffff',
          backgroundColor: color,
          padding: [2, 6],
          borderRadius: 2,
          fontSize: 10,
          fontFamily: 'monospace',
        },
      });
    }

    return {
      backgroundColor: '#09090b',
      animation: false, // Disabled for low latency trading chart performance
      grid: {
        left: 12,
        right: 70, // Room for right price scale
        top: 25,
        bottom: 30,
        containLabel: false,
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'cross',
          lineStyle: {
            color: '#52525b',
            width: 1,
            type: 'dashed',
          },
          label: {
            backgroundColor: '#27272a',
            color: '#f4f4f5',
            fontSize: 11,
            fontFamily: 'monospace',
            precision: 5,
          },
        },
        backgroundColor: '#18181b',
        borderColor: '#27272a',
        borderWidth: 1,
        textStyle: {
          color: '#e4e4e7',
          fontSize: 12,
          fontFamily: 'monospace',
        },
        formatter: (params: any) => {
          if (!Array.isArray(params) || params.length === 0) return '';
          const item = params[0];
          const barIdx = item.dataIndex;
          const bar = this.rawBars[barIdx];
          if (!bar) return '';

          const isUp = bar.close >= bar.open;
          const colorClass = isUp ? '#10b981' : '#f43f5e';
          const timeFull = new Date(bar.time * 1000).toTimeString().split(' ')[0];

          return `
            <div style="font-family: monospace; font-size: 11px; line-height: 1.4;">
              <div style="color: #a1a1aa; margin-bottom: 3px;">${timeFull}</div>
              <div>O: <span style="color: #fafafa">${bar.open.toFixed(5)}</span></div>
              <div>H: <span style="color: #fafafa">${bar.high.toFixed(5)}</span></div>
              <div>L: <span style="color: #fafafa">${bar.low.toFixed(5)}</span></div>
              <div>C: <span style="color: ${colorClass}">${bar.close.toFixed(5)}</span></div>
            </div>
          `;
        },
      },
      xAxis: {
        type: 'category',
        data: times,
        boundaryGap: true,
        axisLine: { lineStyle: { color: '#27272a' } },
        axisTick: { lineStyle: { color: '#27272a' } },
        axisLabel: {
          color: '#71717a',
          fontSize: 10,
          fontFamily: 'monospace',
        },
        splitLine: {
          show: true,
          lineStyle: { color: '#18181b', type: 'solid' },
        },
        axisPointer: {
          label: {
            show: true,
            backgroundColor: '#27272a',
            color: '#f4f4f5',
          },
        },
      },
      yAxis: {
        type: 'value',
        position: 'right',
        scale: true,
        axisLine: { show: true, lineStyle: { color: '#27272a' } },
        axisTick: { show: true, lineStyle: { color: '#27272a' } },
        axisLabel: {
          color: '#71717a',
          fontSize: 10,
          fontFamily: 'monospace',
          formatter: (val: number) => val.toFixed(5),
        },
        splitLine: {
          show: true,
          lineStyle: { color: '#18181b', type: 'solid' },
        },
        axisPointer: {
          label: {
            show: true,
            backgroundColor: '#27272a',
            color: '#f4f4f5',
            formatter: (p: any) => Number(p.value).toFixed(5),
          },
        },
      },
      dataZoom: [
        {
          type: 'inside',
          xAxisIndex: [0],
          start: Math.max(0, 100 - (60 / Math.max(1, this.rawBars.length)) * 100),
          end: 100,
          zoomOnMouseWheel: true,
          moveOnMouseMove: true,
          moveOnMouseWheel: false,
        },
      ],
      series: [
        {
          name: 'EURUSD',
          type: 'candlestick',
          data: values,
          itemStyle: {
            color: '#10b981',       // Up candle body fill
            color0: '#f43f5e',      // Down candle body fill
            borderColor: '#10b981', // Up candle border
            borderColor0: '#f43f5e',// Down candle border
          },
          markLine: {
            silent: true,
            symbol: ['none', 'none'],
            data: markLineData,
          },
        },
      ],
    };
  }

  /**
   * Sets or replaces full series bars.
   */
  public setBars(bars: CandleBar[]): void {
    this.rawBars = [...bars];
    this.metrics.barCount = this.rawBars.length;
    if (!this.chart) return;
    this.chart.setOption(this.buildChartOption(), false);
  }

  /**
   * Realtime single-bar tick update.
   * Updates or appends the head candle with minimal overhead.
   */
  public updateBar(bar: CandleBar): void {
    if (!this.chart || this.rawBars.length === 0) return;

    const startTick = performance.now();
    const lastIndex = this.rawBars.length - 1;
    const lastBar = this.rawBars[lastIndex];

    let timesUpdated = false;

    if (lastBar && lastBar.time === bar.time) {
      // In-place mutation of the active candle
      this.rawBars[lastIndex] = bar;
    } else {
      // New candle bar started
      this.rawBars.push(bar);
      if (this.rawBars.length > 300) {
        this.rawBars.shift();
      }
      timesUpdated = true;
    }

    const times = timesUpdated ? this.rawBars.map((b) => this.formatTime(b.time)) : undefined;
    const values = this.rawBars.map((b) => [b.open, b.close, b.low, b.high]);

    // Selective high-performance update
    const partialOption: any = {
      series: [
        {
          data: values,
        },
      ],
    };

    if (times) {
      partialOption.xAxis = {
        data: times,
      };
    }

    this.chart.setOption(partialOption, {
      notMerge: false,
      lazyUpdate: true,
      silent: true,
    });

    this.metrics.lastUpdateLatencyMs = Math.round((performance.now() - startTick) * 100) / 100;
    this.metrics.totalTicksRendered++;
    this.metrics.barCount = this.rawBars.length;
  }

  // =========================================================================
  // IChartOverlayAdapter Implementation
  // =========================================================================

  public setPriceLevels(levels: ChartPriceLevel[]): void {
    this.priceLevels.clear();
    for (const level of levels) {
      this.priceLevels.set(level.id, level);
    }
    if (this.chart) {
      this.chart.setOption(this.buildChartOption(), false);
    }
  }

  public removePriceLevel(id: string): void {
    if (this.priceLevels.delete(id) && this.chart) {
      this.chart.setOption(this.buildChartOption(), false);
    }
  }

  public clearPriceLevels(): void {
    this.priceLevels.clear();
    if (this.chart) {
      this.chart.setOption(this.buildChartOption(), false);
    }
  }

  public setOrderMarkers(_markers: ChartOrderMarker[]): void {
    // Markers support via markPoint in ECharts
  }

  /**
   * Retrieves live performance metrics for the POC comparison report.
   */
  public getMetrics(): EChartsMetrics {
    return { ...this.metrics };
  }

  /**
   * Clean teardown of ECharts instance and observers.
   */
  public destroy(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.chart) {
      this.chart.dispose();
      this.chart = null;
    }
    this.rawBars = [];
    this.priceLevels.clear();
  }
}
