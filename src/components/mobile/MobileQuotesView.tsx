/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * MOBILE QUOTES VIEW
 * High-density, touch-optimized symbol catalog with realtime bid/ask prices,
 * spread indicators, 24h percentage changes, and quick jumps to Chart or Trade.
 */

import React, { useMemo, useState } from 'react';
import { ArrowUpRight, BarChart2, Search, Zap } from 'lucide-react';
import { AssetCategory } from '../../types/trading';
import { useTradingStore } from '../../store/useTradingStore';

export const MobileQuotesView: React.FC = () => {
  const activeSymbolList = useTradingStore((state) => state.activeSymbolList);
  const activeSymbolCount = useTradingStore((state) => state.activeSymbolCount);
  const setActiveSymbolCount = useTradingStore((state) => state.setActiveSymbolCount);
  const selectedSymbol = useTradingStore((state) => state.selectedSymbol);
  const setSelectedSymbol = useTradingStore((state) => state.setSelectedSymbol);
  const setMobileTab = useTradingStore((state) => state.setMobileTab);

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | AssetCategory>('ALL');

  const filteredSymbols = useMemo(() => {
    return activeSymbolList.filter((s) => {
      const matchesSearch =
        search.trim() === '' ||
        s.symbol.toLowerCase().includes(search.toLowerCase()) ||
        s.name.toLowerCase().includes(search.toLowerCase());
      const matchesCategory = categoryFilter === 'ALL' || s.category === categoryFilter;
      return matchesSearch && matchesCategory;
    });
  }, [activeSymbolList, search, categoryFilter]);

  const handleOpenChart = (symbol: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedSymbol(symbol);
    setMobileTab('chart');
  };

  const handleOpenTrade = (symbol: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedSymbol(symbol);
    setMobileTab('trade');
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950 select-none overflow-hidden">
      {/* Top Filter & Search Controls */}
      <div className="p-3 border-b border-zinc-800/80 bg-zinc-950 flex flex-col gap-2 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-zinc-100 uppercase tracking-wider">
              Market Watch
            </span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-400 border border-zinc-800">
              {filteredSymbols.length}/{activeSymbolList.length}
            </span>
          </div>

          {/* Quick 10/25/50 Symbol scaling */}
          <div className="flex items-center gap-1 bg-zinc-900 p-0.5 rounded border border-zinc-800">
            {([10, 25, 50] as const).map((count) => (
              <button
                key={count}
                onClick={() => setActiveSymbolCount(count)}
                className={`px-2 py-1 text-[11px] font-mono font-medium rounded transition-colors cursor-pointer min-h-[32px] min-w-[32px] flex items-center justify-center ${
                  activeSymbolCount === count
                    ? 'bg-blue-600 text-white font-bold'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {count}
              </button>
            ))}
          </div>
        </div>

        {/* Search Input */}
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            placeholder="Search instruments (EUR, XAU, BTC)..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-800 focus:border-blue-500 rounded-lg pl-9 pr-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 outline-none"
          />
        </div>

        {/* Category Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none pt-0.5">
          {(['ALL', 'FOREX', 'CRYPTO', 'METALS', 'INDICES'] as const).map((cat) => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`px-3 py-1 rounded-full text-[11px] font-medium whitespace-nowrap transition-colors cursor-pointer min-h-[34px] flex items-center ${
                categoryFilter === cat
                  ? 'bg-blue-600 text-white font-semibold'
                  : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 border border-zinc-800'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Symbol Cards List */}
      <div className="flex-1 overflow-y-auto divide-y divide-zinc-900/60 p-2 space-y-1">
        {filteredSymbols.map((cfg) => (
          <MobileQuoteCard
            key={cfg.symbol}
            symbol={cfg.symbol}
            name={cfg.name}
            category={cfg.category}
            digits={cfg.digits}
            isSelected={selectedSymbol === cfg.symbol}
            onSelect={() => setSelectedSymbol(cfg.symbol)}
            onOpenChart={(e) => handleOpenChart(cfg.symbol, e)}
            onOpenTrade={(e) => handleOpenTrade(cfg.symbol, e)}
          />
        ))}

        {filteredSymbols.length === 0 && (
          <div className="p-8 text-center text-xs text-zinc-500">
            No instruments match your search.
          </div>
        )}
      </div>
    </div>
  );
};

// Isolated individual card subscription: only re-renders when this specific symbol's quote changes
const MobileQuoteCard: React.FC<{
  symbol: string;
  name: string;
  category: string;
  digits: number;
  isSelected: boolean;
  onSelect: () => void;
  onOpenChart: (e: React.MouseEvent) => void;
  onOpenTrade: (e: React.MouseEvent) => void;
}> = React.memo(({
  symbol,
  name,
  category,
  digits,
  isSelected,
  onSelect,
  onOpenChart,
  onOpenTrade,
}) => {
  const quote = useTradingStore((state) => state.quotes[symbol]);
  const hasQuote = Boolean(quote && typeof quote.bid === 'number');
  const isPositive = hasQuote ? quote!.change24hPct >= 0 : true;

  return (
    <div
      onClick={onSelect}
      className={`p-3 rounded-xl border transition-all cursor-pointer flex flex-col gap-2 ${
        isSelected
          ? 'bg-zinc-900/90 border-blue-500/80 shadow-sm shadow-blue-500/10'
          : 'bg-zinc-900/40 hover:bg-zinc-900/70 border-zinc-850 border-zinc-800/60'
      }`}
    >
      <div className="flex items-center justify-between">
        {/* Symbol & Name */}
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm text-zinc-100 tracking-tight font-mono">
              {symbol}
            </span>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 uppercase font-mono border border-zinc-700/50">
              {category}
            </span>
          </div>
          <span className="text-[11px] text-zinc-400 truncate max-w-[180px]">{name}</span>
        </div>

        {/* 24h Change & Spread */}
        <div className="flex flex-col items-end text-xs font-mono">
          {hasQuote ? (
            <>
              <span className={`font-semibold ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                {isPositive ? '+' : ''}{quote!.change24hPct.toFixed(2)}%
              </span>
              <span className="text-[10px] text-zinc-400">Spr: {quote!.spread} pips</span>
            </>
          ) : (
            <span className="text-[11px] text-zinc-500 italic">Waiting for quote</span>
          )}
        </div>
      </div>

      {/* Bid / Ask Price Cell + Quick Actions */}
      <div className="flex items-center justify-between pt-1 gap-2 border-t border-zinc-800/40">
        <div className="flex items-center gap-2 flex-1">
          {/* Bid Button */}
          <div className="flex-1 py-1.5 px-2.5 rounded bg-zinc-900/90 border border-zinc-800/80 flex flex-col items-start">
            <span className="text-[9px] uppercase tracking-wider text-zinc-400 font-mono">Bid</span>
            <span className="font-mono text-xs font-bold text-zinc-100">
              {hasQuote ? quote!.bid.toFixed(digits) : '—'}
            </span>
          </div>

          {/* Ask Button */}
          <div className="flex-1 py-1.5 px-2.5 rounded bg-zinc-900/90 border border-zinc-800/80 flex flex-col items-start">
            <span className="text-[9px] uppercase tracking-wider text-zinc-400 font-mono">Ask</span>
            <span className="font-mono text-xs font-bold text-zinc-100">
              {hasQuote ? quote!.ask.toFixed(digits) : '—'}
            </span>
          </div>
        </div>

        {/* Quick Nav Actions (44px min touch target) */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={onOpenChart}
            className="min-h-[44px] min-w-[44px] p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 active:bg-blue-600 active:text-white text-zinc-300 flex items-center justify-center cursor-pointer transition-colors"
            title="Open Chart"
          >
            <BarChart2 className="w-4 h-4" />
          </button>

          <button
            onClick={onOpenTrade}
            className="min-h-[44px] px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-400 text-white text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors shadow-sm shadow-blue-500/20"
            title="Trade Symbol"
          >
            <Zap className="w-3.5 h-3.5 text-amber-300" />
            <span>Trade</span>
          </button>
        </div>
      </div>
    </div>
  );
});

MobileQuoteCard.displayName = 'MobileQuoteCard';
