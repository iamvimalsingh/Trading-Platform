/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Activity, Gauge, RefreshCw, Zap } from 'lucide-react';
import { useTradingStore } from '../../store/useTradingStore';

export const TerminalHeader: React.FC = () => {
  const account = useTradingStore((state) => state.account);
  const activeSymbolCount = useTradingStore((state) => state.activeSymbolCount);
  const fps = useTradingStore((state) => state.fps);
  const socketStatus = useTradingStore((state) => state.socketStatus);
  const togglePerfLab = useTradingStore((state) => state.togglePerfLab);
  const resetAccount = useTradingStore((state) => state.resetAccount);
  const toggleMobileAccountDrawer = useTradingStore((state) => state.toggleMobileAccountDrawer);

  const totalPnL = Number((account.equity - account.balance).toFixed(2));
  const isProfitable = totalPnL >= 0;

  return (
    <header className="h-14 bg-zinc-950 border-b border-zinc-800/80 px-3 sm:px-4 flex items-center justify-between select-none">
      {/* Brand & Account Identifier */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded bg-blue-600 flex items-center justify-center font-bold text-white text-xs tracking-wider shadow-sm shadow-blue-500/20">
            TT
          </div>
          <div>
            <div className="flex items-center gap-1.5 sm:gap-2">
              <span className="font-semibold text-zinc-100 text-xs sm:text-sm tracking-tight">PROJECT B</span>
              {account.sessionMode === 'EXTERNAL' || account.platform === 'MT5' ? (
                <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-emerald-950/70 text-emerald-300 font-medium border border-emerald-700/50 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  {account.platform || 'EXTERNAL'} #{account.accountNumber}
                </span>
              ) : (
                <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 font-medium border border-zinc-700/50">
                  DEMO #{account.accountNumber}
                </span>
              )}
              <span
                className={`inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                  socketStatus === 'CONNECTED'
                    ? 'bg-emerald-950/60 text-emerald-400 border-emerald-800/40'
                    : socketStatus === 'CONNECTING'
                    ? 'bg-amber-950/60 text-amber-400 border-amber-800/40'
                    : 'bg-rose-950/60 text-rose-400 border-rose-800/40'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    socketStatus === 'CONNECTED'
                      ? 'bg-emerald-400 animate-pulse'
                      : socketStatus === 'CONNECTING'
                      ? 'bg-amber-400'
                      : 'bg-rose-400'
                  }`}
                />
                <span className="hidden sm:inline">{socketStatus === 'CONNECTED' ? 'SERVER WS' : socketStatus}</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Account Summary Chip (Visible on < lg, hidden on lg+) */}
      <button
        onClick={toggleMobileAccountDrawer}
        className="flex lg:hidden items-center gap-2 px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 active:bg-zinc-700 min-h-[38px] cursor-pointer"
        title="Tap to view full account metrics"
      >
        <div className="flex flex-col items-start font-mono text-xs leading-none">
          <span className="text-[9px] uppercase text-zinc-400">Equity</span>
          <span className="font-bold text-zinc-100 text-xs">
            ${account.equity.toLocaleString('en-US', { maximumFractionDigits: 0 })}
          </span>
        </div>
        <div className="w-[1px] h-5 bg-zinc-800" />
        <div className="flex flex-col items-start font-mono text-xs leading-none">
          <span className="text-[9px] uppercase text-zinc-400">P/L</span>
          <span className={`font-bold text-xs ${isProfitable ? 'text-emerald-400' : 'text-rose-400'}`}>
            {isProfitable ? '+' : ''}${totalPnL.toFixed(1)}
          </span>
        </div>
      </button>

      {/* Realtime Account Metrics Toolbar (Desktop lg+) */}
      <div className="hidden lg:flex items-center gap-5 font-mono text-xs">
        {/* Balance */}
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">Balance</span>
          <span className="font-semibold text-zinc-200">
            ${account.balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>

        <div className="w-[1px] h-6 bg-zinc-800" />

        {/* Equity */}
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">Equity</span>
          <span className={`font-semibold ${isProfitable ? 'text-zinc-100' : 'text-rose-300'}`}>
            ${account.equity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>

        <div className="w-[1px] h-6 bg-zinc-800" />

        {/* Unrealized P/L */}
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">Floating P/L</span>
          <span className={`font-semibold flex items-center gap-1 ${isProfitable ? 'text-emerald-400' : 'text-rose-400'}`}>
            {isProfitable ? '+' : ''}${totalPnL.toFixed(2)}
          </span>
        </div>

        <div className="w-[1px] h-6 bg-zinc-800" />

        {/* Margin In Use & Free */}
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">Free Margin</span>
          <span className="font-semibold text-zinc-300">
            ${account.freeMargin.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>

        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">Margin Level</span>
          <span className={`font-semibold ${account.marginLevel < 100 && account.usedMargin > 0 ? 'text-rose-400 animate-pulse' : 'text-zinc-300'}`}>
            {account.usedMargin > 0 ? `${account.marginLevel.toFixed(1)}%` : '—'}
          </span>
        </div>
      </div>

      {/* Right Actions: Performance Spike Lab & Reset */}
      <div className="flex items-center gap-2">
        <button
          onClick={togglePerfLab}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/60 text-zinc-300 text-xs font-mono transition-colors cursor-pointer group"
          title="Open Performance Spike & Benchmark Lab"
        >
          <Zap className="w-3.5 h-3.5 text-amber-400 group-hover:scale-110 transition-transform" />
          <span className="hidden sm:inline font-sans text-xs font-medium">Perf Lab</span>
          <span className="px-1 py-0.2 rounded bg-zinc-800 text-[10px] text-zinc-400 border border-zinc-700">
            {activeSymbolCount} sym
          </span>
          <span className={`px-1 py-0.2 rounded text-[10px] font-bold ${fps >= 55 ? 'bg-emerald-950 text-emerald-400' : 'bg-amber-950 text-amber-400'}`}>
            {fps} FPS
          </span>
        </button>

        <button
          onClick={resetAccount}
          className="p-1.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
          title="Reset Demo Balance & Clear Open Trades"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
};
