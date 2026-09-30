/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * ADMIN & RUNTIME INSPECTION SERIALIZERS
 * Sanitized data transformers ensuring internal WebSocket and memory pointers are not leaked.
 */

import { ClientSessionSummary } from '../runtime/ClientRegistry';
import { TradingRuntime } from '../runtime/TradingRuntime';
import { Order, Position, Quote, SymbolConfig, TradingAccount } from '../types/trading';

export function serializeRuntimeStats(runtime: TradingRuntime) {
  return runtime.getRuntimeStats();
}

export function serializeClientSessions(runtime: TradingRuntime): ClientSessionSummary[] {
  return runtime.clients.getClientSummaries();
}

export function serializeAccounts(runtime: TradingRuntime): TradingAccount[] {
  return runtime.accounts.getAllAccounts();
}

export function serializeAccountDetail(runtime: TradingRuntime, accountIdOrNumber: string) {
  const account = runtime.accounts.getAccount(accountIdOrNumber);
  if (!account) return null;

  const positions = runtime.positions.getPositionsForAccount(account.id);
  const orders = runtime.orders.getOrdersForAccount(account.id);
  const ledger = runtime.accounts.getLedger(account.id);

  return {
    account,
    positions,
    orders,
    ledger,
  };
}

export function serializeOrders(runtime: TradingRuntime): Order[] {
  return runtime.orders.getAllOrders();
}

export function serializePositions(runtime: TradingRuntime): {
  open: Position[];
  totalOpen: number;
} {
  const open = runtime.positions.getAllOpenPositions();
  return {
    open,
    totalOpen: open.length,
  };
}

export function serializeMarket(runtime: TradingRuntime) {
  const activeSymbols = runtime.market.getActiveSymbols();
  const quotes = runtime.market.getAllQuotes();
  const subscriberSummary = runtime.clients.getSubscribedSymbolsSummary();
  const metrics = runtime.market.getMetrics();

  const symbolsInfo = activeSymbols.map((s) => ({
    symbol: s.symbol,
    name: s.name,
    category: s.category,
    digits: s.digits,
    quote: quotes[s.symbol] || null,
    subscribersCount: subscriberSummary[s.symbol] || 0,
  }));

  return {
    metrics,
    symbols: symbolsInfo,
  };
}
