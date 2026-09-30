/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Check, Edit2, X } from 'lucide-react';
import { Position } from '../../types/trading';
import { useTradingStore } from '../../store/useTradingStore';

export const PositionsTable: React.FC = () => {
  const positions = useTradingStore((state) => state.positions);
  const symbols = useTradingStore((state) => state.symbols);
  const selectedSymbol = useTradingStore((state) => state.selectedSymbol);
  const setSelectedSymbol = useTradingStore((state) => state.setSelectedSymbol);
  const closePosition = useTradingStore((state) => state.closePosition);
  const updatePositionSLTP = useTradingStore((state) => state.updatePositionSLTP);

  const [editingPosId, setEditingPosId] = useState<string | null>(null);
  const [editSL, setEditSL] = useState<string>('');
  const [editTP, setEditTP] = useState<string>('');

  const openPositions = positions.filter((p) => p.status === 'OPEN');

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

  const handleRowClick = (symbol: string) => {
    setSelectedSymbol(symbol);
  };

  if (openPositions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 text-slate-400 dark:text-zinc-500 font-sans text-xs gap-1 select-none">
        <span className="font-medium text-slate-600 dark:text-zinc-400">No open positions.</span>
        <span className="text-[11px] text-slate-400 dark:text-zinc-500">
          Execute a BUY or SELL order from the Order Ticket to start trading.
        </span>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto select-none bg-white dark:bg-zinc-950 transition-colors">
      <table className="w-full text-left text-xs font-mono">
        <thead className="bg-slate-50 dark:bg-zinc-900/80 text-slate-500 dark:text-zinc-400 border-b border-slate-200 dark:border-zinc-800 text-[10px] uppercase tracking-wider sticky top-0 font-sans font-semibold">
          <tr>
            <th className="py-2.5 px-3">Position ID</th>
            <th className="py-2.5 px-3">Symbol</th>
            <th className="py-2.5 px-3">Side</th>
            <th className="py-2.5 px-3">Lots</th>
            <th className="py-2.5 px-3">Open Price</th>
            <th className="py-2.5 px-3">Current Price</th>
            <th className="py-2.5 px-3">SL / TP</th>
            <th className="py-2.5 px-3">Margin</th>
            <th className="py-2.5 px-3 text-right">Unrealized P/L</th>
            <th className="py-2.5 px-3 text-center">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-zinc-900/60">
          {openPositions.map((pos) => {
            const symCfg = symbols[pos.symbol];
            const digits = symCfg?.digits || 2;
            const isProfitable = pos.unrealizedPnL >= 0;
            const isEditing = editingPosId === pos.id;
            const isSelected = selectedSymbol === pos.symbol;

            return (
              <tr
                key={pos.id}
                onClick={() => handleRowClick(pos.symbol)}
                className={`transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-blue-50/70 dark:bg-zinc-900/80 font-medium'
                    : 'hover:bg-slate-50 dark:hover:bg-zinc-900/40'
                }`}
                title="Click to view symbol chart & order ticket"
              >
                {/* ID */}
                <td className="py-2 px-3 text-slate-400 dark:text-zinc-500 text-[11px]">#{pos.id.slice(-6)}</td>

                {/* Symbol */}
                <td className="py-2 px-3 font-bold text-slate-900 dark:text-zinc-100 flex items-center gap-1.5">
                  <span>{pos.symbol}</span>
                  {isSelected && (
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-600 dark:bg-blue-400" />
                  )}
                </td>

                {/* Side */}
                <td className="py-2 px-3">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      pos.side === 'BUY'
                        ? 'bg-emerald-50 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800/40'
                        : 'bg-rose-50 dark:bg-rose-950/80 text-rose-700 dark:text-rose-400 border border-rose-300 dark:border-rose-800/40'
                    }`}
                  >
                    {pos.side}
                  </span>
                </td>

                {/* Lots */}
                <td className="py-2 px-3 text-slate-700 dark:text-zinc-300">{pos.volume.toFixed(2)}</td>

                {/* Open Price */}
                <td className="py-2 px-3 text-slate-600 dark:text-zinc-300">{pos.openPrice.toFixed(digits)}</td>

                {/* Current Price */}
                <td className="py-2 px-3 font-semibold text-slate-800 dark:text-zinc-200">
                  {pos.currentPrice.toFixed(digits)}
                </td>

                {/* SL / TP with inline modifier */}
                <td className="py-2 px-3" onClick={(e) => e.stopPropagation()}>
                  {isEditing ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        placeholder="SL"
                        value={editSL}
                        onChange={(e) => setEditSL(e.target.value)}
                        className="w-16 bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 rounded px-1.5 py-0.5 text-[10px] text-slate-900 dark:text-zinc-200 outline-none"
                      />
                      <input
                        type="number"
                        placeholder="TP"
                        value={editTP}
                        onChange={(e) => setEditTP(e.target.value)}
                        className="w-16 bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 rounded px-1.5 py-0.5 text-[10px] text-slate-900 dark:text-zinc-200 outline-none"
                      />
                      <button
                        onClick={(e) => saveEdit(pos.id, e)}
                        className="p-1 rounded bg-blue-600 hover:bg-blue-500 text-white cursor-pointer"
                        title="Save SL/TP"
                      >
                        <Check className="w-3 h-3" />
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="p-1 rounded bg-slate-200 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200 cursor-pointer"
                        title="Cancel"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-zinc-400">
                      <span>{pos.stopLoss ? pos.stopLoss.toFixed(digits) : '—'}</span>
                      <span className="text-slate-300 dark:text-zinc-600">/</span>
                      <span>{pos.takeProfit ? pos.takeProfit.toFixed(digits) : '—'}</span>
                      <button
                        onClick={(e) => startEdit(pos, e)}
                        className="p-0.5 text-slate-400 dark:text-zinc-500 hover:text-slate-700 dark:hover:text-zinc-300 transition-colors cursor-pointer"
                        title="Modify SL/TP"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </td>

                {/* Margin Locked */}
                <td className="py-2 px-3 text-slate-500 dark:text-zinc-400">${pos.marginLocked.toFixed(2)}</td>

                {/* Unrealized P/L */}
                <td className="py-2 px-3 text-right">
                  <span
                    className={`font-bold ${
                      isProfitable ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {isProfitable ? '+' : ''}${pos.unrealizedPnL.toFixed(2)}
                  </span>
                </td>

                {/* Close Action */}
                <td className="py-2 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => closePosition(pos.id)}
                    className="px-2.5 py-1 rounded bg-slate-100 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-300 dark:bg-zinc-800 dark:hover:bg-rose-950/80 dark:hover:text-rose-400 border border-slate-200 dark:border-zinc-700/60 dark:hover:border-rose-800/60 text-slate-700 dark:text-zinc-300 text-[10px] font-bold transition-all cursor-pointer"
                  >
                    CLOSE
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
