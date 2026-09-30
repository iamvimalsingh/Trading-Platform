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
      el.classList.remove('bg-emerald-950/80', 'text-emerald-300', 'bg-rose-950/80', 'text-rose-300');
      if (isUp) {
        el.classList.add('bg-emerald-950/80', 'text-emerald-300');
      } else {
        el.classList.add('bg-rose-950/80', 'text-rose-300');
      }
      flashTimerRef.current = window.setTimeout(() => {
        el.classList.remove('bg-emerald-950/80', 'text-emerald-300', 'bg-rose-950/80', 'text-rose-300');
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
      className={`group flex items-center justify-between px-3 py-2 text-xs font-mono border-b border-zinc-900/60 cursor-pointer transition-colors ${
        isSelected
          ? 'bg-zinc-800/90 border-l-2 border-l-blue-500'
          : 'hover:bg-zinc-900/70 border-l-2 border-l-transparent'
      }`}
    >
      {/* Symbol Name & Category Badge */}
      <div className="flex flex-col min-w-0 pr-1">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-zinc-100 group-hover:text-blue-400 transition-colors">
            {symbol}
          </span>
          <span className="text-[9px] px-1 py-0.2 rounded bg-zinc-900 text-zinc-500 border border-zinc-800 uppercase font-sans">
            {symbolConfig.category}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 font-sans">
          {hasQuote ? (
            <>
              <span>Spr: {quote!.spread}</span>
              <span className={isPositive ? 'text-emerald-500 font-mono' : 'text-rose-500 font-mono'}>
                {isPositive ? '+' : ''}{quote!.change24hPct.toFixed(2)}%
              </span>
            </>
          ) : (
            <span className="text-zinc-500 italic">Waiting for quote</span>
          )}
        </div>
      </div>

      {/* Bid / Ask Price Cell with Flash Transitions */}
      <div className="flex items-center gap-2">
        <div
          ref={bidCellRef}
          className="flex flex-col items-end px-2 py-1 rounded transition-colors duration-300 text-zinc-200 min-w-[54px]"
        >
          <span className="text-[9px] uppercase tracking-wider text-zinc-500 font-sans">Bid</span>
          <span className="font-semibold tracking-tight">
            {hasQuote ? quote!.bid.toFixed(symbolConfig.digits) : '—'}
          </span>
        </div>

        <div className="flex flex-col items-end px-2 py-1 rounded bg-zinc-900/40 text-zinc-300 min-w-[54px]">
          <span className="text-[9px] uppercase tracking-wider text-zinc-500 font-sans">Ask</span>
          <span className="font-medium tracking-tight">
            {hasQuote ? quote!.ask.toFixed(symbolConfig.digits) : '—'}
          </span>
        </div>
      </div>
    </div>
  );
});

WatchlistItem.displayName = 'WatchlistItem';
