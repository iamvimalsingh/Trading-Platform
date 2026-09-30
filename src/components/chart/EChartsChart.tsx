/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * APACHE ECHARTS CHART POC COMPONENT
 * Implements an isolated proof-of-concept for Apache ECharts.
 * Uses identical IChartDataProvider and domain overlay models.
 * 
 * NO TRADINGVIEW ATTRIBUTION:
 * Licensed under Apache-2.0. Clean isolated component.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTradingStore } from '../../store/useTradingStore';
import { defaultChartDataProvider } from '../../services/chartDataProvider';
import { EChartsAdapter, EChartsMetrics } from './EChartsAdapter';
import {
  ChartPriceLevel,
  IChartDataProvider,
  IChartInteractionAdapter,
} from '../../types/chart';
import { Activity, Cpu } from 'lucide-react';

interface EChartsChartProps {
  timeframe: string;
  dataProvider?: IChartDataProvider;
  interactionAdapter?: IChartInteractionAdapter;
}

export const EChartsChart: React.FC<EChartsChartProps> = ({
  timeframe,
  dataProvider = defaultChartDataProvider,
  interactionAdapter,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<EChartsAdapter | null>(null);
  const [metrics, setMetrics] = useState<EChartsMetrics>({
    initRenderTimeMs: 0,
    lastUpdateLatencyMs: 0,
    totalTicksRendered: 0,
    barCount: 0,
  });

  const selectedSymbol = useTradingStore((state) => state.selectedSymbol);
  const quote = useTradingStore((state) => state.quotes[selectedSymbol]);
  const positions = useTradingStore((state) => state.positions);

  // Derive active trading price levels for the selected instrument
  const activeLevels = useMemo(() => {
    const levels: ChartPriceLevel[] = [];
    const openPositions = positions.filter(
      (p) => p.symbol === selectedSymbol && p.status === 'OPEN'
    );

    for (const pos of openPositions) {
      // Entry Level
      levels.push({
        id: `entry_${pos.id}`,
        type: 'ENTRY',
        price: pos.openPrice,
        label: `${pos.side} ${pos.volume}L @ ${pos.openPrice}`,
        isDraggable: false,
      });

      // Stop Loss Level (if defined)
      if (pos.stopLoss) {
        levels.push({
          id: `sl_${pos.id}`,
          type: 'STOP_LOSS',
          price: pos.stopLoss,
          label: `SL @ ${pos.stopLoss}`,
          isDraggable: true,
        });
      }

      // Take Profit Level (if defined)
      if (pos.takeProfit) {
        levels.push({
          id: `tp_${pos.id}`,
          type: 'TAKE_PROFIT',
          price: pos.takeProfit,
          label: `TP @ ${pos.takeProfit}`,
          isDraggable: true,
        });
      }
    }

    return levels;
  }, [positions, selectedSymbol]);

  // Mount adapter and initialize chart data
  useEffect(() => {
    if (!containerRef.current) return;

    const adapter = new EChartsAdapter(containerRef.current, interactionAdapter);
    adapterRef.current = adapter;

    let isCancelled = false;
    let unsubscribeBarStream: (() => void) | null = null;

    // Load initial normalized historical bars via IChartDataProvider
    dataProvider
      .getHistoricalBars(selectedSymbol, timeframe, 120)
      .then((bars) => {
        if (isCancelled) return;
        adapter.init(bars);
        adapter.setPriceLevels([]);
        setMetrics(adapter.getMetrics());

        // Subscribe to live bar streaming updates
        unsubscribeBarStream = dataProvider.subscribeBarUpdates(
          selectedSymbol,
          timeframe,
          (updatedBar) => {
            if (!isCancelled) {
              adapter.updateBar(updatedBar);
              setMetrics(adapter.getMetrics());
            }
          }
        );
      });

    return () => {
      isCancelled = true;
      if (unsubscribeBarStream) {
        unsubscribeBarStream();
      }
      adapter.destroy();
      adapterRef.current = null;
    };
  }, [selectedSymbol, timeframe, dataProvider, interactionAdapter]);

  // Clean chart rule: keep price levels empty by default
  useEffect(() => {
    if (adapterRef.current) {
      adapterRef.current.setPriceLevels([]);
    }
  }, [activeLevels]);

  // Synchronize live Bid/Ask lines when quote updates
  useEffect(() => {
    if (adapterRef.current && quote) {
      adapterRef.current.setBidAsk(quote.bid, quote.ask);
    }
  }, [quote?.bid, quote?.ask]);

  return (
    <div className="w-full h-full relative flex flex-col">
      {/* ECharts Telemetry & POC Status Overlay Bar */}
      <div className="absolute top-2 left-2 z-10 flex items-center gap-2 bg-white/90 dark:bg-zinc-900/90 border border-slate-200 dark:border-zinc-700/60 rounded-md px-2 py-1 text-[10px] font-mono text-slate-700 dark:text-zinc-300 shadow-lg backdrop-blur-xs pointer-events-none">
        <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-bold">
          <Activity className="w-3 h-3" />
          Apache ECharts POC
        </span>
        <span className="text-slate-300 dark:text-zinc-600">|</span>
        <span className="text-slate-500 dark:text-zinc-400">Init: {metrics.initRenderTimeMs}ms</span>
        <span className="text-slate-300 dark:text-zinc-600">|</span>
        <span className="text-slate-500 dark:text-zinc-400">Latency: {metrics.lastUpdateLatencyMs}ms</span>
        <span className="text-slate-300 dark:text-zinc-600">|</span>
        <span className="text-slate-500 dark:text-zinc-400">Ticks: {metrics.totalTicksRendered}</span>
      </div>

      {/* Chart DOM Container */}
      <div ref={containerRef} className="w-full h-full relative" />
    </div>
  );
};

export default EChartsChart;
