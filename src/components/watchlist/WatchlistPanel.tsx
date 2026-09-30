/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { Filter, Search, SlidersHorizontal } from 'lucide-react';
import { AssetCategory } from '../../types/trading';
import { useTradingStore } from '../../store/useTradingStore';
import { WatchlistItem } from './WatchlistItem';

export const WatchlistPanel: React.FC = () => {
  const activeSymbolList = useTradingStore((state) => state.activeSymbolList);
  const activeSymbolCount = useTradingStore((state) => state.activeSymbolCount);
  const setActiveSymbolCount = useTradingStore((state) => state.setActiveSymbolCount);

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

  return (
    <div className="flex flex-col h-full bg-zinc-950 border-r border-zinc-800/80 select-none">
      {/* Watchlist Header & Search */}
      <div className="p-2.5 border-b border-zinc-800/80 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-zinc-200 uppercase tracking-wider">Watchlist</span>
            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-zinc-900 text-zinc-400 border border-zinc-800">
              {filteredSymbols.length}/{activeSymbolList.length}
            </span>
          </div>

          {/* Quick 10/25/50 Symbol Scaling Selector for Performance Spike */}
          <div className="flex items-center gap-1 bg-zinc-900 p-0.5 rounded border border-zinc-800">
            {([10, 25, 50] as const).map((count) => (
              <button
                key={count}
                onClick={() => setActiveSymbolCount(count)}
                className={`px-1.5 py-0.5 text-[10px] font-mono font-medium rounded transition-colors cursor-pointer ${
                  activeSymbolCount === count
                    ? 'bg-blue-600 text-white font-bold'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
                title={`Scale active market feed to ${count} symbols`}
              >
                {count}
              </button>
            ))}
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            placeholder="Search symbol (e.g. XAU, EUR)..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-zinc-900/90 border border-zinc-800 focus:border-blue-500 rounded pl-8 pr-2.5 py-1 text-xs text-zinc-200 placeholder-zinc-500 outline-none font-sans"
          />
        </div>

        {/* Category Pills */}
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-none text-[10px] pt-0.5">
          {(['ALL', 'FOREX', 'CRYPTO', 'METALS', 'INDICES'] as const).map((cat) => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`px-2 py-0.5 rounded text-[10px] whitespace-nowrap transition-colors cursor-pointer ${
                categoryFilter === cat
                  ? 'bg-zinc-800 text-zinc-100 font-semibold border border-zinc-700'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Virtualized/Optimized Scrollable List */}
      <div className="flex-1 overflow-y-auto divide-y divide-zinc-900/30">
        {filteredSymbols.length > 0 ? (
          filteredSymbols.map((cfg) => (
            <WatchlistItem key={cfg.symbol} symbolConfig={cfg} />
          ))
        ) : (
          <div className="p-6 text-center text-xs text-zinc-500 font-sans">
            No symbols match your filter.
          </div>
        )}
      </div>
    </div>
  );
};
