/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { lazy, Suspense, useState } from 'react';
import { BarChart3, Maximize2, RefreshCw } from 'lucide-react';
import { useTradingStore } from '../../store/useTradingStore';

// LAZY-LOAD THE CHART ENGINES DYNAMICALLY — INITIAL SHELL DOES NOT BLOCK
const LightweightChartLazy = lazy(() => import('./LightweightChart'));
const EChartsChartLazy = lazy(() => import('./EChartsChart'));

export const ChartContainer: React.FC = () => {
  const selectedSymbol = useTradingStore((state) => state.selectedSymbol);
  const symbolCfg = useTradingStore((state) => state.symbols[selectedSymbol]);
  const quote = useTradingStore((state) => state.quotes[selectedSymbol]);

  const [timeframe, setTimeframe] = useState<string>('1m');
  const [chartEngine, setChartEngine] = useState<'lightweight' | 'echarts'>('lightweight');

  const isPositive = quote ? quote.change24hPct >= 0 : true;

  return (
    <div className="flex flex-col h-full bg-zinc-950 border-r border-zinc-800/80">
      {/* Chart Top Header & Controls */}
      <div className="h-10 px-3 bg-zinc-950/90 border-b border-zinc-800/80 flex items-center justify-between select-none">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm text-zinc-100 font-mono tracking-tight">
              {selectedSymbol}
            </span>
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-zinc-900 text-zinc-400 border border-zinc-800 font-sans">
              {symbolCfg?.name || 'Selected Instrument'}
            </span>
          </div>

          {quote && (
            <div className="hidden sm:flex items-center gap-2 font-mono text-xs">
              <span className="font-semibold text-zinc-200">
                {quote.mid.toFixed(symbolCfg?.digits || 2)}
              </span>
              <span
                className={`text-[11px] font-medium ${
                  isPositive ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {isPositive ? '+' : ''}
                {quote.change24hPct.toFixed(2)}%
              </span>
              <span className="text-[10px] text-zinc-500 font-sans">
                H: {quote.high24h.toFixed(symbolCfg?.digits || 2)} L:{' '}
                {quote.low24h.toFixed(symbolCfg?.digits || 2)}
              </span>
            </div>
          )}
        </div>

        {/* Controls: Engine Switcher & Timeframe Selectors */}
        <div className="flex items-center gap-2">
          {/* Chart Engine Switcher (POC evaluation) */}
          <div className="flex items-center bg-zinc-900/80 p-0.5 rounded border border-zinc-800 text-[10px] font-mono">
            <button
              onClick={() => setChartEngine('lightweight')}
              className={`px-1.5 py-0.5 rounded transition-colors cursor-pointer ${
                chartEngine === 'lightweight'
                  ? 'bg-zinc-800 text-zinc-200 font-semibold'
                  : 'text-zinc-500 hover:text-zinc-400'
              }`}
            >
              Lightweight
            </button>
            <button
              onClick={() => setChartEngine('echarts')}
              className={`px-1.5 py-0.5 rounded transition-colors cursor-pointer flex items-center gap-1 ${
                chartEngine === 'echarts'
                  ? 'bg-amber-950/60 text-amber-300 font-semibold border border-amber-800/60'
                  : 'text-zinc-500 hover:text-zinc-400'
              }`}
            >
              ECharts POC
            </button>
          </div>

          {/* Timeframe Selectors */}
          <div className="flex items-center gap-1">
            {(['1m', '5m', '15m', '1h'] as const).map((tf) => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={`px-2 py-0.5 text-xs font-mono rounded transition-colors cursor-pointer ${
                  timeframe === tf
                    ? 'bg-zinc-800 text-blue-400 font-semibold border border-zinc-700'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Chart Canvas Area with Progressive Skeleton Fallback */}
      <div className="flex-1 w-full h-full relative overflow-hidden">
        <Suspense
          fallback={
            <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-zinc-950 text-zinc-600">
              <div className="w-8 h-8 rounded-full border-2 border-zinc-800 border-t-blue-500 animate-spin" />
              <div className="flex flex-col items-center gap-1 font-mono text-xs">
                <span className="text-zinc-400">Loading Canvas Engine...</span>
                <span className="text-[10px] text-zinc-600">
                  {chartEngine === 'lightweight'
                    ? 'TradingView Lightweight Charts (~45KB)'
                    : 'Apache ECharts POC Engine (~320KB)'}
                </span>
              </div>
            </div>
          }
        >
          {chartEngine === 'lightweight' ? (
            <LightweightChartLazy timeframe={timeframe} />
          ) : (
            <EChartsChartLazy timeframe={timeframe} />
          )}
        </Suspense>
      </div>
    </div>
  );
};
