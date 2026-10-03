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

  const handleSelectSymbol = (symbol: string) => {
    setSelectedSymbol(symbol);
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-zinc-950 select-none overflow-hidden transition-colors">
      {/* Top Filter & Search Controls */}
      <div className="p-3 border-b border-slate-200 dark:border-zinc-800/80 bg-slate-50/70 dark:bg-zinc-950 flex flex-col gap-2 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-900 dark:text-zinc-100 uppercase tracking-wider font-sans">
              Market Watch
            </span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-200 dark:bg-zinc-900 text-slate-700 dark:text-zinc-400 border border-slate-300 dark:border-zinc-800">
              {filteredSymbols.length}/{activeSymbolList.length}
            </span>
          </div>

          {/* Quick 10/25/50 Symbol scaling */}
          <div className="flex items-center gap-0.5 bg-slate-100 dark:bg-zinc-900 p-0.5 rounded-lg border border-slate-200 dark:border-zinc-800">
            {([10, 25, 50] as const).map((count) => (
              <button
                key={count}
                onClick={() => setActiveSymbolCount(count)}
                className={`px-2 py-1 text-[11px] font-mono font-medium rounded transition-colors cursor-pointer min-h-[32px] min-w-[32px] flex items-center justify-center ${
                  activeSymbolCount === count
                    ? 'bg-blue-600 text-white font-bold'
                    : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200'
                }`}
              >
                {count}
              </button>
            ))}
          </div>
        </div>

        {/* Search Input */}
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-zinc-500" />
          <input
            type="text"
            placeholder="Search instruments (EUR, XAU, BTC)..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-800 focus:border-blue-500 rounded-lg pl-9 pr-3 py-2 text-xs text-slate-900 dark:text-zinc-100 placeholder-slate-400 dark:placeholder-zinc-500 outline-none"
          />
        </div>

        {/* Category Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none pt-0.5">
          {(['ALL', 'FOREX', 'CRYPTO', 'COMMODITIES'] as const).map((cat) => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`px-3 py-1 rounded-md text-[11px] font-medium whitespace-nowrap transition-colors cursor-pointer min-h-[34px] flex items-center ${
                categoryFilter === cat
                  ? 'bg-blue-600 text-white font-bold shadow-xs'
                  : 'bg-white dark:bg-zinc-900 text-slate-600 dark:text-zinc-400 border border-slate-200 dark:border-zinc-800 hover:bg-slate-100 dark:hover:bg-zinc-800'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Quote Items List */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-zinc-900/60">
        {filteredSymbols.map((s) => {
          return (
            <MobileQuoteRow
              key={s.symbol}
              symbolConfig={s}
              isSelected={selectedSymbol === s.symbol}
              onSelect={() => handleSelectSymbol(s.symbol)}
              onOpenChart={(e) => handleOpenChart(s.symbol, e)}
              onOpenTrade={(e) => handleOpenTrade(s.symbol, e)}
            />
          );
        })}
      </div>
    </div>
  );
};

interface MobileQuoteRowProps {
  symbolConfig: any;
  isSelected: boolean;
  onSelect: () => void;
  onOpenChart: (e: React.MouseEvent) => void;
  onOpenTrade: (e: React.MouseEvent) => void;
}

const MobileQuoteRow: React.FC<MobileQuoteRowProps> = React.memo(
  ({ symbolConfig, isSelected, onSelect, onOpenChart, onOpenTrade }) => {
    const symbol = symbolConfig.symbol;
    const quote = useTradingStore((state) => state.quotes[symbol]);

    const hasQuote = Boolean(quote && typeof quote.bid === 'number');
    const isPositive = hasQuote ? quote!.change24hPct >= 0 : true;

    return (
      <div
        onClick={onSelect}
        className={`px-3 py-3 flex items-center justify-between transition-colors cursor-pointer min-h-[64px] ${
          isSelected
            ? 'bg-blue-50/80 dark:bg-zinc-900/90 border-l-4 border-l-blue-600'
            : 'hover:bg-slate-50 dark:hover:bg-zinc-900/40 border-l-4 border-l-transparent'
        }`}
      >
        {/* Left: Symbol & Name */}
        <div className="flex flex-col min-w-0 pr-2">
          <div className="flex items-center gap-1.5">
            <span className={`font-mono text-sm font-bold ${
              isSelected ? 'text-blue-600 dark:text-blue-400' : 'text-slate-900 dark:text-zinc-100'
            }`}>
              {symbol}
            </span>
            <span className="text-[9px] uppercase font-sans font-semibold px-1 py-0.2 rounded bg-slate-100 dark:bg-zinc-900 text-slate-500 dark:text-zinc-400 border border-slate-200 dark:border-zinc-800">
              {symbolConfig.category}
            </span>
          </div>
          <span className="text-[11px] text-slate-500 dark:text-zinc-400 truncate max-w-[130px] font-sans">
            {symbolConfig.name}
          </span>
          <div className="flex items-center gap-2 text-[10px] text-slate-400 dark:text-zinc-500 font-mono mt-0.5">
            {hasQuote ? (
              <>
                <span>Spr: {quote!.spread}</span>
                <span className={isPositive ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-rose-600 dark:text-rose-400 font-semibold'}>
                  {isPositive ? '+' : ''}{quote!.change24hPct.toFixed(2)}%
                </span>
              </>
            ) : (
              <span className="italic">Waiting for quote</span>
            )}
          </div>
        </div>

        {/* Center: Bid / Ask Numbers */}
        <div className="flex items-center gap-2 font-mono">
          <div className="flex flex-col items-end px-2 py-1 rounded bg-slate-50 dark:bg-zinc-900/60 min-w-[58px]">
            <span className="text-[9px] uppercase text-slate-400 dark:text-zinc-500 font-sans">Bid</span>
            <span className="font-bold text-xs text-slate-900 dark:text-zinc-100">
              {hasQuote ? quote!.bid.toFixed(symbolConfig.digits) : '—'}
            </span>
          </div>

          <div className="flex flex-col items-end px-2 py-1 rounded bg-slate-100 dark:bg-zinc-900/80 min-w-[58px]">
            <span className="text-[9px] uppercase text-slate-400 dark:text-zinc-500 font-sans">Ask</span>
            <span className="font-bold text-xs text-slate-900 dark:text-zinc-100">
              {hasQuote ? quote!.ask.toFixed(symbolConfig.digits) : '—'}
            </span>
          </div>
        </div>

        {/* Right: Quick Action Buttons (Chart & Trade) */}
        <div className="flex items-center gap-1 pl-2" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={onOpenChart}
            className="p-2 rounded-lg bg-slate-100 dark:bg-zinc-900 hover:bg-slate-200 dark:hover:bg-zinc-800 text-slate-600 dark:text-zinc-300 min-w-[38px] min-h-[38px] flex items-center justify-center cursor-pointer border border-slate-200 dark:border-zinc-800"
            title="Open Chart"
          >
            <BarChart2 className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          </button>
          <button
            onClick={onOpenTrade}
            className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900/60 text-blue-600 dark:text-blue-300 min-w-[38px] min-h-[38px] flex items-center justify-center cursor-pointer border border-blue-200 dark:border-blue-800/60"
            title="Open Trade Ticket"
          >
            <ArrowUpRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }
);

MobileQuoteRow.displayName = 'MobileQuoteRow';
