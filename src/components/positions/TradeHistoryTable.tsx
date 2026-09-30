/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * EXECUTION, ORDERS & PORTFOLIO TABLES (T3A)
 * Desktop views for Orders (including working orders with Cancel & Replace),
 * Closed Trade History, and double-entry Account Ledger.
 */

import React, { useState } from 'react';
import { Check, Edit2, Trash2, X } from 'lucide-react';
import { Order } from '../../types/trading';
import { useTradingStore } from '../../store/useTradingStore';

export const TradeHistoryTable: React.FC<{ view: 'orders' | 'history' | 'ledger' }> = ({
  view,
}) => {
  const orders = useTradingStore((state) => state.orders);
  const closedTrades = useTradingStore((state) => state.closedTrades);
  const ledger = useTradingStore((state) => state.ledger);
  const symbols = useTradingStore((state) => state.symbols);
  const cancelOrder = useTradingStore((state) => state.cancelOrder);
  const replaceOrder = useTradingStore((state) => state.replaceOrder);

  // Edit / Replace state for working orders
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState<string>('');
  const [editSL, setEditSL] = useState<string>('');
  const [editTP, setEditTP] = useState<string>('');
  const [editVolume, setEditVolume] = useState<string>('');

  const startEditOrder = (ord: Order) => {
    setEditingOrderId(ord.id);
    setEditPrice(ord.requestedPrice ? ord.requestedPrice.toString() : '');
    setEditSL(ord.stopLoss ? ord.stopLoss.toString() : '');
    setEditTP(ord.takeProfit ? ord.takeProfit.toString() : '');
    setEditVolume(ord.volume ? ord.volume.toString() : '0.10');
  };

  const handleSaveReplace = async (orderId: string) => {
    const p = parseFloat(editPrice);
    const sl = editSL.trim() !== '' ? parseFloat(editSL) : undefined;
    const tp = editTP.trim() !== '' ? parseFloat(editTP) : undefined;
    const vol = parseFloat(editVolume);

    await replaceOrder({
      orderId,
      requestedPrice: !isNaN(p) && p > 0 ? p : undefined,
      volume: !isNaN(vol) && vol > 0 ? vol : undefined,
      stopLoss: sl,
      takeProfit: tp,
    });
    setEditingOrderId(null);
  };

  if (view === 'orders') {
    if (orders.length === 0) {
      return (
        <div className="flex items-center justify-center h-44 text-zinc-500 font-sans text-xs">
          No orders submitted yet.
        </div>
      );
    }

    return (
      <div className="overflow-x-auto select-none">
        <table className="w-full text-left text-xs font-mono">
          <thead className="bg-zinc-900/80 text-zinc-400 border-b border-zinc-800 text-[10px] uppercase tracking-wider sticky top-0">
            <tr>
              <th className="py-2 px-3">Order ID</th>
              <th className="py-2 px-3">Time</th>
              <th className="py-2 px-3">Symbol</th>
              <th className="py-2 px-3">Type</th>
              <th className="py-2 px-3">Side</th>
              <th className="py-2 px-3">Lots</th>
              <th className="py-2 px-3">Trigger / Req. Price</th>
              <th className="py-2 px-3">Exec. Price</th>
              <th className="py-2 px-3">SL / TP</th>
              <th className="py-2 px-3">Status</th>
              <th className="py-2 px-3 text-center">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-900/60">
            {orders.map((ord) => {
              const symCfg = symbols[ord.symbol];
              const digits = symCfg?.digits || 2;
              const isEditing = editingOrderId === ord.id;
              const isWorking = ord.status === 'WORKING' || ord.status === 'PENDING';

              return (
                <tr key={ord.id} className="hover:bg-zinc-900/30 transition-colors">
                  <td className="py-2 px-3 text-zinc-500 text-[11px]">#{ord.id}</td>
                  <td className="py-2 px-3 text-zinc-400 text-[11px]">
                    {new Date(ord.createdAt).toLocaleTimeString()}
                  </td>
                  <td className="py-2 px-3 font-semibold text-zinc-200">{ord.symbol}</td>
                  <td className="py-2 px-3">
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-zinc-800 text-zinc-300 font-semibold border border-zinc-700/60">
                      {ord.type}
                    </span>
                  </td>
                  <td className="py-2 px-3">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        ord.side === 'BUY'
                          ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/40'
                          : 'bg-rose-950/60 text-rose-400 border border-rose-800/40'
                      }`}
                    >
                      {ord.side}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-zinc-300">
                    {isEditing ? (
                      <input
                        type="number"
                        step="0.01"
                        value={editVolume}
                        onChange={(e) => setEditVolume(e.target.value)}
                        className="w-14 bg-zinc-900 border border-zinc-700 rounded px-1 py-0.5 text-[11px] text-zinc-100 outline-none"
                      />
                    ) : (
                      ord.volume.toFixed(2)
                    )}
                  </td>
                  <td className="py-2 px-3 text-zinc-200 font-semibold">
                    {isEditing ? (
                      <input
                        type="number"
                        step="any"
                        value={editPrice}
                        onChange={(e) => setEditPrice(e.target.value)}
                        className="w-20 bg-zinc-900 border border-blue-500 rounded px-1 py-0.5 text-[11px] text-zinc-100 outline-none"
                      />
                    ) : (
                      ord.requestedPrice > 0 ? ord.requestedPrice.toFixed(digits) : 'Market'
                    )}
                  </td>
                  <td className="py-2 px-3 text-zinc-300">
                    {ord.executionPrice > 0 ? ord.executionPrice.toFixed(digits) : '—'}
                  </td>
                  <td className="py-2 px-3 text-zinc-400 text-[11px]">
                    {isEditing ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          placeholder="SL"
                          value={editSL}
                          onChange={(e) => setEditSL(e.target.value)}
                          className="w-14 bg-zinc-900 border border-zinc-700 rounded px-1 py-0.5 text-[10px] text-zinc-200 outline-none"
                        />
                        <input
                          type="number"
                          placeholder="TP"
                          value={editTP}
                          onChange={(e) => setEditTP(e.target.value)}
                          className="w-14 bg-zinc-900 border border-zinc-700 rounded px-1 py-0.5 text-[10px] text-zinc-200 outline-none"
                        />
                      </div>
                    ) : (
                      `${ord.stopLoss ? ord.stopLoss.toFixed(digits) : '—'} / ${ord.takeProfit ? ord.takeProfit.toFixed(digits) : '—'}`
                    )}
                  </td>
                  <td className="py-2 px-3">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        ord.status === 'FILLED'
                          ? 'bg-blue-950 text-blue-400 border border-blue-800/40'
                          : ord.status === 'WORKING' || ord.status === 'PENDING'
                          ? 'bg-amber-950 text-amber-300 border border-amber-800/50 animate-pulse'
                          : ord.status === 'CANCELLED'
                          ? 'bg-zinc-800 text-zinc-400 border border-zinc-700'
                          : ord.status === 'REPLACED'
                          ? 'bg-purple-950 text-purple-300 border border-purple-800/50'
                          : 'bg-rose-950 text-rose-400 border border-rose-800/40'
                      }`}
                    >
                      {ord.status}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-center">
                    {isWorking ? (
                      isEditing ? (
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => handleSaveReplace(ord.id)}
                            className="p-1 rounded bg-blue-600 hover:bg-blue-500 text-white cursor-pointer"
                            title="Save Replacement"
                          >
                            <Check className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => setEditingOrderId(null)}
                            className="p-1 rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200 cursor-pointer"
                            title="Cancel Edit"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => startEditOrder(ord)}
                            className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[10px] font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                            title="Replace / Modify Order"
                          >
                            <Edit2 className="w-2.5 h-2.5" />
                            <span>REPLACE</span>
                          </button>
                          <button
                            onClick={() => cancelOrder(ord.id)}
                            className="px-2 py-0.5 rounded bg-rose-950/60 hover:bg-rose-900 border border-rose-800/60 text-rose-300 text-[10px] font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                            title="Cancel Order"
                          >
                            <Trash2 className="w-2.5 h-2.5" />
                            <span>CANCEL</span>
                          </button>
                        </div>
                      )
                    ) : (
                      <span className="text-[11px] text-zinc-600">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  if (view === 'history') {
    if (closedTrades.length === 0) {
      return (
        <div className="flex items-center justify-center h-44 text-zinc-500 font-sans text-xs">
          No closed trades yet.
        </div>
      );
    }

    return (
      <div className="overflow-x-auto select-none">
        <table className="w-full text-left text-xs font-mono">
          <thead className="bg-zinc-900/80 text-zinc-400 border-b border-zinc-800 text-[10px] uppercase tracking-wider sticky top-0">
            <tr>
              <th className="py-2 px-3">Position ID</th>
              <th className="py-2 px-3">Closed Time</th>
              <th className="py-2 px-3">Symbol</th>
              <th className="py-2 px-3">Side</th>
              <th className="py-2 px-3">Lots</th>
              <th className="py-2 px-3">Open Price</th>
              <th className="py-2 px-3">Close Price</th>
              <th className="py-2 px-3 text-right">Realized P/L</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-900/60">
            {closedTrades.map((pos) => {
              const isProfit = pos.realizedPnL >= 0;
              const symCfg = symbols[pos.symbol];
              const digits = symCfg?.digits || 2;

              return (
                <tr key={pos.id} className="hover:bg-zinc-900/30">
                  <td className="py-2 px-3 text-zinc-500 text-[11px]">#{pos.id.slice(-6)}</td>
                  <td className="py-2 px-3 text-zinc-400 text-[11px]">
                    {pos.closedAt ? new Date(pos.closedAt).toLocaleTimeString() : '—'}
                  </td>
                  <td className="py-2 px-3 font-semibold text-zinc-200">{pos.symbol}</td>
                  <td className="py-2 px-3">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        pos.side === 'BUY'
                          ? 'bg-emerald-950/60 text-emerald-400'
                          : 'bg-rose-950/60 text-rose-400'
                      }`}
                    >
                      {pos.side}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-zinc-300">{pos.volume.toFixed(2)}</td>
                  <td className="py-2 px-3 text-zinc-400">{pos.openPrice.toFixed(digits)}</td>
                  <td className="py-2 px-3 text-zinc-200">{pos.currentPrice.toFixed(digits)}</td>
                  <td className="py-2 px-3 text-right">
                    <span className={`font-bold ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {isProfit ? '+' : ''}${pos.realizedPnL.toFixed(2)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  // Ledger View
  return (
    <div className="overflow-x-auto select-none">
      <table className="w-full text-left text-xs font-mono">
        <thead className="bg-zinc-900/80 text-zinc-400 border-b border-zinc-800 text-[10px] uppercase tracking-wider sticky top-0">
          <tr>
            <th className="py-2 px-3">Transaction ID</th>
            <th className="py-2 px-3">Time</th>
            <th className="py-2 px-3">Type</th>
            <th className="py-2 px-3">Amount</th>
            <th className="py-2 px-3">Balance After</th>
            <th className="py-2 px-3">Description</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-900/60">
          {ledger.map((entry) => (
            <tr key={entry.id} className="hover:bg-zinc-900/30">
              <td className="py-2 px-3 text-zinc-500 text-[11px]">#{entry.id}</td>
              <td className="py-2 px-3 text-zinc-400 text-[11px]">
                {new Date(entry.createdAt).toLocaleTimeString()}
              </td>
              <td className="py-2 px-3">
                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-zinc-800 text-zinc-300">
                  {entry.type}
                </span>
              </td>
              <td className="py-2 px-3">
                <span
                  className={`font-bold ${
                    entry.amount >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {entry.amount >= 0 ? '+' : ''}${entry.amount.toFixed(2)}
                </span>
              </td>
              <td className="py-2 px-3 text-zinc-200">${entry.balanceAfter.toFixed(2)}</td>
              <td className="py-2 px-3 text-zinc-400 text-[11px]">{entry.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
