/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Moon, RefreshCw, Sun, Zap } from 'lucide-react';
import { useTradingStore } from '../../store/useTradingStore';

export const TerminalHeader: React.FC = () => {
  const account = useTradingStore((state) => state.account);
  const activeSymbolCount = useTradingStore((state) => state.activeSymbolCount);
  const fps = useTradingStore((state) => state.fps);
  const socketStatus = useTradingStore((state) => state.socketStatus);
  const theme = useTradingStore((state) => state.theme);
  const toggleTheme = useTradingStore((state) => state.toggleTheme);
  const togglePerfLab = useTradingStore((state) => state.togglePerfLab);
  const resetAccount = useTradingStore((state) => state.resetAccount);
  const toggleMobileAccountDrawer = useTradingStore((state) => state.toggleMobileAccountDrawer);

  const totalPnL = Number((account.equity - account.balance).toFixed(2));
  const isProfitable = totalPnL >= 0;

  return (
    <header className="h-14 bg-white dark:bg-zinc-950 border-b border-slate-200 dark:border-zinc-800/80 px-3 sm:px-4 flex items-center justify-between select-none transition-colors">
      {/* Brand & Account Identifier */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-blue-600 flex items-center justify-center font-bold text-white text-xs tracking-wider shadow-sm shadow-blue-500/20">
            TT
          </div>
          <div>
            <div className="flex items-center gap-1.5 sm:gap-2">
              <span className="font-bold text-slate-900 dark:text-zinc-100 text-xs sm:text-sm tracking-tight">
                TRADING TERMINAL
              </span>
              {account.sessionMode === 'EXTERNAL' || account.platform === 'MT5' ? (
                <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 font-semibold border border-emerald-300 dark:border-emerald-700/50 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  {account.platform || 'EXTERNAL'} #{account.accountNumber}
                </span>
              ) : (
                <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 font-semibold border border-slate-300 dark:border-zinc-700/50">
                  DEMO #{account.accountNumber}
                </span>
              )}
              <span
                className={`inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                  socketStatus === 'CONNECTED'
                    ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800/40'
                    : socketStatus === 'CONNECTING'
                    ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-800/40'
                    : 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-400 border-rose-300 dark:border-rose-800/40'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    socketStatus === 'CONNECTED'
                      ? 'bg-emerald-500 animate-pulse'
                      : socketStatus === 'CONNECTING'
                      ? 'bg-amber-500'
                      : 'bg-rose-500'
                  }`}
                />
                <span className="hidden sm:inline font-medium">{socketStatus === 'CONNECTED' ? 'SERVER WS' : socketStatus}</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Account Summary Chip (Visible on < lg, hidden on lg+) */}
      <button
        onClick={toggleMobileAccountDrawer}
        className="flex lg:hidden items-center gap-2 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-800 active:bg-slate-300 dark:active:bg-zinc-700 min-h-[38px] cursor-pointer"
        title="Tap to view full account metrics"
      >
        <div className="flex flex-col items-start font-mono text-xs leading-none">
          <span className="text-[9px] uppercase text-slate-500 dark:text-zinc-400 font-sans font-medium">Equity</span>
          <span className="font-bold text-slate-900 dark:text-zinc-100 text-xs">
            ${account.equity.toLocaleString('en-US', { maximumFractionDigits: 0 })}
          </span>
        </div>
        <div className="w-[1px] h-5 bg-slate-300 dark:bg-zinc-800" />
        <div className="flex flex-col items-start font-mono text-xs leading-none">
          <span className="text-[9px] uppercase text-slate-500 dark:text-zinc-400 font-sans font-medium">P/L</span>
          <span className={`font-bold text-xs ${isProfitable ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
            {isProfitable ? '+' : ''}${totalPnL.toFixed(1)}
          </span>
        </div>
      </button>

      {/* Realtime Account Metrics Toolbar (Desktop lg+) */}
      <div className="hidden lg:flex items-center gap-5 font-mono text-xs">
        {/* Balance */}
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-zinc-400 font-sans font-medium">Balance</span>
          <span className="font-semibold text-slate-800 dark:text-zinc-200">
            ${account.balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>

        <div className="w-[1px] h-6 bg-slate-200 dark:bg-zinc-800" />

        {/* Equity */}
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-zinc-400 font-sans font-medium">Equity</span>
          <span className={`font-semibold ${isProfitable ? 'text-slate-900 dark:text-zinc-100' : 'text-rose-600 dark:text-rose-300'}`}>
            ${account.equity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>

        <div className="w-[1px] h-6 bg-slate-200 dark:bg-zinc-800" />

        {/* Unrealized P/L */}
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-zinc-400 font-sans font-medium">Floating P/L</span>
          <span className={`font-bold flex items-center gap-1 ${isProfitable ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
            {isProfitable ? '+' : ''}${totalPnL.toFixed(2)}
          </span>
        </div>

        <div className="w-[1px] h-6 bg-slate-200 dark:bg-zinc-800" />

        {/* Margin In Use & Free */}
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-zinc-400 font-sans font-medium">Free Margin</span>
          <span className="font-semibold text-slate-800 dark:text-zinc-300">
            ${account.freeMargin.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>

        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-zinc-400 font-sans font-medium">Margin Level</span>
          <span className={`font-semibold ${account.marginLevel < 100 && account.usedMargin > 0 ? 'text-rose-600 dark:text-rose-400 animate-pulse font-bold' : 'text-slate-700 dark:text-zinc-300'}`}>
            {account.usedMargin > 0 ? `${account.marginLevel.toFixed(1)}%` : '—'}
          </span>
        </div>
      </div>

      {/* Right Actions: Theme Toggle, Performance Lab & Reset */}
      <div className="flex items-center gap-1.5 sm:gap-2">
        {/* Light / Dark Mode Toggle */}
        <button
          onClick={toggleTheme}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-zinc-900 hover:bg-slate-200 dark:hover:bg-zinc-800 border border-slate-200 dark:border-zinc-800 text-slate-700 dark:text-zinc-300 text-xs font-sans transition-colors cursor-pointer min-h-[34px]"
          title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`}
          aria-label="Toggle visual theme"
        >
          {theme === 'dark' ? (
            <>
              <Sun className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden sm:inline font-medium text-[11px]">Light</span>
            </>
          ) : (
            <>
              <Moon className="w-3.5 h-3.5 text-slate-600" />
              <span className="hidden sm:inline font-medium text-[11px]">Dark</span>
            </>
          )}
        </button>

        <button
          onClick={togglePerfLab}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-zinc-900 hover:bg-slate-200 dark:hover:bg-zinc-800 border border-slate-200 dark:border-zinc-800 text-slate-700 dark:text-zinc-300 text-xs font-mono transition-colors cursor-pointer group min-h-[34px]"
          title="Open Performance Spike & Benchmark Lab"
        >
          <Zap className="w-3.5 h-3.5 text-amber-500 group-hover:scale-110 transition-transform" />
          <span className="hidden sm:inline font-sans text-xs font-medium">Perf Lab</span>
          <span className="px-1.5 py-0.2 rounded bg-slate-200 dark:bg-zinc-800 text-[10px] text-slate-700 dark:text-zinc-400 border border-slate-300 dark:border-zinc-700 font-mono">
            {activeSymbolCount} sym
          </span>
          <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold font-mono ${fps >= 55 ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400' : 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400'}`}>
            {fps} FPS
          </span>
        </button>

        <button
          onClick={resetAccount}
          className="p-2 rounded-lg bg-slate-100 dark:bg-zinc-900 hover:bg-slate-200 dark:hover:bg-zinc-800 border border-slate-200 dark:border-zinc-800 text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200 transition-colors cursor-pointer min-h-[34px] min-w-[34px] flex items-center justify-center"
          title="Reset Demo Balance & Clear Open Trades"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
};
