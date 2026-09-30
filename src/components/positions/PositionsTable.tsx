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
  const closePosition = useTradingStore((state) => state.closePosition);
  const updatePositionSLTP = useTradingStore((state) => state.updatePositionSLTP);

  const [editingPosId, setEditingPosId] = useState<string | null>(null);
  const [editSL, setEditSL] = useState<string>('');
  const [editTP, setEditTP] = useState<string>('');

  const openPositions = positions.filter((p) => p.status === 'OPEN');

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

  if (openPositions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-44 text-zinc-500 font-sans text-xs gap-1 select-none">
        <span>No open positions.</span>
        <span className="text-[11px] text-zinc-600">
          Execute a BUY or SELL order from the Order Ticket to start trading.
        </span>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto select-none">
      <table className="w-full text-left text-xs font-mono">
        <thead className="bg-zinc-900/80 text-zinc-400 border-b border-zinc-800 text-[10px] uppercase tracking-wider sticky top-0">
          <tr>
            <th className="py-2 px-3">Position ID</th>
            <th className="py-2 px-3">Symbol</th>
            <th className="py-2 px-3">Side</th>
            <th className="py-2 px-3">Lots</th>
            <th className="py-2 px-3">Open Price</th>
            <th className="py-2 px-3">Current Price</th>
            <th className="py-2 px-3">SL / TP</th>
            <th className="py-2 px-3">Margin</th>
            <th className="py-2 px-3 text-right">Unrealized P/L</th>
            <th className="py-2 px-3 text-center">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-900/60">
          {openPositions.map((pos) => {
            const symCfg = symbols[pos.symbol];
            const digits = symCfg?.digits || 2;
            const isProfitable = pos.unrealizedPnL >= 0;
            const isEditing = editingPosId === pos.id;

            return (
              <tr key={pos.id} className="hover:bg-zinc-900/40 transition-colors">
                {/* ID */}
                <td className="py-2.5 px-3 text-zinc-500 text-[11px]">#{pos.id.slice(-6)}</td>

                {/* Symbol */}
                <td className="py-2.5 px-3 font-semibold text-zinc-100 flex items-center gap-1.5">
                  <span>{pos.symbol}</span>
                </td>

                {/* Side */}
                <td className="py-2.5 px-3">
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      pos.side === 'BUY'
                        ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/40'
                        : 'bg-rose-950/80 text-rose-400 border border-rose-800/40'
                    }`}
                  >
                    {pos.side}
                  </span>
                </td>

                {/* Lots */}
                <td className="py-2.5 px-3 text-zinc-300">{pos.volume.toFixed(2)}</td>

                {/* Open Price */}
                <td className="py-2.5 px-3 text-zinc-300">{pos.openPrice.toFixed(digits)}</td>

                {/* Current Price */}
                <td className="py-2.5 px-3 font-medium text-zinc-200">
                  {pos.currentPrice.toFixed(digits)}
                </td>

                {/* SL / TP with inline modifier */}
                <td className="py-2.5 px-3">
                  {isEditing ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        placeholder="SL"
                        value={editSL}
                        onChange={(e) => setEditSL(e.target.value)}
                        className="w-16 bg-zinc-900 border border-zinc-700 rounded px-1 py-0.5 text-[10px] text-zinc-200 outline-none"
                      />
                      <input
                        type="number"
                        placeholder="TP"
                        value={editTP}
                        onChange={(e) => setEditTP(e.target.value)}
                        className="w-16 bg-zinc-900 border border-zinc-700 rounded px-1 py-0.5 text-[10px] text-zinc-200 outline-none"
                      />
                      <button
                        onClick={() => saveEdit(pos.id)}
                        className="p-1 rounded bg-blue-600 hover:bg-blue-500 text-white cursor-pointer"
                        title="Save SL/TP"
                      >
                        <Check className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => setEditingPosId(null)}
                        className="p-1 rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200 cursor-pointer"
                        title="Cancel"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                      <span>{pos.stopLoss ? pos.stopLoss.toFixed(digits) : '—'}</span>
                      <span className="text-zinc-600">/</span>
                      <span>{pos.takeProfit ? pos.takeProfit.toFixed(digits) : '—'}</span>
                      <button
                        onClick={() => startEdit(pos)}
                        className="p-0.5 text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
                        title="Modify SL/TP"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </td>

                {/* Margin Locked */}
                <td className="py-2.5 px-3 text-zinc-400">${pos.marginLocked.toFixed(2)}</td>

                {/* Unrealized P/L */}
                <td className="py-2.5 px-3 text-right">
                  <span
                    className={`font-bold ${
                      isProfitable ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {isProfitable ? '+' : ''}${pos.unrealizedPnL.toFixed(2)}
                  </span>
                </td>

                {/* Close Action */}
                <td className="py-2.5 px-3 text-center">
                  <button
                    onClick={() => closePosition(pos.id)}
                    className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-rose-950/80 hover:text-rose-400 border border-zinc-700/60 hover:border-rose-800/60 text-zinc-300 text-[10px] font-semibold transition-all cursor-pointer"
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
