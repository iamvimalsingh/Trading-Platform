/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * MOBILE HISTORY VIEW (T3A / UI POLISH 1.0)
 * Mobile card & list presentation for Closed Trades, Working/Executed Orders (with Cancel & Replace),
 * and double-entry Account Ledger.
 */

import React, { useState } from 'react';
import { Check, Edit2, Trash2, X } from 'lucide-react';
import { Order } from '../../types/trading';
import { useTradingStore } from '../../store/useTradingStore';

export const MobileHistoryView: React.FC = () => {
  const [subTab, setSubTab] = useState<'trades' | 'orders' | 'ledger'>('trades');

  const closedTrades = useTradingStore((state) => state.closedTrades);
  const orders = useTradingStore((state) => state.orders);
  const ledger = useTradingStore((state) => state.ledger);
  const selectedSymbol = useTradingStore((state) => state.selectedSymbol);
  const setSelectedSymbol = useTradingStore((state) => state.setSelectedSymbol);
  const cancelOrder = useTradingStore((state) => state.cancelOrder);
  const replaceOrder = useTradingStore((state) => state.replaceOrder);

  // Edit / Replace state for mobile
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState<string>('');
  const [editSL, setEditSL] = useState<string>('');
  const [editTP, setEditTP] = useState<string>('');
  const [editVolume, setEditVolume] = useState<string>('');

  const startEdit = (ord: Order, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingOrderId(ord.id);
    setEditPrice(ord.requestedPrice ? ord.requestedPrice.toString() : '');
    setEditSL(ord.stopLoss ? ord.stopLoss.toString() : '');
    setEditTP(ord.takeProfit ? ord.takeProfit.toString() : '');
    setEditVolume(ord.volume ? ord.volume.toString() : '0.10');
  };

  const handleSave = async (orderId: string, e: React.MouseEvent) => {
    e.stopPropagation();
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

  const handleCancelOrder = (orderId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    cancelOrder(orderId);
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-zinc-950 select-none overflow-hidden transition-colors">
      {/* Sub-tab Switcher (min 44px touch targets) */}
      <div className="h-12 px-3 bg-slate-50/80 dark:bg-zinc-950 border-b border-slate-200 dark:border-zinc-800/80 flex items-center justify-around shrink-0 gap-1.5">
        {[
          { id: 'trades' as const, label: `Trades (${closedTrades.length})` },
          { id: 'orders' as const, label: `Orders (${orders.length})` },
          { id: 'ledger' as const, label: `Ledger (${ledger.length})` },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setSubTab(tab.id)}
            className={`flex-1 min-h-[38px] py-1.5 rounded-lg text-xs font-bold font-mono transition-colors cursor-pointer flex items-center justify-center ${
              subTab === tab.id
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-white dark:bg-zinc-900 text-slate-600 dark:text-zinc-400 border border-slate-200 dark:border-zinc-800 hover:text-slate-900 dark:hover:text-zinc-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {/* CLOSED TRADES */}
        {subTab === 'trades' && (
          <>
            {closedTrades.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-slate-400 dark:text-zinc-500 font-sans text-xs">
                No closed trades yet.
              </div>
            ) : (
              closedTrades.map((trade) => {
                const isProfit = (trade.realizedPnL || 0) >= 0;
                const isSelected = selectedSymbol === trade.symbol;

                return (
                  <div
                    key={trade.id}
                    onClick={() => setSelectedSymbol(trade.symbol)}
                    className={`p-3 rounded-xl bg-white dark:bg-zinc-900/60 border transition-colors flex flex-col gap-2 font-mono text-xs cursor-pointer ${
                      isSelected
                        ? 'border-blue-500 dark:border-blue-500 ring-1 ring-blue-500/30'
                        : 'border-slate-200 dark:border-zinc-800/80'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 dark:text-zinc-100">{trade.symbol}</span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                            trade.side === 'BUY'
                              ? 'bg-emerald-50 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800/60'
                              : 'bg-rose-50 dark:bg-rose-950/80 text-rose-700 dark:text-rose-400 border-rose-300 dark:border-rose-800/60'
                          }`}
                        >
                          {trade.side} {trade.volume.toFixed(2)}L
                        </span>
                      </div>
                      <span
                        className={`font-bold text-sm ${
                          isProfit ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {isProfit ? '+' : ''}${trade.realizedPnL?.toFixed(2)}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-500 dark:text-zinc-400 bg-slate-50 dark:bg-zinc-950/50 p-2 rounded-lg">
                      <div>Open: <strong className="text-slate-700 dark:text-zinc-300">{trade.openPrice}</strong></div>
                      <div>Close: <strong className="text-slate-700 dark:text-zinc-300">{trade.currentPrice}</strong></div>
                    </div>
                  </div>
                );
              })
            )}
          </>
        )}

        {/* ORDERS */}
        {subTab === 'orders' && (
          <>
            {orders.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-slate-400 dark:text-zinc-500 font-sans text-xs">
                No orders placed yet.
              </div>
            ) : (
              orders.map((ord) => {
                const isEditing = editingOrderId === ord.id;
                const isWorking = ord.status === 'WORKING' || ord.status === 'PENDING';
                const isSelected = selectedSymbol === ord.symbol;

                return (
                  <div
                    key={ord.id}
                    onClick={() => setSelectedSymbol(ord.symbol)}
                    className={`p-3 rounded-xl bg-white dark:bg-zinc-900/60 border transition-colors flex flex-col gap-2 font-mono text-xs cursor-pointer ${
                      isSelected
                        ? 'border-blue-500 dark:border-blue-500 ring-1 ring-blue-500/30'
                        : 'border-slate-200 dark:border-zinc-800/80'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 dark:text-zinc-100">{ord.symbol}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 font-semibold border border-slate-200 dark:border-zinc-700">
                          {ord.type} {ord.side}
                        </span>
                      </div>

                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          ord.status === 'FILLED'
                            ? 'bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800/50'
                            : ord.status === 'WORKING' || ord.status === 'PENDING'
                            ? 'bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-800/60 animate-pulse'
                            : 'bg-slate-100 dark:bg-zinc-800 text-slate-500 dark:text-zinc-400'
                        }`}
                      >
                        {ord.status}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-zinc-400 bg-slate-50 dark:bg-zinc-950/50 p-2 rounded-lg">
                      <span>Vol: <strong className="text-slate-800 dark:text-zinc-200">{ord.volume.toFixed(2)}L</strong></span>
                      <span>Target: <strong className="text-slate-800 dark:text-zinc-200">{ord.requestedPrice || 'Market'}</strong></span>
                      <span>Exec: <strong className="text-slate-800 dark:text-zinc-200">{ord.executionPrice || '—'}</strong></span>
                    </div>

                    {/* Working Order Inline Modifier / Cancel */}
                    {isWorking && (
                      <div className="pt-1 flex items-center justify-between" onClick={(e) => e.stopPropagation()}>
                        {isEditing ? (
                          <div className="flex items-center gap-1.5 flex-1">
                            <input
                              type="number"
                              placeholder="Price"
                              value={editPrice}
                              onChange={(e) => setEditPrice(e.target.value)}
                              className="w-20 bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 rounded px-1.5 py-1 text-xs outline-none"
                            />
                            <button
                              onClick={(e) => handleSave(ord.id, e)}
                              className="p-1.5 rounded bg-blue-600 text-white cursor-pointer min-h-[36px] min-w-[36px] flex items-center justify-center"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingOrderId(null);
                              }}
                              className="p-1.5 rounded bg-slate-200 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400 cursor-pointer min-h-[36px] min-w-[36px] flex items-center justify-center"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 w-full justify-end">
                            <button
                              onClick={(e) => startEdit(ord, e)}
                              className="px-3 min-h-[38px] rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-slate-700 dark:text-zinc-300 text-xs font-semibold flex items-center gap-1.5 border border-slate-200 dark:border-zinc-700"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                              <span>Replace</span>
                            </button>
                            <button
                              onClick={(e) => handleCancelOrder(ord.id, e)}
                              className="px-3 min-h-[38px] rounded-lg bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 dark:hover:bg-rose-900 border border-rose-200 dark:border-rose-800/60 text-rose-700 dark:text-rose-300 text-xs font-semibold flex items-center gap-1.5"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Cancel</span>
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </>
        )}

        {/* LEDGER */}
        {subTab === 'ledger' && (
          <>
            {ledger.map((entry) => (
              <div
                key={entry.id}
                className="p-3 rounded-xl bg-white dark:bg-zinc-900/60 border border-slate-200 dark:border-zinc-800/80 flex flex-col gap-1.5 font-mono text-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-800 dark:text-zinc-300">{entry.type}</span>
                  <span
                    className={`font-bold text-sm ${
                      entry.amount >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {entry.amount >= 0 ? '+' : ''}${entry.amount.toFixed(2)}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 dark:text-zinc-400 font-sans">{entry.description}</div>
                <div className="text-[10px] text-slate-400 dark:text-zinc-500 flex items-center justify-between border-t border-slate-100 dark:border-zinc-800/50 pt-1">
                  <span>Balance After: ${entry.balanceAfter.toFixed(2)}</span>
                  <span>{new Date(entry.createdAt).toLocaleTimeString()}</span>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
};
