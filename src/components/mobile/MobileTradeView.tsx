/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * MOBILE TRADE VIEW (T3A)
 * Touch-optimized execution ticket with MARKET, LIMIT, and STOP support,
 * big 50px+ Buy/Sell quote buttons, volume stepper, and SL/TP configuration.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  Clock,
  ShieldAlert,
} from 'lucide-react';
import { OrderSide, OrderType } from '../../types/trading';
import { useTradingStore } from '../../store/useTradingStore';
import { calculateRequiredMargin } from '../../services/riskEngine';

export const MobileTradeView: React.FC = () => {
  const selectedSymbol = useTradingStore((state) => state.selectedSymbol);
  const setSelectedSymbol = useTradingStore((state) => state.setSelectedSymbol);
  const activeSymbolList = useTradingStore((state) => state.activeSymbolList);
  const symbolCfg = useTradingStore((state) => state.symbols[selectedSymbol]);
  const quote = useTradingStore((state) => state.quotes[selectedSymbol]);
  const account = useTradingStore((state) => state.account);
  const placeOrder = useTradingStore((state) => state.placeOrder);

  const [orderType, setOrderType] = useState<OrderType>('MARKET');
  const [volume, setVolume] = useState<number>(0.10);
  const [requestedPrice, setRequestedPrice] = useState<string>('');
  const [useSL, setUseSL] = useState<boolean>(false);
  const [stopLoss, setStopLoss] = useState<string>('');
  const [useTP, setUseTP] = useState<boolean>(false);
  const [takeProfit, setTakeProfit] = useState<string>('');
  const [isSymbolPickerOpen, setSymbolPickerOpen] = useState<boolean>(false);

  const [lastNotification, setLastNotification] = useState<{
    type: 'SUCCESS' | 'ERROR';
    message: string;
  } | null>(null);

  const prevSymbolRef = useRef(selectedSymbol);
  const prevTypeRef = useRef(orderType);

  // Sync default price for LIMIT/STOP
  useEffect(() => {
    const symbolChanged = prevSymbolRef.current !== selectedSymbol;
    const typeChanged = prevTypeRef.current !== orderType;
    prevSymbolRef.current = selectedSymbol;
    prevTypeRef.current = orderType;

    if (orderType !== 'MARKET' && (typeChanged || symbolChanged)) {
      if (quote) {
        setRequestedPrice(quote.mid.toFixed(symbolCfg?.digits || 2));
      }
    }
  }, [orderType, selectedSymbol, quote, symbolCfg?.digits]);

  // Live required margin preview
  const pricingForMargin = useMemo(() => {
    if (orderType === 'MARKET') return quote?.mid || 0;
    const parsed = parseFloat(requestedPrice);
    return !isNaN(parsed) && parsed > 0 ? parsed : (quote?.mid || 0);
  }, [orderType, requestedPrice, quote?.mid]);

  const requiredMargin = useMemo(() => {
    if (!symbolCfg || pricingForMargin <= 0) return 0;
    return calculateRequiredMargin(
      volume,
      pricingForMargin,
      symbolCfg,
      account.leverage,
      account.currency
    );
  }, [volume, pricingForMargin, symbolCfg, account.leverage, account.currency]);

  const hasEnoughMargin = requiredMargin <= account.freeMargin;

  const handleExecute = async (side: OrderSide) => {
    if (!symbolCfg) {
      setLastNotification({ type: 'ERROR', message: 'No symbol config available' });
      return;
    }

    if (orderType === 'MARKET' && !quote) {
      setLastNotification({ type: 'ERROR', message: 'No live quote available' });
      return;
    }

    let parsedPrice: number | undefined;
    if (orderType !== 'MARKET') {
      parsedPrice = parseFloat(requestedPrice);
      if (isNaN(parsedPrice) || parsedPrice <= 0) {
        setLastNotification({
          type: 'ERROR',
          message: `Please specify a valid price for ${orderType} order`,
        });
        return;
      }
    }

    if (volume < symbolCfg.minVolume || volume > symbolCfg.maxVolume) {
      setLastNotification({
        type: 'ERROR',
        message: `Volume must be between ${symbolCfg.minVolume} and ${symbolCfg.maxVolume} Lots`,
      });
      return;
    }

    if (!hasEnoughMargin) {
      setLastNotification({
        type: 'ERROR',
        message: `Insufficient margin ($${requiredMargin.toFixed(2)} required, $${account.freeMargin.toFixed(2)} available)`,
      });
      return;
    }

    const slVal = useSL && stopLoss.trim() !== '' ? parseFloat(stopLoss) : undefined;
    const tpVal = useTP && takeProfit.trim() !== '' ? parseFloat(takeProfit) : undefined;

    const result = await placeOrder({
      symbol: selectedSymbol,
      side,
      type: orderType,
      volume,
      requestedPrice: parsedPrice,
      stopLoss: slVal,
      takeProfit: tpVal,
    });

    if (result.success) {
      const isWorking = result.order.status === 'WORKING';
      const msg = isWorking
        ? `Placed ${orderType} ${side} ${volume} ${selectedSymbol} @ ${result.order.requestedPrice}`
        : `Filled ${side} ${volume} ${selectedSymbol} @ ${result.order.executionPrice}`;

      setLastNotification({
        type: 'SUCCESS',
        message: msg,
      });
      setTimeout(() => setLastNotification(null), 5000);
    } else {
      setLastNotification({
        type: 'ERROR',
        message: result.error || 'Order rejected by risk engine',
      });
    }
  };

  const adjustVolume = (delta: number) => {
    setVolume((prev) => {
      const next = Math.max(
        symbolCfg?.minVolume || 0.01,
        Math.min(symbolCfg?.maxVolume || 100, Number((prev + delta).toFixed(2)))
      );
      return next;
    });
  };

  const adjustPrice = (deltaSteps: number) => {
    const digits = symbolCfg?.digits || 2;
    const step = 1 / Math.pow(10, digits);
    const current = parseFloat(requestedPrice) || (quote?.mid || 0);
    const next = Math.max(0, current + deltaSteps * step);
    setRequestedPrice(next.toFixed(digits));
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950 p-4 select-none overflow-y-auto">
      {/* Symbol Picker & Top Header */}
      <div className="flex items-center justify-between pb-3 border-b border-zinc-800/80 mb-3 relative">
        <div className="relative">
          <button
            onClick={() => setSymbolPickerOpen(!isSymbolPickerOpen)}
            className="flex items-center gap-2 py-1.5 px-3 rounded-xl bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-left min-h-[44px] cursor-pointer"
          >
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-sm text-zinc-100 font-mono">
                  {selectedSymbol}
                </span>
                <ChevronDown className="w-4 h-4 text-zinc-400" />
              </div>
              <span className="text-[10px] text-zinc-400">{symbolCfg?.name || 'Instrument'}</span>
            </div>
          </button>

          {isSymbolPickerOpen && (
            <div className="absolute top-14 left-0 w-60 max-h-72 overflow-y-auto bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl z-40 p-1 divide-y divide-zinc-800/50">
              {activeSymbolList.map((s) => (
                <button
                  key={s.symbol}
                  onClick={() => {
                    setSelectedSymbol(s.symbol);
                    setSymbolPickerOpen(false);
                  }}
                  className={`w-full px-3 py-2.5 text-left flex items-center justify-between text-xs rounded-lg min-h-[44px] cursor-pointer ${
                    selectedSymbol === s.symbol
                      ? 'bg-blue-600/30 text-blue-300 font-bold'
                      : 'hover:bg-zinc-800 text-zinc-300'
                  }`}
                >
                  <span className="font-mono">{s.symbol}</span>
                  <span className="text-[10px] text-zinc-400">{s.category}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col items-end text-xs font-mono">
          <span className="text-[10px] uppercase text-zinc-400">Free Margin</span>
          <span className="font-bold text-zinc-200">
            ${account.freeMargin.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      </div>

      {/* Order Type Tabs (44px touch targets) */}
      <div className="grid grid-cols-3 gap-1 bg-zinc-900 p-1 rounded-xl border border-zinc-800 mb-3 shrink-0">
        {(['MARKET', 'LIMIT', 'STOP'] as OrderType[]).map((t) => (
          <button
            key={t}
            onClick={() => setOrderType(t)}
            className={`min-h-[40px] text-xs font-bold rounded-lg font-mono transition-colors cursor-pointer flex items-center justify-center ${
              orderType === t
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Execution Feedback Banner */}
      {lastNotification && (
        <div
          className={`mb-3 p-3 rounded-xl text-xs flex items-center gap-2 font-mono ${
            lastNotification.type === 'SUCCESS'
              ? 'bg-emerald-950/90 text-emerald-300 border border-emerald-800/60'
              : 'bg-rose-950/90 text-rose-300 border border-rose-800/60'
          }`}
        >
          {lastNotification.type === 'SUCCESS' ? (
            <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-400" />
          ) : (
            <ShieldAlert className="w-5 h-5 shrink-0 text-rose-400" />
          )}
          <span className="text-xs leading-snug">{lastNotification.message}</span>
        </div>
      )}

      {/* Missing Market Quote Warning Banner */}
      {!quote && (
        <div className="mb-3 p-2.5 rounded-xl bg-amber-950/30 border border-amber-800/40 text-amber-300 text-xs flex items-center gap-2 font-sans">
          <ShieldAlert className="w-4 h-4 shrink-0 text-amber-400" />
          <span className="text-xs leading-snug">No live market quote available for {selectedSymbol}. Market orders are disabled.</span>
        </div>
      )}

      {/* Large Live Execution Quote Buttons (Min 56px height) */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        {/* SELL BUTTON */}
        <button
          onClick={() => handleExecute('SELL')}
          disabled={orderType === 'MARKET' && !quote}
          className="flex flex-col items-center justify-center min-h-[64px] p-3 rounded-2xl bg-rose-950/50 hover:bg-rose-900/60 active:bg-rose-800/80 border border-rose-800/70 active:scale-[0.98] transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <div className="flex items-center gap-1.5 text-rose-400 text-xs font-bold uppercase tracking-wider mb-0.5">
            <ArrowDown className="w-4 h-4" />
            <span>SELL {orderType !== 'MARKET' ? orderType : ''}</span>
          </div>
          <span className="font-mono text-lg font-bold text-zinc-100">
            {orderType === 'MARKET'
              ? (quote ? quote.bid.toFixed(symbolCfg?.digits || 2) : '—')
              : (requestedPrice || '—')}
          </span>
          <span className="text-[10px] text-zinc-400 font-sans">
            {orderType === 'MARKET' ? 'Market Bid' : 'Trigger Bid'}
          </span>
        </button>

        {/* BUY BUTTON */}
        <button
          onClick={() => handleExecute('BUY')}
          disabled={orderType === 'MARKET' && !quote}
          className="flex flex-col items-center justify-center min-h-[64px] p-3 rounded-2xl bg-emerald-950/50 hover:bg-emerald-900/60 active:bg-emerald-800/80 border border-emerald-800/70 active:scale-[0.98] transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <div className="flex items-center gap-1.5 text-emerald-400 text-xs font-bold uppercase tracking-wider mb-0.5">
            <ArrowUp className="w-4 h-4" />
            <span>BUY {orderType !== 'MARKET' ? orderType : ''}</span>
          </div>
          <span className="font-mono text-lg font-bold text-zinc-100">
            {orderType === 'MARKET'
              ? (quote ? quote.ask.toFixed(symbolCfg?.digits || 2) : '—')
              : (requestedPrice || '—')}
          </span>
          <span className="text-[10px] text-zinc-400 font-sans">
            {orderType === 'MARKET' ? 'Market Ask' : 'Trigger Ask'}
          </span>
        </button>
      </div>

      {/* LIMIT / STOP Requested Price Input */}
      {orderType !== 'MARKET' && (
        <div className="flex flex-col gap-2 mb-4 p-3 rounded-xl bg-zinc-900/70 border border-blue-900/40">
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-200 font-bold flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-blue-400" />
              <span>Target {orderType} Price</span>
            </span>
            <span className="text-[11px] text-zinc-400 font-mono">
              Live: {quote ? quote.mid.toFixed(symbolCfg?.digits || 2) : '—'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => adjustPrice(-10)}
              className="w-12 h-12 rounded-xl bg-zinc-900 hover:bg-zinc-800 active:bg-zinc-700 border border-zinc-800 text-zinc-200 font-mono text-xs font-bold flex items-center justify-center cursor-pointer"
            >
              -10
            </button>
            <input
              type="number"
              step="any"
              placeholder="Price"
              value={requestedPrice}
              onChange={(e) => setRequestedPrice(e.target.value)}
              className="flex-1 min-h-[48px] bg-zinc-900 border border-zinc-800 focus:border-blue-500 text-center rounded-xl text-base font-mono text-zinc-100 font-bold outline-none"
            />
            <button
              onClick={() => adjustPrice(10)}
              className="w-12 h-12 rounded-xl bg-zinc-900 hover:bg-zinc-800 active:bg-zinc-700 border border-zinc-800 text-zinc-200 font-mono text-xs font-bold flex items-center justify-center cursor-pointer"
            >
              +10
            </button>
          </div>
        </div>
      )}

      {/* Volume Stepper & Quick Presets */}
      <div className="flex flex-col gap-2 mb-4 p-3 rounded-xl bg-zinc-900/60 border border-zinc-800/80">
        <div className="flex items-center justify-between text-xs">
          <span className="text-zinc-300 font-medium">Trading Volume (Lots)</span>
          <span className="text-[10px] text-zinc-400 font-mono">
            Min: {symbolCfg?.minVolume} | Max: {symbolCfg?.maxVolume}
          </span>
        </div>

        {/* Stepper with 48px touch targets */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => adjustVolume(-0.01)}
            className="w-12 h-12 rounded-xl bg-zinc-900 hover:bg-zinc-800 active:bg-zinc-700 border border-zinc-800 text-zinc-200 font-mono text-lg font-bold flex items-center justify-center cursor-pointer transition-colors"
          >
            -
          </button>
          <input
            type="number"
            step="0.01"
            min={symbolCfg?.minVolume || 0.01}
            max={symbolCfg?.maxVolume || 100}
            value={volume}
            onChange={(e) => setVolume(parseFloat(e.target.value) || 0.01)}
            className="flex-1 min-h-[48px] bg-zinc-900 border border-zinc-800 focus:border-blue-500 text-center rounded-xl text-base font-mono text-zinc-100 font-bold outline-none"
          />
          <button
            onClick={() => adjustVolume(+0.01)}
            className="w-12 h-12 rounded-xl bg-zinc-900 hover:bg-zinc-800 active:bg-zinc-700 border border-zinc-800 text-zinc-200 font-mono text-lg font-bold flex items-center justify-center cursor-pointer transition-colors"
          >
            +
          </button>
        </div>

        {/* Quick Presets (40px touch target) */}
        <div className="grid grid-cols-5 gap-1.5 pt-1">
          {[0.01, 0.05, 0.10, 0.50, 1.00].map((val) => (
            <button
              key={val}
              onClick={() => setVolume(val)}
              className={`min-h-[40px] py-1 rounded-lg text-xs font-mono border transition-colors cursor-pointer flex items-center justify-center ${
                volume === val
                  ? 'bg-blue-600 text-white font-bold border-blue-500 shadow-sm'
                  : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {val}
            </button>
          ))}
        </div>
      </div>

      {/* Margin Requirement Summary */}
      <div className="p-3 rounded-xl bg-zinc-900/60 border border-zinc-800/80 mb-4 flex items-center justify-between text-xs font-mono">
        <span className="text-zinc-400">Required Margin:</span>
        <span className={`text-sm font-bold ${hasEnoughMargin ? 'text-zinc-200' : 'text-rose-400'}`}>
          ${requiredMargin.toFixed(2)}
        </span>
      </div>

      {/* Stop Loss & Take Profit Toggles */}
      <div className="flex flex-col gap-3 p-3 rounded-xl bg-zinc-900/40 border border-zinc-800/80">
        <span className="text-xs font-semibold text-zinc-300">Risk Management (Optional)</span>

        {/* Stop Loss */}
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer min-h-[44px]">
            <input
              type="checkbox"
              checked={useSL}
              onChange={(e) => setUseSL(e.target.checked)}
              className="w-5 h-5 rounded bg-zinc-900 border-zinc-700 text-blue-600 focus:ring-0 cursor-pointer"
            />
            <span className="text-xs text-zinc-300 font-medium">Stop Loss</span>
          </label>
          {useSL && (
            <input
              type="number"
              step="any"
              placeholder={quote ? quote.bid.toString() : 'Price'}
              value={stopLoss}
              onChange={(e) => setStopLoss(e.target.value)}
              className="flex-1 min-h-[44px] bg-zinc-900 border border-zinc-800 focus:border-rose-500 rounded-xl px-3 py-2 text-xs font-mono text-zinc-100 outline-none"
            />
          )}
        </div>

        {/* Take Profit */}
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer min-h-[44px]">
            <input
              type="checkbox"
              checked={useTP}
              onChange={(e) => setUseTP(e.target.checked)}
              className="w-5 h-5 rounded bg-zinc-900 border-zinc-700 text-blue-600 focus:ring-0 cursor-pointer"
            />
            <span className="text-xs text-zinc-300 font-medium">Take Profit</span>
          </label>
          {useTP && (
            <input
              type="number"
              step="any"
              placeholder={quote ? quote.ask.toString() : 'Price'}
              value={takeProfit}
              onChange={(e) => setTakeProfit(e.target.value)}
              className="flex-1 min-h-[44px] bg-zinc-900 border border-zinc-800 focus:border-emerald-500 rounded-xl px-3 py-2 text-xs font-mono text-zinc-100 outline-none"
            />
          )}
        </div>
      </div>
    </div>
  );
};
