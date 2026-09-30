/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { lazy, Suspense, useState } from 'react';
import { useTradingStore } from '../../store/useTradingStore';
import { LineChart, Activity, X, ChevronRight, Zap } from 'lucide-react';

const LightweightChartLazy = lazy(() => import('./LightweightChart'));

export const ChartContainer: React.FC = () => {
  const selectedSymbol = useTradingStore((state) => state.selectedSymbol);
  const symbolCfg = useTradingStore((state) => state.symbols[selectedSymbol]);
  const quote = useTradingStore((state) => state.quotes[selectedSymbol]);

  const [timeframe, setTimeframe] = useState<string>('5m');
  const [isChartOpen, setIsChartOpen] = useState<boolean>(false);

  const isPositive = quote ? quote.change24hPct >= 0 : true;

  return (
    <div className="flex flex-col h-full bg-white dark:bg-zinc-950 border-r border-slate-200 dark:border-zinc-800/80 transition-colors">
      {/* Chart Top Header & Controls */}
      <div className="h-10 px-3 bg-slate-50/80 dark:bg-zinc-950/90 border-b border-slate-200 dark:border-zinc-800/80 flex items-center justify-between select-none">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm text-slate-900 dark:text-zinc-100 font-mono tracking-tight">
              {selectedSymbol}
            </span>
            <span className="text-[10px] font-sans font-medium px-1.5 py-0.2 rounded bg-slate-200 dark:bg-zinc-900 text-slate-700 dark:text-zinc-400 border border-slate-300 dark:border-zinc-800">
              {symbolCfg?.name || 'Selected Instrument'}
            </span>
          </div>

          {quote && (
            <div className="hidden sm:flex items-center gap-2 font-mono text-xs">
              <span className="font-bold text-slate-900 dark:text-zinc-200">
                {quote.mid.toFixed(symbolCfg?.digits || 2)}
              </span>
              <span
                className={`text-[11px] font-semibold ${
                  isPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {isPositive ? '+' : ''}
                {quote.change24hPct.toFixed(2)}%
              </span>
            </div>
          )}
        </div>

        {/* Controls / Close Button if chart is open */}
        <div className="flex items-center gap-2">
          {isChartOpen ? (
            <div className="flex items-center gap-2">
              {/* Timeframe Selectors */}
              <div className="flex items-center gap-0.5 bg-slate-100 dark:bg-zinc-900 p-0.5 rounded-md border border-slate-200 dark:border-zinc-800">
                {(['1m', '5m', '15m', '1h'] as const).map((tf) => (
                  <button
                    key={tf}
                    onClick={() => setTimeframe(tf)}
                    className={`px-2 py-0.5 text-xs font-mono rounded transition-colors cursor-pointer ${
                      timeframe === tf
                        ? 'bg-blue-600 text-white font-bold'
                        : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200'
                    }`}
                  >
                    {tf}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setIsChartOpen(false)}
                className="px-2.5 py-1 text-xs font-mono rounded-md bg-slate-200 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 hover:bg-slate-300 dark:hover:bg-zinc-700 flex items-center gap-1 cursor-pointer transition-colors"
                title="Close Chart"
              >
                <X className="w-3.5 h-3.5" />
                <span>Close Chart</span>
              </button>
            </div>
          ) : (
            <button
              onClick={() => setIsChartOpen(true)}
              className="px-3 py-1 text-xs font-mono font-bold rounded-lg bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white flex items-center gap-1.5 shadow-sm cursor-pointer transition-all"
            >
              <LineChart className="w-3.5 h-3.5" />
              <span>See Price on Chart</span>
            </button>
          )}
        </div>
      </div>

      {/* Chart Canvas Area or Market Overview Preview */}
      <div className="flex-1 w-full h-full relative overflow-hidden bg-white dark:bg-zinc-950 flex flex-col">
        {isChartOpen ? (
          <Suspense
            fallback={
              <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-slate-50 dark:bg-zinc-950 text-slate-500 dark:text-zinc-600">
                <div className="w-8 h-8 rounded-full border-2 border-slate-300 dark:border-zinc-800 border-t-blue-500 animate-spin" />
                <div className="flex flex-col items-center gap-1 font-mono text-xs">
                  <span className="text-slate-600 dark:text-zinc-400">Loading Lightweight Candlestick Chart...</span>
                </div>
              </div>
            }
          >
            <LightweightChartLazy timeframe={timeframe} />
          </Suspense>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center select-none bg-gradient-to-b from-slate-50/50 to-white dark:from-zinc-950 dark:to-zinc-900/40">
            {/* Subtle Professional Waveform / Pulse Preview Graphic */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-20 dark:opacity-10 flex items-center justify-center">
              <div className="w-[600px] h-[200px] bg-gradient-to-r from-blue-500/20 via-emerald-500/20 to-blue-500/20 blur-3xl rounded-full animate-pulse" />
            </div>

            <div className="relative z-10 max-w-md flex flex-col items-center gap-5 p-8 rounded-2xl bg-white/80 dark:bg-zinc-900/60 border border-slate-200 dark:border-zinc-800/80 shadow-xl backdrop-blur-md">
              <div className="w-12 h-12 rounded-2xl bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800/60 flex items-center justify-center text-blue-600 dark:text-blue-400 shadow-inner">
                <Activity className="w-6 h-6 animate-pulse" />
              </div>

              <div className="flex flex-col items-center gap-1.5">
                <h3 className="text-base font-bold text-slate-900 dark:text-zinc-100 font-mono tracking-tight">
                  {selectedSymbol} Market Overview
                </h3>
                <p className="text-xs text-slate-500 dark:text-zinc-400 font-sans max-w-xs">
                  Real-time market data feed is active. Click below to load the interactive Lightweight Candlestick Chart.
                </p>
              </div>

              {quote ? (
                <div className="grid grid-cols-3 gap-3 w-full bg-slate-50 dark:bg-zinc-950/60 p-3 rounded-xl border border-slate-200 dark:border-zinc-800/60 font-mono text-xs">
                  <div className="flex flex-col">
                    <span className="text-[10px] text-slate-400 dark:text-zinc-500">Bid</span>
                    <span className="font-bold text-slate-800 dark:text-zinc-200">
                      {quote.bid.toFixed(symbolCfg?.digits || 2)}
                    </span>
                  </div>
                  <div className="flex flex-col border-x border-slate-200 dark:border-zinc-800 px-2">
                    <span className="text-[10px] text-slate-400 dark:text-zinc-500">Ask</span>
                    <span className="font-bold text-slate-800 dark:text-zinc-200">
                      {quote.ask.toFixed(symbolCfg?.digits || 2)}
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] text-slate-400 dark:text-zinc-500">24h Change</span>
                    <span className={`font-bold ${isPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                      {isPositive ? '+' : ''}{quote.change24hPct.toFixed(2)}%
                    </span>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 font-mono text-xs text-amber-500">
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                  <span>Waiting for market quote feed...</span>
                </div>
              )}

              <button
                onClick={() => setIsChartOpen(true)}
                className="w-full py-3 px-5 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-mono text-xs font-bold shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2 cursor-pointer transition-all transform hover:scale-[1.01]"
              >
                <span>See Price on Chart</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChartContainer;
