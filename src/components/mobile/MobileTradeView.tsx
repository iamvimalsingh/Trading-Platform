/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * MOBILE TRADE VIEW (T3A / UI POLISH 1.0)
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
  Minus,
  Plus,
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
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

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

  const isStale = Boolean(quote?.marketStatus === 'STALE' || (quote as any)?.isStale);
  const isUnavailable = quote?.marketStatus === 'UNAVAILABLE';
  const isWaiting = !quote || quote?.marketStatus === 'WAITING_FOR_PROVIDER';
  const isLive = Boolean(quote && quote.marketStatus === 'LIVE' && !isStale && !isUnavailable);
  const isMarketExecutable = isLive;

  const hasEnoughMargin = requiredMargin <= account.freeMargin;

  const handleExecute = async (side: OrderSide) => {
    if (isSubmitting) return;

    if (!symbolCfg) {
      setLastNotification({ type: 'ERROR', message: 'No symbol config available' });
      return;
    }

    if (orderType === 'MARKET') {
      if (!quote || isWaiting) {
        setLastNotification({ type: 'ERROR', message: `Awaiting live quote for ${selectedSymbol}…` });
        return;
      }
      if (isStale) {
        setLastNotification({ type: 'ERROR', message: 'Waiting for fresh market quote…' });
        return;
      }
      if (isUnavailable) {
        setLastNotification({ type: 'ERROR', message: 'Market data unavailable' });
        return;
      }
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

    try {
      setIsSubmitting(true);
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
          ? `Placed ${orderType} ${side} ${volume.toFixed(2)}L ${selectedSymbol} @ ${result.order.requestedPrice.toFixed(symbolCfg.digits)}`
          : `Filled ${side} ${volume.toFixed(2)}L ${selectedSymbol} @ ${result.order.executionPrice.toFixed(symbolCfg.digits)}`;

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
    } finally {
      setIsSubmitting(false);
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
    <div className="flex flex-col h-full bg-white dark:bg-zinc-950 p-4 select-none overflow-y-auto transition-colors text-slate-800 dark:text-zinc-100">
      {/* Symbol Picker & Top Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-zinc-800/80 mb-3 relative">
        <div className="relative">
          <button
            onClick={() => setSymbolPickerOpen(!isSymbolPickerOpen)}
            className="flex items-center gap-2 py-1.5 px-3 rounded-xl bg-slate-100 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-800 text-left min-h-[44px] cursor-pointer"
          >
            <div className="flex flex-col">
              <span className="font-bold text-sm text-slate-900 dark:text-zinc-100 font-mono tracking-tight flex items-center gap-1">
                {selectedSymbol}
                <ChevronDown className="w-4 h-4 text-slate-400 dark:text-zinc-400" />
              </span>
              <span className="text-[10px] text-slate-500 dark:text-zinc-400 leading-none font-sans font-medium">
                {symbolCfg?.name || 'Instrument'}
              </span>
            </div>
          </button>

          {/* Symbol Switcher Dropdown */}
          {isSymbolPickerOpen && (
            <div className="absolute top-14 left-0 w-64 max-h-72 overflow-y-auto bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl shadow-2xl z-40 p-1 divide-y divide-slate-100 dark:divide-zinc-800/40">
              {activeSymbolList.map((s) => (
                <button
                  key={s.symbol}
                  onClick={() => {
                    setSelectedSymbol(s.symbol);
                    setSymbolPickerOpen(false);
                  }}
                  className={`w-full px-3 py-2.5 text-left flex items-center justify-between text-xs rounded-lg transition-colors cursor-pointer min-h-[44px] ${
                    selectedSymbol === s.symbol
                      ? 'bg-blue-50 dark:bg-blue-600/30 text-blue-600 dark:text-blue-300 font-bold'
                      : 'hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-700 dark:text-zinc-300'
                  }`}
                >
                  <div className="flex flex-col">
                    <span className="font-mono font-bold">{s.symbol}</span>
                    <span className="text-[10px] text-slate-400 dark:text-zinc-500 font-sans">{s.name}</span>
                  </div>
                  <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-slate-100 dark:bg-zinc-800 text-slate-500 dark:text-zinc-400">
                    {s.category}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Live Mid & Spread */}
        {quote && (
          <div className="flex flex-col items-end font-mono">
            <span className="font-bold text-sm text-slate-900 dark:text-zinc-100">
              {quote.mid.toFixed(symbolCfg?.digits || 2)}
            </span>
            <span className="text-[10px] text-slate-400 dark:text-zinc-500 font-sans">
              Spread: {quote.spread}
            </span>
          </div>
        )}
      </div>

      {/* Order Type Tabs */}
      <div className="grid grid-cols-3 gap-1 bg-slate-100 dark:bg-zinc-900 p-1 rounded-xl border border-slate-200 dark:border-zinc-800 mb-3">
        {(['MARKET', 'LIMIT', 'STOP'] as OrderType[]).map((t) => (
          <button
            key={t}
            onClick={() => setOrderType(t)}
            className={`min-h-[40px] py-1.5 text-xs font-bold rounded-lg font-mono transition-colors cursor-pointer flex items-center justify-center ${
              orderType === t
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Execution Notification Banner */}
      {lastNotification && (
        <div
          className={`mb-3 p-3 rounded-xl text-xs flex items-center gap-2 font-mono ${
            lastNotification.type === 'SUCCESS'
              ? 'bg-emerald-50 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800/60'
              : 'bg-rose-50 dark:bg-rose-950/80 text-rose-800 dark:text-rose-300 border border-rose-300 dark:border-rose-800/60'
          }`}
        >
          {lastNotification.type === 'SUCCESS' ? (
            <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <ShieldAlert className="w-5 h-5 shrink-0 text-rose-600 dark:text-rose-400" />
          )}
          <span className="text-xs leading-tight font-sans">{lastNotification.message}</span>
        </div>
      )}

      {/* Missing / Stale / Unavailable Market Quote Warnings */}
      {isStale && (
        <div className="mb-3 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800/60 text-amber-800 dark:text-amber-300 text-xs flex items-center gap-2 font-sans font-medium">
          <Clock className="w-5 h-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <span className="text-xs leading-tight">Waiting for fresh market quote…</span>
        </div>
      )}

      {isUnavailable && (
        <div className="mb-3 p-3 rounded-xl bg-slate-100 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-800 text-slate-700 dark:text-zinc-300 text-xs flex items-center gap-2 font-sans font-medium">
          <ShieldAlert className="w-5 h-5 shrink-0 text-slate-500" />
          <span className="text-xs leading-tight">Market data unavailable</span>
        </div>
      )}

      {isWaiting && !isStale && !isUnavailable && (
        <div className="mb-3 p-3 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/40 text-blue-800 dark:text-blue-300 text-xs flex items-center gap-2 font-sans">
          <Clock className="w-5 h-5 shrink-0 text-blue-500" />
          <span className="text-xs leading-tight">Awaiting live quote for {selectedSymbol}…</span>
        </div>
      )}

      {/* Live Big Buy / Sell Quote Buttons */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        {/* SELL BUTTON */}
        <button
          onClick={() => handleExecute('SELL')}
          disabled={(orderType === 'MARKET' && !isMarketExecutable) || isSubmitting}
          className="min-h-[72px] flex flex-col items-center justify-center p-3 rounded-2xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/50 dark:hover:bg-rose-900/60 active:scale-[0.98] border-2 border-rose-300 dark:border-rose-800/80 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-xs"
        >
          <div className="flex items-center gap-1 text-rose-600 dark:text-rose-400 text-xs font-bold uppercase tracking-wider mb-1">
            <ArrowDown className="w-4 h-4" />
            <span>SELL {orderType !== 'MARKET' ? orderType : ''}</span>
          </div>
          <span className="font-mono text-lg font-bold text-rose-700 dark:text-zinc-100">
            {orderType === 'MARKET'
              ? (isLive ? quote!.bid.toFixed(symbolCfg?.digits || 2) : quote ? `${quote.bid.toFixed(symbolCfg?.digits || 2)}` : '—')
              : (requestedPrice || '—')}
          </span>
        </button>

        {/* BUY BUTTON */}
        <button
          onClick={() => handleExecute('BUY')}
          disabled={(orderType === 'MARKET' && !isMarketExecutable) || isSubmitting}
          className="min-h-[72px] flex flex-col items-center justify-center p-3 rounded-2xl bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:hover:bg-emerald-900/60 active:scale-[0.98] border-2 border-emerald-300 dark:border-emerald-800/80 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-xs"
        >
          <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 text-xs font-bold uppercase tracking-wider mb-1">
            <ArrowUp className="w-4 h-4" />
            <span>BUY {orderType !== 'MARKET' ? orderType : ''}</span>
          </div>
          <span className="font-mono text-lg font-bold text-emerald-700 dark:text-zinc-100">
            {orderType === 'MARKET'
              ? (isLive ? quote!.ask.toFixed(symbolCfg?.digits || 2) : quote ? `${quote.ask.toFixed(symbolCfg?.digits || 2)}` : '—')
              : (requestedPrice || '—')}
          </span>
        </button>
      </div>

      {/* LIMIT / STOP Requested Price Field */}
      {orderType !== 'MARKET' && (
        <div className="flex flex-col gap-2 mb-4 p-3 rounded-xl bg-slate-50 dark:bg-zinc-900/80 border border-slate-200 dark:border-blue-900/50">
          <div className="flex items-center justify-between text-xs font-sans">
            <span className="text-slate-700 dark:text-zinc-200 font-semibold flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span>{orderType} Target Price</span>
            </span>
            <span className="text-[11px] text-slate-400 dark:text-zinc-400 font-mono">
              Mid: {quote ? quote.mid.toFixed(symbolCfg?.digits || 2) : '—'}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => adjustPrice(-10)}
              className="px-3 min-h-[44px] rounded-lg bg-white dark:bg-zinc-800 hover:bg-slate-100 dark:hover:bg-zinc-700 border border-slate-300 dark:border-zinc-700 text-slate-700 dark:text-zinc-200 font-mono text-xs font-bold flex items-center justify-center cursor-pointer"
            >
              -10
            </button>
            <input
              type="number"
              step="any"
              placeholder="Target Price"
              value={requestedPrice}
              onChange={(e) => setRequestedPrice(e.target.value)}
              className="flex-1 bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 focus:border-blue-500 text-center rounded-lg min-h-[44px] text-sm font-mono text-slate-900 dark:text-zinc-100 font-bold outline-none"
            />
            <button
              onClick={() => adjustPrice(10)}
              className="px-3 min-h-[44px] rounded-lg bg-white dark:bg-zinc-800 hover:bg-slate-100 dark:hover:bg-zinc-700 border border-slate-300 dark:border-zinc-700 text-slate-700 dark:text-zinc-200 font-mono text-xs font-bold flex items-center justify-center cursor-pointer"
            >
              +10
            </button>
          </div>
        </div>
      )}

      {/* Volume Stepper & Presets */}
      <div className="flex flex-col gap-2 mb-4">
        <div className="flex items-center justify-between text-xs font-sans">
          <span className="text-slate-600 dark:text-zinc-400 font-medium">Trade Size (Lots)</span>
          <span className="text-[11px] text-slate-400 dark:text-zinc-500 font-mono">
            {symbolCfg?.minVolume} - {symbolCfg?.maxVolume} Lots
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => adjustVolume(-0.01)}
            className="w-11 h-11 rounded-xl bg-slate-100 dark:bg-zinc-900 hover:bg-slate-200 dark:hover:bg-zinc-800 border border-slate-300 dark:border-zinc-800 text-slate-700 dark:text-zinc-200 flex items-center justify-center cursor-pointer active:scale-95 transition-transform"
            aria-label="Decrease volume"
          >
            <Minus className="w-4 h-4" />
          </button>
          <input
            type="number"
            step="0.01"
            min={symbolCfg?.minVolume || 0.01}
            max={symbolCfg?.maxVolume || 100}
            value={volume}
            onChange={(e) => setVolume(parseFloat(e.target.value) || 0.01)}
            className="flex-1 bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-800 focus:border-blue-500 text-center rounded-xl min-h-[44px] text-base font-mono text-slate-900 dark:text-zinc-100 font-bold outline-none"
          />
          <button
            onClick={() => adjustVolume(+0.01)}
            className="w-11 h-11 rounded-xl bg-slate-100 dark:bg-zinc-900 hover:bg-slate-200 dark:hover:bg-zinc-800 border border-slate-300 dark:border-zinc-800 text-slate-700 dark:text-zinc-200 flex items-center justify-center cursor-pointer active:scale-95 transition-transform"
            aria-label="Increase volume"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {/* Quick Presets */}
        <div className="grid grid-cols-5 gap-1.5 pt-1">
          {[0.01, 0.05, 0.10, 0.50, 1.00].map((val) => (
            <button
              key={val}
              onClick={() => setVolume(val)}
              className={`min-h-[36px] rounded-lg text-xs font-mono border transition-colors cursor-pointer flex items-center justify-center ${
                volume === val
                  ? 'bg-blue-600 text-white font-bold border-blue-600'
                  : 'bg-slate-100 dark:bg-zinc-900 border-slate-200 dark:border-zinc-800 text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200'
              }`}
            >
              {val}
            </button>
          ))}
        </div>
      </div>

      {/* Margin Requirement Banner */}
      <div className="p-3 rounded-xl bg-slate-50 dark:bg-zinc-900/60 border border-slate-200 dark:border-zinc-800/80 mb-4 flex items-center justify-between text-xs font-mono">
        <span className="text-slate-500 dark:text-zinc-400 font-sans font-medium">Required Margin:</span>
        <span className={`font-bold ${hasEnoughMargin ? 'text-slate-900 dark:text-zinc-200' : 'text-rose-600 dark:text-rose-400'}`}>
          ${requiredMargin.toFixed(2)} (Free: ${account.freeMargin.toFixed(2)})
        </span>
      </div>

      {/* Optional Stop Loss & Take Profit Toggles */}
      <div className="flex flex-col gap-3 pt-3 border-t border-slate-200 dark:border-zinc-800/80">
        {/* SL */}
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="mobileUseSL"
            checked={useSL}
            onChange={(e) => setUseSL(e.target.checked)}
            className="w-4 h-4 rounded border-slate-300 dark:border-zinc-700 text-blue-600 focus:ring-0 cursor-pointer"
          />
          <label htmlFor="mobileUseSL" className="text-xs text-slate-600 dark:text-zinc-400 cursor-pointer select-none font-sans font-medium min-w-[70px]">
            Stop Loss
          </label>
          {useSL && (
            <input
              type="number"
              step="any"
              placeholder={quote ? quote.bid.toString() : 'SL Price'}
              value={stopLoss}
              onChange={(e) => setStopLoss(e.target.value)}
              className="flex-1 bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-800 focus:border-rose-500 rounded-lg px-2.5 min-h-[38px] text-xs font-mono text-slate-900 dark:text-zinc-200 outline-none"
            />
          )}
        </div>

        {/* TP */}
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="mobileUseTP"
            checked={useTP}
            onChange={(e) => setUseTP(e.target.checked)}
            className="w-4 h-4 rounded border-slate-300 dark:border-zinc-700 text-blue-600 focus:ring-0 cursor-pointer"
          />
          <label htmlFor="mobileUseTP" className="text-xs text-slate-600 dark:text-zinc-400 cursor-pointer select-none font-sans font-medium min-w-[70px]">
            Take Profit
          </label>
          {useTP && (
            <input
              type="number"
              step="any"
              placeholder={quote ? quote.ask.toString() : 'TP Price'}
              value={takeProfit}
              onChange={(e) => setTakeProfit(e.target.value)}
              className="flex-1 bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-800 focus:border-emerald-500 rounded-lg px-2.5 min-h-[38px] text-xs font-mono text-slate-900 dark:text-zinc-200 outline-none"
            />
          )}
        </div>
      </div>
    </div>
  );
};
