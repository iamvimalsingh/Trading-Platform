/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * MOBILE CHART VIEW
 * Fullscreen mobile chart rendering using the existing LightweightChartsAdapter.
 * Preserves entry/SL/TP lines, crosshair inspection, and timeframes.
 */

import React, { lazy, Suspense, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, Zap } from 'lucide-react';
import { useTradingStore } from '../../store/useTradingStore';

const LightweightChartLazy = lazy(() => import('../chart/LightweightChart'));

export const MobileChartView: React.FC = () => {
  const selectedSymbol = useTradingStore((state) => state.selectedSymbol);
  const setSelectedSymbol = useTradingStore((state) => state.setSelectedSymbol);
  const activeSymbolList = useTradingStore((state) => state.activeSymbolList);
  const symbolCfg = useTradingStore((state) => state.symbols[selectedSymbol]);
  const quote = useTradingStore((state) => state.quotes[selectedSymbol]);
  const setMobileTab = useTradingStore((state) => state.setMobileTab);

  const [timeframe, setTimeframe] = useState<string>('1m');
  const [isSymbolPickerOpen, setSymbolPickerOpen] = useState<boolean>(false);

  const isPositive = quote ? quote.change24hPct >= 0 : true;

  return (
    <div className="flex flex-col h-full bg-zinc-950 select-none overflow-hidden relative">
      {/* Top Header & Instrument Switcher */}
      <div className="h-12 px-3 bg-zinc-950 border-b border-zinc-800/80 flex items-center justify-between shrink-0">
        {/* Symbol Button Dropdown */}
        <div className="relative">
          <button
            onClick={() => setSymbolPickerOpen(!isSymbolPickerOpen)}
            className="flex items-center gap-1.5 py-1 px-2 rounded-lg bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-left min-h-[38px] cursor-pointer"
          >
            <div className="flex flex-col">
              <span className="font-bold text-xs text-zinc-100 font-mono tracking-tight flex items-center gap-1">
                {selectedSymbol}
                <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
              </span>
              <span className="text-[9px] text-zinc-400 leading-none">
                {symbolCfg?.category || 'FOREX'}
              </span>
            </div>
          </button>

          {/* Symbol Quick Switcher Dropdown */}
          {isSymbolPickerOpen && (
            <div className="absolute top-12 left-0 w-52 max-h-64 overflow-y-auto bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl z-40 p-1 divide-y divide-zinc-800/40">
              {activeSymbolList.map((s) => (
                <button
                  key={s.symbol}
                  onClick={() => {
                    setSelectedSymbol(s.symbol);
                    setSymbolPickerOpen(false);
                  }}
                  className={`w-full px-3 py-2 text-left flex items-center justify-between text-xs rounded-lg transition-colors cursor-pointer min-h-[40px] ${
                    selectedSymbol === s.symbol
                      ? 'bg-blue-600/30 text-blue-300 font-bold'
                      : 'hover:bg-zinc-800 text-zinc-300'
                  }`}
                >
                  <span className="font-mono">{s.symbol}</span>
                  <span className="text-[10px] text-zinc-400">{s.category}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Live Mid Price & Change */}
        {quote && (
          <div className="flex flex-col items-center font-mono">
            <span className="font-bold text-xs text-zinc-100">
              {quote.mid.toFixed(symbolCfg?.digits || 2)}
            </span>
            <span
              className={`text-[10px] font-semibold ${
                isPositive ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {isPositive ? '+' : ''}
              {quote.change24hPct.toFixed(2)}%
            </span>
          </div>
        )}

        {/* Timeframe Selectors (40px touch targets) */}
        <div className="flex items-center gap-1 bg-zinc-900/80 p-0.5 rounded-lg border border-zinc-800">
          {(['1m', '5m', '15m', '1h'] as const).map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`px-2 py-1 text-xs font-mono rounded min-h-[34px] min-w-[34px] flex items-center justify-center cursor-pointer transition-colors ${
                timeframe === tf
                  ? 'bg-blue-600 text-white font-bold'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      {/* Main Chart Canvas Area */}
      <div className="flex-1 w-full relative overflow-hidden">
        <Suspense
          fallback={
            <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-zinc-950 text-zinc-500 font-mono text-xs">
              <div className="w-6 h-6 rounded-full border-2 border-zinc-800 border-t-blue-500 animate-spin" />
              <span>Loading Chart Engine...</span>
            </div>
          }
        >
          <LightweightChartLazy timeframe={timeframe} />
        </Suspense>
      </div>

      {/* Quick Trade Floating Bottom Action Bar */}
      <div className="p-2.5 bg-zinc-950/95 border-t border-zinc-800/80 flex items-center gap-2 shrink-0">
        {/* SELL Button (Min 48px touch target) */}
        <button
          onClick={() => setMobileTab('trade')}
          disabled={!quote}
          className="flex-1 min-h-[48px] py-2 px-3 rounded-xl bg-rose-950/60 hover:bg-rose-900/60 active:bg-rose-800/80 border border-rose-800/60 flex items-center justify-between cursor-pointer transition-colors"
        >
          <div className="flex items-center gap-1 text-rose-400 font-bold text-xs">
            <ArrowDown className="w-3.5 h-3.5" />
            <span>SELL</span>
          </div>
          <span className="font-mono text-xs font-bold text-zinc-100">
            {quote ? quote.bid.toFixed(symbolCfg?.digits || 2) : '—'}
          </span>
        </button>

        {/* Quick Trade Open Button */}
        <button
          onClick={() => setMobileTab('trade')}
          className="min-h-[48px] min-w-[48px] px-3 rounded-xl bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 active:bg-zinc-700 flex flex-col items-center justify-center text-zinc-300 cursor-pointer"
          title="Open Trade Ticket"
        >
          <Zap className="w-4 h-4 text-amber-400" />
          <span className="text-[9px] uppercase font-mono tracking-tight text-zinc-400">Order</span>
        </button>

        {/* BUY Button (Min 48px touch target) */}
        <button
          onClick={() => setMobileTab('trade')}
          disabled={!quote}
          className="flex-1 min-h-[48px] py-2 px-3 rounded-xl bg-emerald-950/60 hover:bg-emerald-900/60 active:bg-emerald-800/80 border border-emerald-800/60 flex items-center justify-between cursor-pointer transition-colors"
        >
          <div className="flex items-center gap-1 text-emerald-400 font-bold text-xs">
            <ArrowUp className="w-3.5 h-3.5" />
            <span>BUY</span>
          </div>
          <span className="font-mono text-xs font-bold text-zinc-100">
            {quote ? quote.ask.toFixed(symbolCfg?.digits || 2) : '—'}
          </span>
        </button>
      </div>
    </div>
  );
};
