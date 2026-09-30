/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * MOBILE CHART VIEW
 * Fullscreen mobile chart rendering with Market Overview preview and See Price on Chart CTA.
 */

import React, { lazy, Suspense, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, Zap, LineChart, Activity, X, ChevronRight } from 'lucide-react';
import { useTradingStore } from '../../store/useTradingStore';

const LightweightChartLazy = lazy(() => import('../chart/LightweightChart'));

export const MobileChartView: React.FC = () => {
  const selectedSymbol = useTradingStore((state) => state.selectedSymbol);
  const setSelectedSymbol = useTradingStore((state) => state.setSelectedSymbol);
  const activeSymbolList = useTradingStore((state) => state.activeSymbolList);
  const symbolCfg = useTradingStore((state) => state.symbols[selectedSymbol]);
  const quote = useTradingStore((state) => state.quotes[selectedSymbol]);
  const setMobileTab = useTradingStore((state) => state.setMobileTab);

  const [timeframe, setTimeframe] = useState<string>('5m');
  const [isChartOpen, setIsChartOpen] = useState<boolean>(false);
  const [isSymbolPickerOpen, setSymbolPickerOpen] = useState<boolean>(false);

  const isPositive = quote ? quote.change24hPct >= 0 : true;

  return (
    <div className="flex flex-col h-full bg-white dark:bg-zinc-950 select-none overflow-hidden relative transition-colors">
      {/* Top Header & Instrument Switcher */}
      <div className="h-12 px-3 bg-slate-50/90 dark:bg-zinc-950 border-b border-slate-200 dark:border-zinc-800/80 flex items-center justify-between shrink-0">
        {/* Symbol Button Dropdown */}
        <div className="relative">
          <button
            onClick={() => setSymbolPickerOpen(!isSymbolPickerOpen)}
            className="flex items-center gap-1.5 py-1 px-2.5 rounded-lg bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 hover:bg-slate-50 dark:hover:bg-zinc-800 text-left min-h-[38px] cursor-pointer"
          >
            <div className="flex flex-col">
              <span className="font-bold text-xs text-slate-900 dark:text-zinc-100 font-mono tracking-tight flex items-center gap-1">
                {selectedSymbol}
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 dark:text-zinc-400" />
              </span>
              <span className="text-[9px] text-slate-500 dark:text-zinc-400 leading-none font-sans font-medium">
                {symbolCfg?.category || 'FOREX'}
              </span>
            </div>
          </button>

          {/* Symbol Quick Switcher Dropdown */}
          {isSymbolPickerOpen && (
            <div className="absolute top-12 left-0 w-56 max-h-64 overflow-y-auto bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl shadow-2xl z-40 p-1 divide-y divide-slate-100 dark:divide-zinc-800/40">
              {activeSymbolList.map((s) => (
                <button
                  key={s.symbol}
                  onClick={() => {
                    setSelectedSymbol(s.symbol);
                    setSymbolPickerOpen(false);
                  }}
                  className={`w-full px-3 py-2 text-left flex items-center justify-between text-xs rounded-lg transition-colors cursor-pointer min-h-[40px] ${
                    selectedSymbol === s.symbol
                      ? 'bg-blue-50 dark:bg-blue-600/30 text-blue-600 dark:text-blue-300 font-bold'
                      : 'hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-700 dark:text-zinc-300'
                  }`}
                >
                  <span className="font-mono">{s.symbol}</span>
                  <span className="text-[10px] text-slate-400 dark:text-zinc-500">{s.category}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Live Mid Price & Change */}
        {quote && (
          <div className="flex flex-col items-center font-mono">
            <span className="font-bold text-xs text-slate-900 dark:text-zinc-100">
              {quote.mid.toFixed(symbolCfg?.digits || 2)}
            </span>
            <span
              className={`text-[10px] font-semibold ${
                isPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              {isPositive ? '+' : ''}
              {quote.change24hPct.toFixed(2)}%
            </span>
          </div>
        )}

        {/* Chart Toggle / Close / Timeframe Controls */}
        <div className="flex items-center gap-2">
          {isChartOpen ? (
            <div className="flex items-center gap-1.5">
              <div className="flex items-center gap-0.5 bg-slate-100 dark:bg-zinc-900/80 p-0.5 rounded-lg border border-slate-200 dark:border-zinc-800">
                {(['1m', '5m', '15m', '1h'] as const).map((tf) => (
                  <button
                    key={tf}
                    onClick={() => setTimeframe(tf)}
                    className={`px-1.5 py-1 text-[11px] font-mono rounded min-h-[32px] min-w-[32px] flex items-center justify-center cursor-pointer transition-colors ${
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
                className="p-1.5 rounded-lg bg-slate-200 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 cursor-pointer"
                title="Close Chart"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setIsChartOpen(true)}
              className="px-2.5 py-1.5 text-xs font-mono font-bold rounded-lg bg-blue-600 text-white flex items-center gap-1 shadow-sm cursor-pointer"
            >
              <LineChart className="w-3.5 h-3.5" />
              <span>Chart</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Chart Canvas Area or Market Overview Preview */}
      <div className="flex-1 w-full relative overflow-hidden bg-white dark:bg-zinc-950 flex flex-col">
        {isChartOpen ? (
          <Suspense
            fallback={
              <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-slate-50 dark:bg-zinc-950 text-slate-400 dark:text-zinc-500 font-mono text-xs">
                <div className="w-6 h-6 rounded-full border-2 border-slate-300 dark:border-zinc-800 border-t-blue-500 animate-spin" />
                <span>Loading Lightweight Candlestick Chart...</span>
              </div>
            }
          >
            <LightweightChartLazy timeframe={timeframe} />
          </Suspense>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center p-4 text-center select-none bg-gradient-to-b from-slate-50/50 to-white dark:from-zinc-950 dark:to-zinc-900/40">
            <div className="relative z-10 w-full max-w-sm flex flex-col items-center gap-4 p-6 rounded-2xl bg-white/90 dark:bg-zinc-900/80 border border-slate-200 dark:border-zinc-800 shadow-xl backdrop-blur-md">
              <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800/60 flex items-center justify-center text-blue-600 dark:text-blue-400">
                <Activity className="w-5 h-5 animate-pulse" />
              </div>

              <div className="flex flex-col items-center gap-1">
                <h3 className="text-sm font-bold text-slate-900 dark:text-zinc-100 font-mono tracking-tight">
                  {selectedSymbol} Market Overview
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-zinc-400 font-sans max-w-xs">
                  Live market quotes connected. Tap below to load the interactive Lightweight Candlestick Chart.
                </p>
              </div>

              {quote ? (
                <div className="grid grid-cols-3 gap-2 w-full bg-slate-50 dark:bg-zinc-950/60 p-2.5 rounded-xl border border-slate-200 dark:border-zinc-800/60 font-mono text-[11px]">
                  <div className="flex flex-col">
                    <span className="text-[9px] text-slate-400">Bid</span>
                    <span className="font-bold text-slate-800 dark:text-zinc-200">
                      {quote.bid.toFixed(symbolCfg?.digits || 2)}
                    </span>
                  </div>
                  <div className="flex flex-col border-x border-slate-200 dark:border-zinc-800 px-1">
                    <span className="text-[9px] text-slate-400">Ask</span>
                    <span className="font-bold text-slate-800 dark:text-zinc-200">
                      {quote.ask.toFixed(symbolCfg?.digits || 2)}
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[9px] text-slate-400">Change</span>
                    <span className={`font-bold ${isPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                      {isPositive ? '+' : ''}{quote.change24hPct.toFixed(2)}%
                    </span>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 font-mono text-xs text-amber-500">
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                  <span>Connecting to quote feed...</span>
                </div>
              )}

              <button
                onClick={() => setIsChartOpen(true)}
                className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-mono text-xs font-bold shadow-md flex items-center justify-center gap-2 cursor-pointer transition-all"
              >
                <span>See Price on Chart</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Quick Trade Floating Bottom Action Bar */}
      <div className="p-2.5 bg-slate-50/95 dark:bg-zinc-950/95 border-t border-slate-200 dark:border-zinc-800/80 flex items-center gap-2 shrink-0">
        <button
          onClick={() => setMobileTab('trade')}
          disabled={!quote}
          className="flex-1 min-h-[48px] py-2 px-3 rounded-xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 dark:hover:bg-rose-900/60 active:bg-rose-200 dark:active:bg-rose-800/80 border border-rose-300 dark:border-rose-800/60 flex items-center justify-between cursor-pointer transition-colors"
        >
          <div className="flex items-center gap-1 text-rose-600 dark:text-rose-400 font-bold text-xs">
            <ArrowDown className="w-3.5 h-3.5" />
            <span>SELL</span>
          </div>
          <span className="font-mono text-xs font-bold text-rose-700 dark:text-zinc-100">
            {quote ? quote.bid.toFixed(symbolCfg?.digits || 2) : '—'}
          </span>
        </button>

        <button
          onClick={() => setMobileTab('trade')}
          className="min-h-[48px] min-w-[48px] px-3 rounded-xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 hover:bg-slate-100 dark:hover:bg-zinc-800 active:bg-slate-200 dark:active:bg-zinc-700 flex flex-col items-center justify-center text-slate-700 dark:text-zinc-300 cursor-pointer"
          title="Open Trade Ticket"
        >
          <Zap className="w-4 h-4 text-amber-500" />
          <span className="text-[9px] uppercase font-mono tracking-tight text-slate-500 dark:text-zinc-400 font-medium">Order</span>
        </button>

        <button
          onClick={() => setMobileTab('trade')}
          disabled={!quote}
          className="flex-1 min-h-[48px] py-2 px-3 rounded-xl bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:hover:bg-emerald-900/60 active:bg-emerald-200 dark:active:bg-emerald-800/80 border border-emerald-300 dark:border-emerald-800/60 flex items-center justify-between cursor-pointer transition-colors"
        >
          <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-bold text-xs">
            <ArrowUp className="w-3.5 h-3.5" />
            <span>BUY</span>
          </div>
          <span className="font-mono text-xs font-bold text-emerald-700 dark:text-zinc-100">
            {quote ? quote.ask.toFixed(symbolCfg?.digits || 2) : '—'}
          </span>
        </button>
      </div>
    </div>
  );
};

export default MobileChartView;
