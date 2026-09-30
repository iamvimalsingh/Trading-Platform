/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * MOBILE POSITIONS VIEW
 * High-clarity position cards replacing the desktop 10-column table.
 * Touch-friendly inline SL/TP editor, live floating P/L, and prominent Close action.
 */

import React, { useState } from 'react';
import {
  Briefcase,
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

  const startEdit = (pos: Position) => {
    setEditingPosId(pos.id);
    setEditSL(pos.stopLoss ? pos.stopLoss.toString() : '');
    setEditTP(pos.takeProfit ? pos.takeProfit.toString() : '');
  };

  const saveEdit = (posId: string) => {
    const sl = editSL.trim() !== '' ? parseFloat(editSL) : undefined;
    const tp = editTP.trim() !== '' ? parseFloat(editTP) : undefined;
    updatePositionSLTP(posId, sl, tp);
    setEditingPosId(null);
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950 select-none overflow-hidden">
      {/* Portfolio Summary Bar */}
      <div className="p-3 bg-zinc-950 border-b border-zinc-800/80 flex items-center justify-between shrink-0">
        <div className="flex flex-col">
          <span className="text-[10px] uppercase text-zinc-400 font-mono">Open Positions</span>
          <span className="text-sm font-bold text-zinc-100 font-mono">
            {openPositions.length} active trade{openPositions.length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="flex items-center gap-4 text-xs font-mono">
          <div className="flex flex-col items-end">
            <span className="text-[10px] uppercase text-zinc-400">Total Floating P/L</span>
            <span
              className={`font-bold flex items-center gap-0.5 ${
                isNetProfitable ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {isNetProfitable ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
              {isNetProfitable ? '+' : ''}${totalFloatingPnL.toFixed(2)}
            </span>
          </div>

          <div className="flex flex-col items-end">
            <span className="text-[10px] uppercase text-zinc-400">Margin In Use</span>
            <span className="font-semibold text-zinc-300">${totalMarginLocked.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* Position Cards List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {openPositions.map((pos) => {
          const symCfg = symbols[pos.symbol];
          const digits = symCfg?.digits || 2;
          const isProfitable = pos.unrealizedPnL >= 0;
          const isEditing = editingPosId === pos.id;

          return (
            <div
              key={pos.id}
              className="p-3.5 rounded-2xl bg-zinc-900/60 border border-zinc-800/80 shadow-sm flex flex-col gap-3"
            >
              {/* Card Header: Symbol, Side, Lots, ID */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-base text-zinc-100 font-mono">{pos.symbol}</span>
                  <span
                    className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold border ${
                      pos.side === 'BUY'
                        ? 'bg-emerald-950/80 text-emerald-400 border-emerald-800/60'
                        : 'bg-rose-950/80 text-rose-400 border-rose-800/60'
                    }`}
                  >
                    {pos.side} {pos.volume.toFixed(2)}L
                  </span>
                </div>

                <div className="text-right">
                  <span
                    className={`text-base font-bold font-mono ${
                      isProfitable ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {isProfitable ? '+' : ''}${pos.unrealizedPnL.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Price Details Grid */}
              <div className="grid grid-cols-3 gap-2 text-xs font-mono p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-850">
                <div className="flex flex-col">
                  <span className="text-[10px] text-zinc-400">Entry Price</span>
                  <span className="text-zinc-200 font-semibold">{pos.openPrice.toFixed(digits)}</span>
                </div>

                <div className="flex flex-col">
                  <span className="text-[10px] text-zinc-400">Current Price</span>
                  <span className="text-zinc-100 font-bold">{pos.currentPrice.toFixed(digits)}</span>
                </div>

                <div className="flex flex-col items-end">
                  <span className="text-[10px] text-zinc-400">Margin Locked</span>
                  <span className="text-zinc-300 font-medium">${pos.marginLocked.toFixed(2)}</span>
                </div>
              </div>

              {/* SL / TP Management Section */}
              <div className="flex items-center justify-between px-1 text-xs font-mono">
                {isEditing ? (
                  <div className="w-full flex items-center gap-2 pt-1">
                    <div className="flex-1 flex flex-col gap-0.5">
                      <span className="text-[10px] text-zinc-400">Stop Loss</span>
                      <input
                        type="number"
                        step="any"
                        placeholder="SL"
                        value={editSL}
                        onChange={(e) => setEditSL(e.target.value)}
                        className="w-full min-h-[44px] bg-zinc-950 border border-zinc-700 rounded-lg px-2 text-xs text-zinc-100 outline-none"
                      />
                    </div>
                    <div className="flex-1 flex flex-col gap-0.5">
                      <span className="text-[10px] text-zinc-400">Take Profit</span>
                      <input
                        type="number"
                        step="any"
                        placeholder="TP"
                        value={editTP}
                        onChange={(e) => setEditTP(e.target.value)}
                        className="w-full min-h-[44px] bg-zinc-950 border border-zinc-700 rounded-lg px-2 text-xs text-zinc-100 outline-none"
                      />
                    </div>
                    <div className="flex items-center gap-1 self-end">
                      <button
                        onClick={() => saveEdit(pos.id)}
                        className="min-h-[44px] min-w-[44px] rounded-lg bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center cursor-pointer"
                        title="Save SL/TP"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setEditingPosId(null)}
                        className="min-h-[44px] min-w-[44px] rounded-lg bg-zinc-800 text-zinc-400 hover:text-zinc-200 flex items-center justify-center cursor-pointer"
                        title="Cancel"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="w-full flex items-center justify-between">
                    <div className="flex items-center gap-3 text-zinc-400 text-xs">
                      <span>SL: {pos.stopLoss ? pos.stopLoss.toFixed(digits) : 'None'}</span>
                      <span className="text-zinc-700">|</span>
                      <span>TP: {pos.takeProfit ? pos.takeProfit.toFixed(digits) : 'None'}</span>
                    </div>

                    <button
                      onClick={() => startEdit(pos)}
                      className="min-h-[38px] px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-sans flex items-center gap-1 cursor-pointer transition-colors"
                    >
                      <Edit2 className="w-3 h-3 text-zinc-400" />
                      <span>Edit SL/TP</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Action: Close Position (Min 48px touch target) */}
              <button
                onClick={() => closePosition(pos.id)}
                className="w-full min-h-[48px] py-2.5 rounded-xl bg-zinc-800 hover:bg-rose-950/80 active:bg-rose-900 border border-zinc-700/80 hover:border-rose-800/80 text-zinc-200 hover:text-rose-300 text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer flex items-center justify-center"
              >
                Close Position #{pos.id.slice(-6)}
              </button>
            </div>
          );
        })}

        {openPositions.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 text-zinc-500 font-sans text-xs gap-3">
            <div className="w-12 h-12 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center">
              <Briefcase className="w-6 h-6 text-zinc-600" />
            </div>
            <div className="text-center">
              <p className="font-semibold text-zinc-400">No open positions</p>
              <p className="text-[11px] text-zinc-600 mt-0.5">
                Execute a BUY or SELL order to open your first position.
              </p>
            </div>
            <button
              onClick={() => setMobileTab('quotes')}
              className="min-h-[44px] px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs transition-colors cursor-pointer"
            >
              Browse Instruments
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
