/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef } from 'react';
import { SymbolConfig } from '../../types/trading';
import { useTradingStore } from '../../store/useTradingStore';

interface WatchlistItemProps {
  symbolConfig: SymbolConfig;
}

export const WatchlistItem: React.FC<WatchlistItemProps> = React.memo(({ symbolConfig }) => {
  const symbol = symbolConfig.symbol;
  
  // Isolated selector subscription: Only re-renders when this specific quote or selection changes
  const quote = useTradingStore((state) => state.quotes[symbol]);
  const isSelected = useTradingStore((state) => state.selectedSymbol === symbol);
  const setSelectedSymbol = useTradingStore((state) => state.setSelectedSymbol);

  // Price Flash Tracking via direct DOM class mutation to prevent React setState re-render loops
  const bidCellRef = useRef<HTMLDivElement>(null);
  const prevBidRef = useRef<number>(quote ? quote.bid : 0);
  const flashTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!quote || !bidCellRef.current) return;
    if (prevBidRef.current !== 0 && quote.bid !== prevBidRef.current) {
      const isUp = quote.bid > prevBidRef.current;
      const el = bidCellRef.current;
      if (flashTimerRef.current) {
        window.clearTimeout(flashTimerRef.current);
      }
      el.classList.remove('bg-emerald-100', 'dark:bg-emerald-950/80', 'text-emerald-700', 'dark:text-emerald-300', 'bg-rose-100', 'dark:bg-rose-950/80', 'text-rose-700', 'dark:text-rose-300');
      if (isUp) {
        el.classList.add('bg-emerald-100', 'dark:bg-emerald-950/80', 'text-emerald-700', 'dark:text-emerald-300');
      } else {
        el.classList.add('bg-rose-100', 'dark:bg-rose-950/80', 'text-rose-700', 'dark:text-rose-300');
      }
      flashTimerRef.current = window.setTimeout(() => {
        el.classList.remove('bg-emerald-100', 'dark:bg-emerald-950/80', 'text-emerald-700', 'dark:text-emerald-300', 'bg-rose-100', 'dark:bg-rose-950/80', 'text-rose-700', 'dark:text-rose-300');
        flashTimerRef.current = null;
      }, 400);
    }
    prevBidRef.current = quote.bid;
    return () => {
      if (flashTimerRef.current) {
        window.clearTimeout(flashTimerRef.current);
      }
    };
  }, [quote?.bid]);

  const hasQuote = Boolean(quote && typeof quote.bid === 'number');
  const isPositive = hasQuote ? quote!.change24hPct >= 0 : true;

  return (
    <div
      onClick={() => setSelectedSymbol(symbol)}
      className={`group flex items-center justify-between px-3 py-2 text-xs font-mono border-b border-slate-100 dark:border-zinc-900/60 cursor-pointer transition-colors ${
        isSelected
          ? 'bg-blue-50/80 dark:bg-zinc-800/90 border-l-3 border-l-blue-600'
          : 'hover:bg-slate-50 dark:hover:bg-zinc-900/70 border-l-3 border-l-transparent'
      }`}
    >
      {/* Symbol Name & Category Badge */}
      <div className="flex flex-col min-w-0 pr-1">
        <div className="flex items-center gap-1.5">
          <span className={`font-bold transition-colors ${
            isSelected
              ? 'text-blue-600 dark:text-blue-400'
              : 'text-slate-900 dark:text-zinc-100 group-hover:text-blue-600 dark:group-hover:text-blue-400'
          }`}>
            {symbol}
          </span>
          <span className="text-[9px] px-1 py-0.2 rounded bg-slate-100 dark:bg-zinc-900 text-slate-500 dark:text-zinc-500 border border-slate-200 dark:border-zinc-800 uppercase font-sans font-medium">
            {symbolConfig.category}
          </span>
          {quote?.marketStatus === 'STALE' && (
            <span className="text-[8px] px-1 py-0.2 rounded bg-amber-100 dark:bg-amber-950/80 text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-800 font-mono font-bold tracking-wider uppercase">
              STALE
            </span>
          )}
          {(quote?.marketStatus === 'SIMULATED' || quote?.source === 'simulated') && (
            <span className="text-[8px] px-1 py-0.2 rounded bg-purple-100 dark:bg-purple-950/80 text-purple-700 dark:text-purple-400 border border-purple-300 dark:border-purple-800 font-mono font-bold tracking-wider uppercase">
              SIM
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-slate-500 dark:text-zinc-400 font-sans">
          {hasQuote ? (
            <>
              <span>Spr: {quote!.spread}</span>
              <span className={isPositive ? 'text-emerald-600 dark:text-emerald-400 font-mono font-medium' : 'text-rose-600 dark:text-rose-400 font-mono font-medium'}>
                {isPositive ? '+' : ''}{quote!.change24hPct.toFixed(2)}%
              </span>
            </>
          ) : (
            <span className="text-slate-400 dark:text-zinc-500 italic">Waiting for market data</span>
          )}
        </div>
      </div>

      {/* Bid / Ask Price Cell with Flash Transitions */}
      <div className="flex items-center gap-1.5 font-mono">
        <div
          ref={bidCellRef}
          className="flex flex-col items-end px-2 py-1 rounded-md transition-colors duration-300 text-slate-800 dark:text-zinc-200 min-w-[54px]"
        >
          <span className="text-[9px] uppercase tracking-wider text-slate-400 dark:text-zinc-500 font-sans font-medium">Bid</span>
          <span className="font-bold tracking-tight text-slate-900 dark:text-zinc-100">
            {hasQuote ? quote!.bid.toFixed(symbolConfig.digits) : '—'}
          </span>
        </div>

        <div className="flex flex-col items-end px-2 py-1 rounded-md bg-slate-100 dark:bg-zinc-900/60 text-slate-700 dark:text-zinc-300 min-w-[54px]">
          <span className="text-[9px] uppercase tracking-wider text-slate-400 dark:text-zinc-500 font-sans font-medium">Ask</span>
          <span className="font-medium tracking-tight">
            {hasQuote ? quote!.ask.toFixed(symbolConfig.digits) : '—'}
          </span>
        </div>
      </div>
    </div>
  );
});

WatchlistItem.displayName = 'WatchlistItem';
