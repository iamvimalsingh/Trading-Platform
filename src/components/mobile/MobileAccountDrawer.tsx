/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * MOBILE ACCOUNT METRICS DRAWER / BOTTOM SHEET
 * Complete authoritative balance, equity, margin, and leverage details on mobile.
 */

import React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  X,
} from 'lucide-react';
import { useTradingStore } from '../../store/useTradingStore';

export const MobileAccountDrawer: React.FC = () => {
  const isOpen = useTradingStore((state) => state.isMobileAccountDrawerOpen);
  const setOpen = useTradingStore((state) => state.setMobileAccountDrawerOpen);
  const account = useTradingStore((state) => state.account);
  const socketStatus = useTradingStore((state) => state.socketStatus);
  const resetAccount = useTradingStore((state) => state.resetAccount);

  if (!isOpen) return null;

  const totalPnL = Number((account.equity - account.balance).toFixed(2));
  const isProfitable = totalPnL >= 0;
  const isMarginWarning = account.marginLevel < 100 && account.usedMargin > 0;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-xs select-none">
      {/* Backdrop tap to close */}
      <div className="flex-1 w-full" onClick={() => setOpen(false)} />

      {/* Sheet Container */}
      <div className="bg-white dark:bg-zinc-950 border-t border-slate-200 dark:border-zinc-800 rounded-t-3xl p-4 shadow-2xl flex flex-col gap-4 max-h-[85vh] overflow-y-auto animate-in slide-in-from-bottom duration-200 text-slate-800 dark:text-zinc-100">
        {/* Drag Handle Bar & Header */}
        <div className="flex flex-col items-center gap-2">
          <div className="w-10 h-1.2 rounded-full bg-slate-300 dark:bg-zinc-700" />
          <div className="w-full flex items-center justify-between pt-1">
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-900 dark:text-zinc-100 text-base">Account Overview</span>
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 border border-slate-200 dark:border-zinc-700 font-semibold">
                {account.accountType} #{account.accountNumber}
              </span>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="p-2 rounded-full bg-slate-100 dark:bg-zinc-900 hover:bg-slate-200 dark:hover:bg-zinc-800 text-slate-600 dark:text-zinc-400 min-w-[40px] min-h-[40px] flex items-center justify-center cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Server & Status Chip */}
        <div className="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-zinc-900/80 border border-slate-200 dark:border-zinc-800/80 text-xs font-mono">
          <span className="text-slate-500 dark:text-zinc-400 font-sans font-medium">Connection State:</span>
          <span
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold border ${
              socketStatus === 'CONNECTED'
                ? 'bg-emerald-50 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800/40'
                : socketStatus === 'CONNECTING'
                ? 'bg-amber-50 dark:bg-amber-950/80 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-800/40'
                : 'bg-rose-50 dark:bg-rose-950/80 text-rose-700 dark:text-rose-400 border-rose-300 dark:border-rose-800/40'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                socketStatus === 'CONNECTED'
                  ? 'bg-emerald-500 animate-pulse'
                  : socketStatus === 'CONNECTING'
                  ? 'bg-amber-500'
                  : 'bg-rose-500'
              }`}
            />
            {socketStatus === 'CONNECTED' ? 'Authoritative WebSocket Live' : socketStatus}
          </span>
        </div>

        {/* Key Metrics Grid */}
        <div className="grid grid-cols-2 gap-2 text-xs font-mono">
          {/* Balance */}
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-zinc-900/60 border border-slate-200 dark:border-zinc-800/80 flex flex-col gap-0.5">
            <span className="text-[10px] uppercase text-slate-500 dark:text-zinc-400 font-sans font-medium">Account Balance</span>
            <span className="text-base font-bold text-slate-900 dark:text-zinc-100">
              ${account.balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="text-[10px] text-slate-400 dark:text-zinc-500 font-sans">{account.currency} Base Currency</span>
          </div>

          {/* Equity */}
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-zinc-900/60 border border-slate-200 dark:border-zinc-800/80 flex flex-col gap-0.5">
            <span className="text-[10px] uppercase text-slate-500 dark:text-zinc-400 font-sans font-medium">Live Equity</span>
            <span className={`text-base font-bold ${isProfitable ? 'text-slate-900 dark:text-zinc-100' : 'text-rose-600 dark:text-rose-300'}`}>
              ${account.equity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className={`text-[10px] font-semibold ${isProfitable ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
              {isProfitable ? '+' : ''}${totalPnL.toFixed(2)} Floating P/L
            </span>
          </div>

          {/* Free Margin */}
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-zinc-900/60 border border-slate-200 dark:border-zinc-800/80 flex flex-col gap-0.5">
            <span className="text-[10px] uppercase text-slate-500 dark:text-zinc-400 font-sans font-medium">Free Margin</span>
            <span className="text-base font-bold text-slate-900 dark:text-zinc-200">
              ${account.freeMargin.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="text-[10px] text-slate-400 dark:text-zinc-500 font-sans">Available for new trades</span>
          </div>

          {/* Margin In Use & Margin Level */}
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-zinc-900/60 border border-slate-200 dark:border-zinc-800/80 flex flex-col gap-0.5">
            <span className="text-[10px] uppercase text-slate-500 dark:text-zinc-400 font-sans font-medium">Margin In Use</span>
            <span className="text-base font-bold text-slate-900 dark:text-zinc-200">
              ${account.usedMargin.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className={`text-[10px] font-semibold ${isMarginWarning ? 'text-rose-600 dark:text-rose-400 font-bold' : 'text-slate-500 dark:text-zinc-400'}`}>
              Level: {account.usedMargin > 0 ? `${account.marginLevel.toFixed(1)}%` : '—'}
            </span>
          </div>
        </div>

        {/* Risk Limits Banner */}
        <div className="p-3 rounded-xl bg-slate-50 dark:bg-zinc-900/60 border border-slate-200 dark:border-zinc-800/80 flex flex-col gap-2 font-mono text-xs">
          <div className="flex items-center justify-between text-slate-600 dark:text-zinc-300">
            <span className="font-sans font-medium text-slate-500 dark:text-zinc-400">Account Leverage:</span>
            <span className="font-bold">1:{account.leverage}</span>
          </div>
          <div className="flex items-center justify-between text-slate-600 dark:text-zinc-300">
            <span className="font-sans font-medium text-slate-500 dark:text-zinc-400">Margin Call Level:</span>
            <span className="text-amber-600 dark:text-amber-400 font-bold">{account.marginCallLevel}%</span>
          </div>
          <div className="flex items-center justify-between text-slate-600 dark:text-zinc-300">
            <span className="font-sans font-medium text-slate-500 dark:text-zinc-400">Stop Out Level:</span>
            <span className="text-rose-600 dark:text-rose-400 font-bold">{account.stopOutLevel}%</span>
          </div>
        </div>

        {/* Action: Reset Demo Balance (DEMO mode only) */}
        {account.sessionMode !== 'EXTERNAL' && (
          <button
            onClick={() => {
              resetAccount();
              setOpen(false);
            }}
            className="w-full min-h-[48px] rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-zinc-900 dark:hover:bg-zinc-800 border border-slate-200 dark:border-zinc-800 text-slate-700 dark:text-zinc-300 font-bold text-xs flex items-center justify-center gap-2 cursor-pointer transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Reset Demo Balance to $10,000.00</span>
          </button>
        )}
      </div>
    </div>
  );
};
