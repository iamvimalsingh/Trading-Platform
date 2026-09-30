/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * TRADING TERMINAL STORE (ZUSTAND)
 * Consumes authoritative server WebSocket events while maintaining sub-millisecond local UI reactivity.
 */

import { create } from 'zustand';
import {
  CancelOrderRequest,
  Execution,
  LedgerEntry,
  Order,
  OrderRequest,
  OrderResult,
  Position,
  Quote,
  ReplaceOrderRequest,
  SymbolConfig,
  TradingAccount,
} from '../types/trading';
import { SocketStatus, tradingSocket } from '../services/tradingSocket';
import { ReplaceOrderPayload, SessionReadyPayload } from '../../server/src/ws/wsProtocol';
import { ALL_SYMBOLS, INITIAL_SYMBOLS } from '../../server/src/market/MarketEngine';

const INITIAL_ACCOUNT: TradingAccount = {
  id: 'acc_demo_1001',
  tenantId: 'tenant_default',
  accountNumber: 'DEMO-1001',
  currency: 'USD',
  accountType: 'DEMO',
  leverage: 100,
  balance: 10000.00,
  equity: 10000.00,
  usedMargin: 0.00,
  freeMargin: 10000.00,
  marginLevel: 0,
  marginCallLevel: 100,
  stopOutLevel: 50,
  status: 'ACTIVE',
};

export interface TradingState {
  // Connection State
  socketStatus: SocketStatus;

  // Authoritative Account State
  account: TradingAccount;
  ledger: LedgerEntry[];

  // Authoritative Market State
  symbols: Record<string, SymbolConfig>;
  activeSymbolList: SymbolConfig[];
  selectedSymbol: string;
  quotes: Record<string, Quote>;

  // Authoritative Execution & Position State
  positions: Position[];
  orders: Order[];
  executions: Execution[];
  closedTrades: Position[];

  // Performance Spike & Benchmark State
  activeSymbolCount: 10 | 25 | 50;
  ticksReceivedCount: number;
  lastTickTime: number;
  fps: number;
  componentRenderCounts: Record<string, number>;

  // UI State
  activeTab: 'positions' | 'orders' | 'history' | 'benchmark';
  mobileTab: 'quotes' | 'chart' | 'trade' | 'positions' | 'history';
  isMobileAccountDrawerOpen: boolean;
  isPerfLabOpen: boolean;

  // Actions
  setSocketStatus: (status: SocketStatus) => void;
  initSessionFromSocket: (data: SessionReadyPayload) => void;
  setSelectedSymbol: (symbol: string) => void;
  setActiveSymbolCount: (count: 10 | 25 | 50) => void;
  updateQuotesBatch: (batch: Record<string, Quote>) => void;
  setAccountState: (account: TradingAccount) => void;
  updatePosition: (position: Position) => void;
  handlePositionClosed: (position: Position, ledgerEntry: LedgerEntry) => void;
  handleOrderAck: (result: OrderResult) => void;
  handleOrderUpdate: (order: Order) => void;
  recordExecution: (execution: Execution) => void;

  // Commands dispatched to Server
  placeOrder: (request: Omit<OrderRequest, 'accountId'>) => Promise<OrderResult>;
  cancelOrder: (orderId: string) => Promise<boolean>;
  replaceOrder: (payload: ReplaceOrderPayload) => Promise<OrderResult>;
  closePosition: (positionId: string) => void;
  updatePositionSLTP: (positionId: string, stopLoss?: number, takeProfit?: number) => void;

  // UI Actions
  setActiveTab: (tab: 'positions' | 'orders' | 'history' | 'benchmark') => void;
  setMobileTab: (tab: 'quotes' | 'chart' | 'trade' | 'positions' | 'history') => void;
  setMobileAccountDrawerOpen: (open: boolean) => void;
  toggleMobileAccountDrawer: () => void;
  togglePerfLab: () => void;
  recordComponentRender: (name: string) => void;
  updateFps: (fps: number) => void;
  resetAccount: () => void;
}

export const useTradingStore = create<TradingState>((set, get) => {
  const initialSymbolsMap: Record<string, SymbolConfig> = {};
  for (const s of ALL_SYMBOLS) {
    initialSymbolsMap[s.symbol] = s;
  }

  return {
    socketStatus: 'DISCONNECTED',

    account: INITIAL_ACCOUNT,
    ledger: [
      {
        id: 'led_init_1',
        accountId: INITIAL_ACCOUNT.id,
        type: 'DEPOSIT',
        amount: 10000.00,
        balanceAfter: 10000.00,
        description: 'Initial Demo Balance Credited',
        createdAt: Date.now() - 3600000,
      },
    ],

    symbols: initialSymbolsMap,
    activeSymbolList: INITIAL_SYMBOLS,
    selectedSymbol: 'EURUSD',
    quotes: {},

    positions: [],
    orders: [],
    executions: [],
    closedTrades: [],

    activeSymbolCount: 10,
    ticksReceivedCount: 0,
    lastTickTime: Date.now(),
    fps: 60,
    componentRenderCounts: {},

    activeTab: 'positions',
    mobileTab: 'quotes',
    isMobileAccountDrawerOpen: false,
    isPerfLabOpen: false,

    setSocketStatus: (socketStatus) => set({ socketStatus }),

    initSessionFromSocket: (data) => {
      const symbolsMap: Record<string, SymbolConfig> = {};
      for (const s of data.symbols) {
        symbolsMap[s.symbol] = s;
      }

      set({
        account: data.account,
        symbols: symbolsMap,
        activeSymbolList: data.symbols.slice(0, get().activeSymbolCount),
        positions: data.positions.filter((p) => p.status === 'OPEN'),
        closedTrades: data.positions.filter((p) => p.status === 'CLOSED'),
        orders: data.orders,
        executions: data.executions || [],
        ledger: data.ledger.length > 0 ? data.ledger : get().ledger,
      });
    },

    setSelectedSymbol: (symbol: string) => {
      set({ selectedSymbol: symbol });
      // Ensure selected symbol is subscribed on server
      tradingSocket.subscribeSymbols([symbol]);
    },

    setActiveSymbolCount: (count: 10 | 25 | 50) => {
      const targetSymbols = ALL_SYMBOLS.slice(0, count);
      set({
        activeSymbolCount: count,
        activeSymbolList: targetSymbols,
      });
      // Subscribe to active set on server
      tradingSocket.subscribeSymbols(targetSymbols.map((s) => s.symbol));
    },

    updateQuotesBatch: (batch: Record<string, Quote>) => {
      set((state) => {
        const nextQuotes = { ...state.quotes, ...batch };
        return {
          quotes: nextQuotes,
          ticksReceivedCount: state.ticksReceivedCount + Object.keys(batch).length,
          lastTickTime: Date.now(),
        };
      });
    },

    setAccountState: (account: TradingAccount) => {
      set({ account });
    },

    updatePosition: (position: Position) => {
      set((state) => {
        const index = state.positions.findIndex((p) => p.id === position.id);
        let nextPositions: Position[];
        if (index >= 0) {
          nextPositions = [...state.positions];
          nextPositions[index] = position;
        } else {
          nextPositions = [position, ...state.positions];
        }
        return { positions: nextPositions };
      });
    },

    handlePositionClosed: (position: Position, ledgerEntry: LedgerEntry) => {
      set((state) => ({
        positions: state.positions.filter((p) => p.id !== position.id),
        closedTrades: [position, ...state.closedTrades],
        ledger: [ledgerEntry, ...state.ledger],
      }));
    },

    handleOrderAck: (result: OrderResult) => {
      set((state) => {
        const existingIdx = state.orders.findIndex((o) => o.id === result.order.id);
        const nextOrders = existingIdx >= 0
          ? state.orders.map((o) => (o.id === result.order.id ? result.order : o))
          : [result.order, ...state.orders];

        let nextPositions = state.positions;
        if (result.success && result.position) {
          if (!nextPositions.some((p) => p.id === result.position!.id)) {
            nextPositions = [result.position, ...nextPositions];
          }
        }

        return {
          orders: nextOrders,
          positions: nextPositions,
        };
      });
    },

    handleOrderUpdate: (order: Order) => {
      set((state) => {
        const existingIdx = state.orders.findIndex((o) => o.id === order.id);
        const nextOrders = existingIdx >= 0
          ? state.orders.map((o) => (o.id === order.id ? order : o))
          : [order, ...state.orders];
        return { orders: nextOrders };
      });
    },

    recordExecution: (execution: Execution) => {
      set((state) => ({
        executions: [execution, ...state.executions.filter((e) => e.id !== execution.id)],
      }));
    },

    // Commands to Authoritative Server
    placeOrder: async (request) => {
      try {
        const result = await tradingSocket.placeOrder({
          symbol: request.symbol,
          side: request.side,
          type: request.type,
          volume: request.volume,
          requestedPrice: request.requestedPrice,
          stopLoss: request.stopLoss,
          takeProfit: request.takeProfit,
          clientOrderId: request.clientOrderId,
        });
        get().handleOrderAck(result);
        return result;
      } catch (err: any) {
        const fallbackOrder: Order = {
          id: `err_${Date.now()}`,
          clientOrderId: `err_${Date.now()}`,
          accountId: get().account.id,
          symbol: request.symbol,
          side: request.side,
          type: request.type,
          volume: request.volume,
          requestedPrice: request.requestedPrice || 0,
          executionPrice: 0,
          status: 'REJECTED',
          rejectReason: err?.message || 'Server error',
          createdAt: Date.now(),
        };
        const errorResult: OrderResult = {
          success: false,
          order: fallbackOrder,
          error: err?.message || 'Execution failed',
        };
        get().handleOrderAck(errorResult);
        return errorResult;
      }
    },

    cancelOrder: async (orderId: string) => {
      try {
        const res = await tradingSocket.cancelOrder(orderId);
        if (res.order) {
          get().handleOrderUpdate(res.order);
        }
        return true;
      } catch {
        return false;
      }
    },

    replaceOrder: async (payload: ReplaceOrderPayload) => {
      try {
        const res = await tradingSocket.replaceOrder(payload);
        if (res.order) {
          get().handleOrderAck(res);
        }
        return res;
      } catch (err: any) {
        return {
          success: false,
          order: null as any,
          error: err?.message || 'Replace order failed',
        };
      }
    },

    closePosition: (positionId: string) => {
      tradingSocket.closePosition(positionId);
    },

    updatePositionSLTP: (positionId: string, stopLoss?: number, takeProfit?: number) => {
      // Optimistic visual update
      set((prev) => ({
        positions: prev.positions.map((p) => {
          if (p.id !== positionId) return p;
          return { ...p, stopLoss, takeProfit };
        }),
      }));
      // Authoritative update on server
      tradingSocket.modifyPosition(positionId, stopLoss, takeProfit);
    },

    setActiveTab: (tab) => set({ activeTab: tab }),

    setMobileTab: (tab) => set({ mobileTab: tab }),

    setMobileAccountDrawerOpen: (open) => set({ isMobileAccountDrawerOpen: open }),

    toggleMobileAccountDrawer: () => set((prev) => ({ isMobileAccountDrawerOpen: !prev.isMobileAccountDrawerOpen })),

    togglePerfLab: () => set((prev) => ({ isPerfLabOpen: !prev.isPerfLabOpen })),

    recordComponentRender: (name: string) => {
      set((prev) => ({
        componentRenderCounts: {
          ...prev.componentRenderCounts,
          [name]: (prev.componentRenderCounts[name] || 0) + 1,
        },
      }));
    },

    updateFps: (fps: number) => set({ fps }),

    resetAccount: () => {
      // Re-initialize session to reset state
      tradingSocket.connect();
    },
  };
});
