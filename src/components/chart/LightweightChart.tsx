/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * CHART COMPONENT (LIGHTWEIGHT CHARTS — CANDLESTICK ONLY)
 * Consumes IChartDataProvider and IChartOverlayAdapter via LightweightChartsAdapter.
 */

import React, { useEffect, useMemo, useRef } from 'react';
import { useTradingStore } from '../../store/useTradingStore';
import { defaultChartDataProvider } from '../../services/chartDataProvider';
import { LightweightChartsAdapter } from './LightweightChartsAdapter';
import {
  ChartPriceLevel,
  IChartDataProvider,
  IChartInteractionAdapter,
} from '../../types/chart';

interface LightweightChartProps {
  timeframe: string;
  dataProvider?: IChartDataProvider;
  interactionAdapter?: IChartInteractionAdapter;
}

export const LightweightChart: React.FC<LightweightChartProps> = ({
  timeframe,
  dataProvider = defaultChartDataProvider,
  interactionAdapter,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<LightweightChartsAdapter | null>(null);

  const selectedSymbol = useTradingStore((state) => state.selectedSymbol);
  const quote = useTradingStore((state) => state.quotes[selectedSymbol]);
  const positions = useTradingStore((state) => state.positions);
  const theme = useTradingStore((state) => state.theme);

  const activeLevels = useMemo(() => {
    const levels: ChartPriceLevel[] = [];
    const openPositions = positions.filter(
      (p) => p.symbol === selectedSymbol && p.status === 'OPEN'
    );

    for (const pos of openPositions) {
      levels.push({
        id: `entry_${pos.id}`,
        type: 'ENTRY',
        price: pos.openPrice,
        label: `${pos.side} ${pos.volume}L @ ${pos.openPrice}`,
        isDraggable: false,
      });

      if (pos.stopLoss) {
        levels.push({
          id: `sl_${pos.id}`,
          type: 'STOP_LOSS',
          price: pos.stopLoss,
          label: `SL @ ${pos.stopLoss}`,
          isDraggable: true,
        });
      }

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

  useEffect(() => {
    if (!containerRef.current) return;

    const adapter = new LightweightChartsAdapter(
      containerRef.current,
      interactionAdapter
    );
    adapterRef.current = adapter;

    let isCancelled = false;
    let unsubscribeBarStream: (() => void) | null = null;

    dataProvider
      .getHistoricalBars(selectedSymbol, timeframe, 120)
      .then((bars) => {
        if (isCancelled) return;
        adapter.init(bars, theme);
        adapter.setPriceLevels([]);

        unsubscribeBarStream = dataProvider.subscribeBarUpdates(
          selectedSymbol,
          timeframe,
          (updatedBar) => {
            if (!isCancelled) {
              adapter.updateBar(updatedBar);
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

  useEffect(() => {
    if (adapterRef.current) {
      adapterRef.current.applyTheme(theme);
    }
  }, [theme]);

  useEffect(() => {
    if (adapterRef.current) {
      adapterRef.current.setPriceLevels([]);
    }
  }, [activeLevels]);

  useEffect(() => {
    if (adapterRef.current && quote) {
      adapterRef.current.setBidAsk(quote.bid, quote.ask);
    }
  }, [quote?.bid, quote?.ask]);

  return (
    <div className="w-full h-full relative">
      <div ref={containerRef} className="w-full h-full" />
      {!quote && (
        <div className="absolute top-3 right-3 bg-zinc-900/90 backdrop-blur-sm border border-zinc-800 text-zinc-400 text-[11px] font-sans px-2.5 py-1 rounded shadow-lg pointer-events-none flex items-center gap-1.5 z-10">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          <span>Waiting for market data ({selectedSymbol})</span>
        </div>
      )}
      {quote?.marketStatus === 'CLOSED' && (
        <div className="absolute top-3 right-3 bg-zinc-900/90 backdrop-blur-sm border border-zinc-700 text-zinc-300 text-[11px] font-mono px-2.5 py-1 rounded shadow-lg pointer-events-none flex items-center gap-1.5 z-10">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
          <span>MARKET CLOSED ({selectedSymbol})</span>
        </div>
      )}
      {quote?.marketStatus === 'STALE' && (
        <div className="absolute top-3 right-3 bg-amber-950/90 backdrop-blur-sm border border-amber-800 text-amber-300 text-[11px] font-mono px-2.5 py-1 rounded shadow-lg pointer-events-none flex items-center gap-1.5 z-10">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
          <span>STALE MARKET FEED ({selectedSymbol})</span>
        </div>
      )}
    </div>
  );
};

export default LightweightChart;
