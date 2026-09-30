/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * MOBILE POSITIONS VIEW
 * High-clarity position cards replacing the desktop table on mobile.
 * Touch-friendly inline SL/TP editor, live floating P/L, and prominent Close action.
 */

import React, { useState } from 'react';
import {
  BarChart2,
  Check,
  Edit2,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import { Position } from '../../types/trading';
import { useTradingStore } from '../../store/useTradingStore';

export const MobilePositionsView: React.FC = () => {
  const positions = useTradingStore((state) => state.positions);
  const symbols = useTradingStore((state) => state.symbols);
  const selectedSymbol = useTradingStore((state) => state.selectedSymbol);
  const setSelectedSymbol = useTradingStore((state) => state.setSelectedSymbol);
  const closePosition = useTradingStore((state) => state.closePosition);
  const updatePositionSLTP = useTradingStore((state) => state.updatePositionSLTP);
  const setMobileTab = useTradingStore((state) => state.setMobileTab);

  const [editingPosId, setEditingPosId] = useState<string | null>(null);
  const [editSL, setEditSL] = useState<string>('');
  const [editTP, setEditTP] = useState<string>('');

  const openPositions = positions.filter((p) => p.status === 'OPEN');
  const totalFloatingPnL = openPositions.reduce((acc, p) => acc + p.unrealizedPnL, 0);
  const totalMarginLocked = openPositions.reduce((acc, p) => acc + p.marginLocked, 0);
  const isNetProfitable = totalFloatingPnL >= 0;

  const startEdit = (pos: Position, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingPosId(pos.id);
    setEditSL(pos.stopLoss ? pos.stopLoss.toString() : '');
    setEditTP(pos.takeProfit ? pos.takeProfit.toString() : '');
  };

  const saveEdit = (posId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const sl = editSL.trim() !== '' ? parseFloat(editSL) : undefined;
    const tp = editTP.trim() !== '' ? parseFloat(editTP) : undefined;
    updatePositionSLTP(posId, sl, tp);
    setEditingPosId(null);
  };

  const cancelEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingPosId(null);
  };

  const handleSelectPosition = (symbol: string) => {
    setSelectedSymbol(symbol);
  };

  const handleOpenChart = (symbol: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedSymbol(symbol);
    setMobileTab('chart');
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-zinc-950 select-none overflow-hidden transition-colors">
      {/* Portfolio Summary Bar */}
      <div className="p-3 bg-slate-50/80 dark:bg-zinc-950 border-b border-slate-200 dark:border-zinc-800/80 flex items-center justify-between shrink-0">
        <div className="flex flex-col">
          <span className="text-[10px] uppercase text-slate-500 dark:text-zinc-400 font-sans font-medium">Open Positions</span>
          <span className="text-sm font-bold text-slate-900 dark:text-zinc-100 font-mono">
            {openPositions.length} active trade{openPositions.length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="flex items-center gap-4 text-xs font-mono">
          <div className="flex flex-col items-end">
            <span className="text-[10px] uppercase text-slate-500 dark:text-zinc-400 font-sans font-medium">Floating P/L</span>
            <span
              className={`font-bold flex items-center gap-0.5 ${
                isNetProfitable ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              {isNetProfitable ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
              {isNetProfitable ? '+' : ''}${totalFloatingPnL.toFixed(2)}
            </span>
          </div>

          <div className="flex flex-col items-end">
            <span className="text-[10px] uppercase text-slate-500 dark:text-zinc-400 font-sans font-medium">Used Margin</span>
            <span className="font-semibold text-slate-700 dark:text-zinc-300">${totalMarginLocked.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* Position Cards List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {openPositions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-slate-400 dark:text-zinc-500 font-sans text-xs gap-1">
            <span className="font-medium text-slate-600 dark:text-zinc-400">No open positions.</span>
            <span className="text-[11px] text-slate-400 dark:text-zinc-500">Go to Trade tab to open a position.</span>
          </div>
        ) : (
          openPositions.map((pos) => {
            const symCfg = symbols[pos.symbol];
            const digits = symCfg?.digits || 2;
            const isProfitable = pos.unrealizedPnL >= 0;
            const isEditing = editingPosId === pos.id;
            const isSelected = selectedSymbol === pos.symbol;

            return (
              <div
                key={pos.id}
                onClick={() => handleSelectPosition(pos.symbol)}
                className={`p-3.5 rounded-2xl bg-white dark:bg-zinc-900/60 border transition-colors shadow-xs flex flex-col gap-3 cursor-pointer ${
                  isSelected
                    ? 'border-blue-500 dark:border-blue-500 ring-1 ring-blue-500/30'
                    : 'border-slate-200 dark:border-zinc-800/80 hover:border-slate-300'
                }`}
              >
                {/* Card Header: Symbol, Side, Lots, ID */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-base text-slate-900 dark:text-zinc-100 font-mono">{pos.symbol}</span>
                    <span
                      className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold border ${
                        pos.side === 'BUY'
                          ? 'bg-emerald-50 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800/60'
                          : 'bg-rose-50 dark:bg-rose-950/80 text-rose-700 dark:text-rose-400 border-rose-300 dark:border-rose-800/60'
                      }`}
                    >
                      {pos.side} {pos.volume.toFixed(2)}L
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={(e) => handleOpenChart(pos.symbol, e)}
                      className="p-1.5 rounded-lg bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-600 dark:text-zinc-300 cursor-pointer border border-slate-200 dark:border-zinc-700"
                      title="View on Chart"
                    >
                      <BarChart2 className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    </button>
                    <span className="text-[11px] text-slate-400 dark:text-zinc-500 font-mono">#{pos.id.slice(-6)}</span>
                  </div>
                </div>

                {/* Price & Floating P/L Row */}
                <div className="grid grid-cols-3 gap-2 p-2.5 rounded-xl bg-slate-50 dark:bg-zinc-950/60 font-mono text-xs border border-slate-100 dark:border-zinc-900">
                  <div className="flex flex-col">
                    <span className="text-[9px] uppercase text-slate-400 dark:text-zinc-500 font-sans">Open Price</span>
                    <span className="font-semibold text-slate-700 dark:text-zinc-300">{pos.openPrice.toFixed(digits)}</span>
                  </div>

                  <div className="flex flex-col">
                    <span className="text-[9px] uppercase text-slate-400 dark:text-zinc-500 font-sans">Current Price</span>
                    <span className="font-bold text-slate-900 dark:text-zinc-100">{pos.currentPrice.toFixed(digits)}</span>
                  </div>

                  <div className="flex flex-col items-end">
                    <span className="text-[9px] uppercase text-slate-400 dark:text-zinc-500 font-sans">Floating P/L</span>
                    <span className={`font-bold text-sm ${isProfitable ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                      {isProfitable ? '+' : ''}${pos.unrealizedPnL.toFixed(2)}
                    </span>
                  </div>
                </div>

                {/* SL / TP & Action Row */}
                <div className="flex items-center justify-between text-xs font-mono pt-1" onClick={(e) => e.stopPropagation()}>
                  {/* Inline SL/TP modifier */}
                  {isEditing ? (
                    <div className="flex items-center gap-1.5 flex-1 pr-2">
                      <input
                        type="number"
                        placeholder="SL"
                        value={editSL}
                        onChange={(e) => setEditSL(e.target.value)}
                        className="w-20 bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 rounded px-1.5 py-1 text-xs text-slate-900 dark:text-zinc-200 outline-none"
                      />
                      <input
                        type="number"
                        placeholder="TP"
                        value={editTP}
                        onChange={(e) => setEditTP(e.target.value)}
                        className="w-20 bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 rounded px-1.5 py-1 text-xs text-slate-900 dark:text-zinc-200 outline-none"
                      />
                      <button
                        onClick={(e) => saveEdit(pos.id, e)}
                        className="p-1.5 rounded bg-blue-600 text-white cursor-pointer min-h-[36px] min-w-[36px] flex items-center justify-center"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="p-1.5 rounded bg-slate-200 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400 cursor-pointer min-h-[36px] min-w-[36px] flex items-center justify-center"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-slate-500 dark:text-zinc-400">
                      <span className="text-[11px]">
                        SL: <strong className="text-slate-700 dark:text-zinc-300">{pos.stopLoss ? pos.stopLoss.toFixed(digits) : '—'}</strong>
                      </span>
                      <span>·</span>
                      <span className="text-[11px]">
                        TP: <strong className="text-slate-700 dark:text-zinc-300">{pos.takeProfit ? pos.takeProfit.toFixed(digits) : '—'}</strong>
                      </span>
                      <button
                        onClick={(e) => startEdit(pos, e)}
                        className="p-1 text-slate-400 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-zinc-200 cursor-pointer"
                        title="Edit SL/TP"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  {/* Prominent Close Button (Min 44px touch target) */}
                  <button
                    onClick={() => closePosition(pos.id)}
                    className="min-h-[44px] px-4 py-1.5 rounded-xl bg-slate-100 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-300 dark:bg-zinc-800 dark:hover:bg-rose-950/80 dark:hover:text-rose-400 border border-slate-200 dark:border-zinc-700 dark:hover:border-rose-800 text-slate-800 dark:text-zinc-200 font-bold text-xs tracking-wider transition-colors cursor-pointer"
                  >
                    CLOSE
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
