/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * MOBILE ACCOUNT METRICS DRAWER / BOTTOM SHEET
 * Unveils complete authoritative balance, equity, margin, and leverage details on mobile.
 */

import React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  DollarSign,
  RefreshCw,
  ShieldCheck,
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
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/70 backdrop-blur-sm select-none">
      {/* Backdrop tap to close */}
      <div className="flex-1 w-full" onClick={() => setOpen(false)} />

      {/* Sheet Container */}
      <div className="bg-zinc-950 border-t border-zinc-800 rounded-t-2xl p-4 shadow-2xl flex flex-col gap-4 max-h-[85vh] overflow-y-auto animate-in slide-in-from-bottom duration-200">
        {/* Drag Handle Bar & Header */}
        <div className="flex flex-col items-center gap-2">
          <div className="w-10 h-1 rounded-full bg-zinc-700" />
          <div className="w-full flex items-center justify-between pt-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-zinc-100 text-sm">Account Overview</span>
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700">
                {account.accountType} #{account.accountNumber}
              </span>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="p-2 rounded-full bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 min-w-[40px] min-h-[40px] flex items-center justify-center cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Server & Status Chip */}
        <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-zinc-900/80 border border-zinc-800/80 text-xs font-mono">
          <span className="text-zinc-400">Connection State:</span>
          <span
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold border ${
              socketStatus === 'CONNECTED'
                ? 'bg-emerald-950/80 text-emerald-400 border-emerald-800/40'
                : socketStatus === 'CONNECTING'
                ? 'bg-amber-950/80 text-amber-400 border-amber-800/40'
                : 'bg-rose-950/80 text-rose-400 border-rose-800/40'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                socketStatus === 'CONNECTED'
                  ? 'bg-emerald-400 animate-pulse'
                  : socketStatus === 'CONNECTING'
                  ? 'bg-amber-400'
                  : 'bg-rose-400'
              }`}
            />
            {socketStatus === 'CONNECTED' ? 'Authoritative WebSocket Live' : socketStatus}
          </span>
        </div>

        {/* Key Metrics Grid */}
        <div className="grid grid-cols-2 gap-2 text-xs font-mono">
          {/* Balance */}
          <div className="p-3 rounded-lg bg-zinc-900/60 border border-zinc-800/80 flex flex-col gap-0.5">
            <span className="text-[10px] uppercase text-zinc-400">Account Balance</span>
            <span className="text-base font-bold text-zinc-100">
              ${account.balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="text-[10px] text-zinc-400 font-sans">{account.currency} Base Currency</span>
          </div>

          {/* Equity */}
          <div className="p-3 rounded-lg bg-zinc-900/60 border border-zinc-800/80 flex flex-col gap-0.5">
            <span className="text-[10px] uppercase text-zinc-400">Live Equity</span>
            <span className={`text-base font-bold ${isProfitable ? 'text-zinc-100' : 'text-rose-300'}`}>
              ${account.equity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="text-[10px] text-zinc-400 font-sans">Balance + Floating P/L</span>
          </div>

          {/* Floating P/L */}
          <div className="p-3 rounded-lg bg-zinc-900/60 border border-zinc-800/80 flex flex-col gap-0.5">
            <span className="text-[10px] uppercase text-zinc-400">Floating Unrealized P/L</span>
            <span className={`text-base font-bold ${isProfitable ? 'text-emerald-400' : 'text-rose-400'}`}>
              {isProfitable ? '+' : ''}${totalPnL.toFixed(2)}
            </span>
            <span className="text-[10px] text-zinc-400 font-sans">
              {isProfitable ? 'Net Positive Position' : 'Net Floating Drawdown'}
            </span>
          </div>

          {/* Free Margin */}
          <div className="p-3 rounded-lg bg-zinc-900/60 border border-zinc-800/80 flex flex-col gap-0.5">
            <span className="text-[10px] uppercase text-zinc-400">Free Available Margin</span>
            <span className="text-base font-bold text-zinc-200">
              ${account.freeMargin.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="text-[10px] text-zinc-400 font-sans">Capital available for orders</span>
          </div>

          {/* Margin Used */}
          <div className="p-3 rounded-lg bg-zinc-900/60 border border-zinc-800/80 flex flex-col gap-0.5">
            <span className="text-[10px] uppercase text-zinc-400">Locked Margin</span>
            <span className="text-base font-bold text-zinc-300">
              ${account.usedMargin.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="text-[10px] text-zinc-400 font-sans">Collateral held for open trades</span>
          </div>

          {/* Margin Level */}
          <div className="p-3 rounded-lg bg-zinc-900/60 border border-zinc-800/80 flex flex-col gap-0.5">
            <span className="text-[10px] uppercase text-zinc-400">Margin Level</span>
            <span className={`text-base font-bold ${isMarginWarning ? 'text-rose-400 animate-pulse' : 'text-zinc-200'}`}>
              {account.usedMargin > 0 ? `${account.marginLevel.toFixed(1)}%` : '—'}
            </span>
            <span className="text-[10px] text-zinc-400 font-sans">
              Stop-out Level: {account.stopOutLevel}%
            </span>
          </div>
        </div>

        {/* Warning if Margin Call */}
        {isMarginWarning && (
          <div className="p-3 rounded-lg bg-rose-950/60 border border-rose-800 text-rose-300 text-xs flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 shrink-0 text-rose-400" />
            <span>Margin Level is low (&lt;100%). Close open positions or reduce volume to avoid stop-out.</span>
          </div>
        )}

        {/* Reset Demo Balance Action */}
        <button
          onClick={() => {
            resetAccount();
            setOpen(false);
          }}
          className="w-full min-h-[48px] py-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 active:bg-zinc-700 border border-zinc-800 text-zinc-200 font-semibold text-xs flex items-center justify-center gap-2 cursor-pointer transition-colors"
        >
          <RefreshCw className="w-4 h-4 text-blue-400" />
          <span>Reset Demo Balance to $10,000.00</span>
        </button>
      </div>
    </div>
  );
};
