/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * MOBILE HISTORY VIEW (T3A)
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
  const cancelOrder = useTradingStore((state) => state.cancelOrder);
  const replaceOrder = useTradingStore((state) => state.replaceOrder);

  // Edit / Replace state for mobile
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState<string>('');
  const [editSL, setEditSL] = useState<string>('');
  const [editTP, setEditTP] = useState<string>('');
  const [editVolume, setEditVolume] = useState<string>('');

  const startEdit = (ord: Order) => {
    setEditingOrderId(ord.id);
    setEditPrice(ord.requestedPrice ? ord.requestedPrice.toString() : '');
    setEditSL(ord.stopLoss ? ord.stopLoss.toString() : '');
    setEditTP(ord.takeProfit ? ord.takeProfit.toString() : '');
    setEditVolume(ord.volume ? ord.volume.toString() : '0.10');
  };

  const handleSave = async (orderId: string) => {
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

  return (
    <div className="flex flex-col h-full bg-zinc-950 select-none overflow-hidden">
      {/* Sub-tab Switcher (44px touch targets) */}
      <div className="h-12 px-3 bg-zinc-950 border-b border-zinc-800/80 flex items-center justify-around shrink-0 gap-1">
        {[
          { id: 'trades' as const, label: `Trades (${closedTrades.length})` },
          { id: 'orders' as const, label: `Orders (${orders.length})` },
          { id: 'ledger' as const, label: `Ledger (${ledger.length})` },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setSubTab(tab.id)}
            className={`flex-1 min-h-[38px] py-1.5 rounded-lg text-xs font-semibold font-mono transition-colors cursor-pointer ${
              subTab === tab.id
                ? 'bg-zinc-800 text-blue-400 border border-zinc-700'
                : 'text-zinc-400 hover:text-zinc-200'
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
            {closedTrades.map((trade) => {
              const isProfit = (trade.realizedPnL || 0) >= 0;
              return (
                <div
                  key={trade.id}
                  className="p-3 rounded-xl bg-zinc-900/60 border border-zinc-800/80 flex flex-col gap-2 font-mono text-xs"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-zinc-100">{trade.symbol}</span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                          trade.side === 'BUY'
                            ? 'bg-emerald-950/80 text-emerald-400 border-emerald-800/60'
                            : 'bg-rose-950/80 text-rose-400 border-rose-800/60'
                        }`}
                      >
                        {trade.side} {trade.volume.toFixed(2)}L
                      </span>
                    </div>

                    <span
                      className={`font-bold text-sm ${
                        isProfit ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {isProfit ? '+' : ''}${(trade.realizedPnL || 0).toFixed(2)}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 p-2 rounded-lg bg-zinc-950/60 text-[11px] text-zinc-400">
                    <div>
                      <span>Open: </span>
                      <span className="text-zinc-200 font-semibold">{trade.openPrice}</span>
                    </div>
                    <div>
                      <span>Close: </span>
                      <span className="text-zinc-200 font-semibold">{trade.currentPrice}</span>
                    </div>
                  </div>
                </div>
              );
            })}

            {closedTrades.length === 0 && (
              <div className="p-8 text-center text-xs text-zinc-500 font-sans">
                No closed trades yet.
              </div>
            )}
          </>
        )}

        {/* ORDERS */}
        {subTab === 'orders' && (
          <>
            {orders.map((ord) => {
              const isWorking = ord.status === 'WORKING' || ord.status === 'PENDING';
              const isEditing = editingOrderId === ord.id;

              return (
                <div
                  key={ord.id}
                  className="p-3.5 rounded-xl bg-zinc-900/60 border border-zinc-800/80 flex flex-col gap-2 font-mono text-xs"
                >
                  {/* Card Header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-zinc-100">{ord.symbol}</span>
                      <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-zinc-800 text-zinc-300 border border-zinc-700">
                        {ord.type}
                      </span>
                      <span
                        className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                          ord.side === 'BUY' ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {ord.side} {ord.volume.toFixed(2)}L
                      </span>
                    </div>

                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                        ord.status === 'FILLED'
                          ? 'bg-blue-950/80 text-blue-400 border-blue-800/60'
                          : isWorking
                          ? 'bg-amber-950 text-amber-300 border-amber-800/60 animate-pulse'
                          : ord.status === 'CANCELLED'
                          ? 'bg-zinc-800 text-zinc-400 border-zinc-700'
                          : ord.status === 'REPLACED'
                          ? 'bg-purple-950 text-purple-300 border-purple-800/50'
                          : 'bg-rose-950/80 text-rose-400 border-rose-800/60'
                      }`}
                    >
                      {ord.status}
                    </span>
                  </div>

                  {/* Price & Time info */}
                  <div className="flex items-center justify-between text-[11px] text-zinc-400">
                    <span>
                      {ord.type === 'MARKET' ? 'Market Exec' : `Target Price: ${ord.requestedPrice}`}
                      {ord.executionPrice > 0 ? ` (Filled @ ${ord.executionPrice})` : ''}
                    </span>
                    <span>{new Date(ord.createdAt).toLocaleTimeString()}</span>
                  </div>

                  {/* Working Order Inline Modifier or Action buttons */}
                  {isWorking && (
                    <div className="pt-2 border-t border-zinc-800/60 flex flex-col gap-2">
                      {isEditing ? (
                        <div className="flex flex-col gap-2 bg-zinc-950/80 p-2.5 rounded-lg border border-zinc-800">
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <span className="text-[10px] text-zinc-400">Price</span>
                              <input
                                type="number"
                                step="any"
                                value={editPrice}
                                onChange={(e) => setEditPrice(e.target.value)}
                                className="w-full min-h-[40px] bg-zinc-900 border border-zinc-700 rounded-lg px-2 text-xs text-zinc-100 outline-none"
                              />
                            </div>
                            <div>
                              <span className="text-[10px] text-zinc-400">Volume</span>
                              <input
                                type="number"
                                step="0.01"
                                value={editVolume}
                                onChange={(e) => setEditVolume(e.target.value)}
                                className="w-full min-h-[40px] bg-zinc-900 border border-zinc-700 rounded-lg px-2 text-xs text-zinc-100 outline-none"
                              />
                            </div>
                          </div>

                          <div className="flex items-center justify-end gap-2 pt-1">
                            <button
                              onClick={() => handleSave(ord.id)}
                              className="min-h-[40px] px-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-1 cursor-pointer"
                            >
                              <Check className="w-3.5 h-3.5" />
                              <span>Confirm Replace</span>
                            </button>
                            <button
                              onClick={() => setEditingOrderId(null)}
                              className="min-h-[40px] px-3 rounded-lg bg-zinc-800 text-zinc-400 hover:text-zinc-200 text-xs flex items-center gap-1 cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                              <span>Cancel</span>
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => startEdit(ord)}
                            className="min-h-[40px] px-3 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs flex items-center gap-1 cursor-pointer transition-colors"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                            <span>Replace</span>
                          </button>
                          <button
                            onClick={() => cancelOrder(ord.id)}
                            className="min-h-[40px] px-3 py-1 rounded-lg bg-rose-950/60 hover:bg-rose-900 border border-rose-800/60 text-rose-300 text-xs flex items-center gap-1 cursor-pointer transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Cancel Order</span>
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {orders.length === 0 && (
              <div className="p-8 text-center text-xs text-zinc-500 font-sans">
                No orders placed yet.
              </div>
            )}
          </>
        )}

        {/* LEDGER */}
        {subTab === 'ledger' && (
          <>
            {ledger.map((entry) => {
              const isCredit = entry.amount >= 0;
              return (
                <div
                  key={entry.id}
                  className="p-3 rounded-xl bg-zinc-900/60 border border-zinc-800/80 flex flex-col gap-1 font-mono text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-zinc-300">{entry.type}</span>
                    <span
                      className={`font-bold ${
                        isCredit ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {isCredit ? '+' : ''}${entry.amount.toFixed(2)}
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-400 font-sans leading-tight">
                    {entry.description}
                  </p>
                  <div className="flex items-center justify-between text-[10px] text-zinc-400 pt-1 border-t border-zinc-800/40">
                    <span>Balance: ${entry.balanceAfter.toFixed(2)}</span>
                    <span>{new Date(entry.createdAt).toLocaleTimeString()}</span>
                  </div>
                </div>
              );
            })}

            {ledger.length === 0 && (
              <div className="p-8 text-center text-xs text-zinc-500 font-sans">
                No ledger transactions recorded.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
