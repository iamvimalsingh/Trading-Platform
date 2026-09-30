/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * DESKTOP ORDER TICKET (T3A)
 * Supports MARKET, LIMIT, and STOP execution with pre-trade margin calculations,
 * volume steppers, and risk management (SL/TP).
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, CheckCircle2, Clock, ShieldAlert } from 'lucide-react';
import { OrderSide, OrderType } from '../../types/trading';
import { useTradingStore } from '../../store/useTradingStore';
import { calculateRequiredMargin } from '../../services/riskEngine';

export const OrderTicket: React.FC = () => {
  const selectedSymbol = useTradingStore((state) => state.selectedSymbol);
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

  const [lastNotification, setLastNotification] = useState<{
    type: 'SUCCESS' | 'ERROR';
    message: string;
  } | null>(null);

  const prevSymbolRef = useRef(selectedSymbol);
  const prevTypeRef = useRef(orderType);

  // Sync default price when switching symbol or non-market order type
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

  // Calculate live margin preview
  const pricingForMargin = useMemo(() => {
    if (orderType === 'MARKET') {
      return quote?.mid || 0;
    }
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
      setLastNotification({ type: 'ERROR', message: 'Unknown instrument config' });
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
        message: `Volume must be between ${symbolCfg.minVolume} and ${symbolCfg.maxVolume}`,
      });
      return;
    }

    if (!hasEnoughMargin) {
      setLastNotification({
        type: 'ERROR',
        message: `Insufficient Free Margin ($${requiredMargin.toFixed(2)} required, $${account.freeMargin.toFixed(2)} available)`,
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
      setTimeout(() => setLastNotification(null), 4000);
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
    <div className="flex flex-col h-full bg-zinc-950 p-3 select-none overflow-y-auto">
      {/* Header & Order Type Switcher */}
      <div className="flex items-center justify-between pb-2 border-b border-zinc-800/80 mb-2">
        <span className="text-xs font-semibold text-zinc-200 uppercase tracking-wider">
          Order Ticket
        </span>
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-900 text-blue-400 border border-zinc-800">
          {orderType} ORDER
        </span>
      </div>

      {/* Type Selector Tabs */}
      <div className="grid grid-cols-3 gap-1 bg-zinc-900/80 p-1 rounded-lg border border-zinc-800 mb-3">
        {(['MARKET', 'LIMIT', 'STOP'] as OrderType[]).map((t) => (
          <button
            key={t}
            onClick={() => setOrderType(t)}
            className={`py-1 text-xs font-semibold rounded font-mono transition-colors cursor-pointer ${
              orderType === t
                ? 'bg-blue-600 text-white shadow'
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
          className={`mb-3 p-2 rounded text-xs flex items-center gap-2 font-mono ${
            lastNotification.type === 'SUCCESS'
              ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/50'
              : 'bg-rose-950/80 text-rose-300 border border-rose-800/50'
          }`}
        >
          {lastNotification.type === 'SUCCESS' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
          ) : (
            <ShieldAlert className="w-4 h-4 shrink-0 text-rose-400" />
          )}
          <span className="text-[11px] leading-tight">{lastNotification.message}</span>
        </div>
      )}

      {/* Missing Market Quote Warning Banner */}
      {!quote && (
        <div className="mb-3 p-2 rounded bg-amber-950/30 border border-amber-800/40 text-amber-300 text-xs flex items-center gap-2 font-sans">
          <ShieldAlert className="w-4 h-4 shrink-0 text-amber-400" />
          <span className="text-[11px] leading-tight">No live market quote available for {selectedSymbol}. Market orders are disabled.</span>
        </div>
      )}

      {/* Live Big Buy / Sell Quote Buttons */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        {/* SELL BUTTON */}
        <button
          onClick={() => handleExecute('SELL')}
          disabled={orderType === 'MARKET' && !quote}
          className="flex flex-col items-center justify-center p-2.5 rounded bg-rose-950/40 hover:bg-rose-900/50 border border-rose-800/60 active:scale-[0.98] transition-all cursor-pointer group disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <div className="flex items-center gap-1 text-rose-400 text-xs font-bold uppercase tracking-wider mb-0.5">
            <ArrowDown className="w-3.5 h-3.5 group-hover:translate-y-0.5 transition-transform" />
            <span>SELL {orderType !== 'MARKET' ? orderType : ''}</span>
          </div>
          <span className="font-mono text-base font-bold text-zinc-100">
            {orderType === 'MARKET'
              ? (quote ? quote.bid.toFixed(symbolCfg?.digits || 2) : '—')
              : (requestedPrice || '—')}
          </span>
          <span className="text-[9px] text-zinc-500 font-sans mt-0.5">
            {orderType === 'MARKET' ? 'Market Bid' : 'Trigger Bid'}
          </span>
        </button>

        {/* BUY BUTTON */}
        <button
          onClick={() => handleExecute('BUY')}
          disabled={orderType === 'MARKET' && !quote}
          className="flex flex-col items-center justify-center p-2.5 rounded bg-emerald-950/40 hover:bg-emerald-900/50 border border-emerald-800/60 active:scale-[0.98] transition-all cursor-pointer group disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <div className="flex items-center gap-1 text-emerald-400 text-xs font-bold uppercase tracking-wider mb-0.5">
            <ArrowUp className="w-3.5 h-3.5 group-hover:-translate-y-0.5 transition-transform" />
            <span>BUY {orderType !== 'MARKET' ? orderType : ''}</span>
          </div>
          <span className="font-mono text-base font-bold text-zinc-100">
            {orderType === 'MARKET'
              ? (quote ? quote.ask.toFixed(symbolCfg?.digits || 2) : '—')
              : (requestedPrice || '—')}
          </span>
          <span className="text-[9px] text-zinc-500 font-sans mt-0.5">
            {orderType === 'MARKET' ? 'Market Ask' : 'Trigger Ask'}
          </span>
        </button>
      </div>

      {/* LIMIT / STOP Requested Price Field */}
      {orderType !== 'MARKET' && (
        <div className="flex flex-col gap-1.5 mb-3 p-2.5 rounded bg-zinc-900/70 border border-blue-900/40">
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-300 font-semibold flex items-center gap-1">
              <Clock className="w-3 h-3 text-blue-400" />
              <span>{orderType} Price</span>
            </span>
            <span className="text-[10px] text-zinc-400 font-mono">
              Market: {quote ? quote.mid.toFixed(symbolCfg?.digits || 2) : '—'}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => adjustPrice(-10)}
              className="px-2 h-7 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 font-mono text-xs font-bold flex items-center justify-center cursor-pointer"
            >
              -10
            </button>
            <input
              type="number"
              step="any"
              placeholder="Price"
              value={requestedPrice}
              onChange={(e) => setRequestedPrice(e.target.value)}
              className="flex-1 bg-zinc-900 border border-zinc-800 focus:border-blue-500 text-center rounded py-1 text-xs font-mono text-zinc-100 font-semibold outline-none"
            />
            <button
              onClick={() => adjustPrice(10)}
              className="px-2 h-7 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 font-mono text-xs font-bold flex items-center justify-center cursor-pointer"
            >
              +10
            </button>
          </div>

          <div className="text-[10px] text-zinc-500 italic mt-0.5">
            {orderType === 'LIMIT'
              ? 'Buy fills when Ask ≤ Price; Sell fills when Bid ≥ Price.'
              : 'Buy fills when Ask ≥ Price; Sell fills when Bid ≤ Price.'}
          </div>
        </div>
      )}

      {/* Volume Stepper & Presets */}
      <div className="flex flex-col gap-1.5 mb-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-zinc-400 font-medium">Volume (Lots)</span>
          <span className="text-[10px] text-zinc-500 font-mono">
            Min: {symbolCfg?.minVolume} | Max: {symbolCfg?.maxVolume}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => adjustVolume(-0.01)}
            className="w-8 h-8 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 font-mono text-sm font-bold flex items-center justify-center cursor-pointer"
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
            className="flex-1 bg-zinc-900 border border-zinc-800 focus:border-blue-500 text-center rounded py-1 text-sm font-mono text-zinc-100 font-semibold outline-none"
          />
          <button
            onClick={() => adjustVolume(+0.01)}
            className="w-8 h-8 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 font-mono text-sm font-bold flex items-center justify-center cursor-pointer"
          >
            +
          </button>
        </div>

        {/* Quick Presets */}
        <div className="grid grid-cols-5 gap-1 pt-1">
          {[0.01, 0.05, 0.10, 0.50, 1.00].map((val) => (
            <button
              key={val}
              onClick={() => setVolume(val)}
              className={`py-0.5 rounded text-[10px] font-mono border transition-colors cursor-pointer ${
                volume === val
                  ? 'bg-blue-600/30 border-blue-500 text-blue-300 font-bold'
                  : 'bg-zinc-900 border-zinc-800/80 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {val}
            </button>
          ))}
        </div>
      </div>

      {/* Margin Requirement Summary */}
      <div className="p-2 rounded bg-zinc-900/60 border border-zinc-800/80 mb-3 flex items-center justify-between text-xs font-mono">
        <span className="text-zinc-400">Required Margin:</span>
        <span className={`font-semibold ${hasEnoughMargin ? 'text-zinc-200' : 'text-rose-400 font-bold'}`}>
          ${requiredMargin.toFixed(2)}
        </span>
      </div>

      {/* Optional Stop Loss & Take Profit Toggles */}
      <div className="flex flex-col gap-2 pt-1 border-t border-zinc-900">
        {/* SL */}
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="useSL"
            checked={useSL}
            onChange={(e) => setUseSL(e.target.checked)}
            className="rounded bg-zinc-900 border-zinc-700 text-blue-600 focus:ring-0 cursor-pointer"
          />
          <label htmlFor="useSL" className="text-xs text-zinc-400 cursor-pointer select-none">
            Stop Loss
          </label>
          {useSL && (
            <input
              type="number"
              step="any"
              placeholder={quote ? quote.bid.toString() : 'Price'}
              value={stopLoss}
              onChange={(e) => setStopLoss(e.target.value)}
              className="flex-1 bg-zinc-900 border border-zinc-800 focus:border-rose-500 rounded px-2 py-0.5 text-xs font-mono text-zinc-200 outline-none"
            />
          )}
        </div>

        {/* TP */}
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="useTP"
            checked={useTP}
            onChange={(e) => setUseTP(e.target.checked)}
            className="rounded bg-zinc-900 border-zinc-700 text-blue-600 focus:ring-0 cursor-pointer"
          />
          <label htmlFor="useTP" className="text-xs text-zinc-400 cursor-pointer select-none">
            Take Profit
          </label>
          {useTP && (
            <input
              type="number"
              step="any"
              placeholder={quote ? quote.ask.toString() : 'Price'}
              value={takeProfit}
              onChange={(e) => setTakeProfit(e.target.value)}
              className="flex-1 bg-zinc-900 border border-zinc-800 focus:border-emerald-500 rounded px-2 py-0.5 text-xs font-mono text-zinc-200 outline-none"
            />
          )}
        </div>
      </div>
    </div>
  );
};
