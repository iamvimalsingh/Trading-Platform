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
import { SocketStatus, tradingSocket, getInitialAccount, onLaunchTokenDetected, extractLaunchToken } from '../services/tradingSocket';
import { ReplaceOrderPayload, SessionReadyPayload, ErrorPayload } from '../types/wsProtocol';
import { ALL_SYMBOLS, INITIAL_SYMBOLS } from '../constants/symbols';

export type SessionAuthState =
  | 'INITIALIZING'
  | 'DEMO'
  | 'EXTERNAL_PENDING'
  | 'EXTERNAL_AUTHENTICATED'
  | 'EXTERNAL_ERROR'
  | 'EXTERNAL_EXPIRED';

export interface TradingState {
  // Connection & Session State
  socketStatus: SocketStatus;
  sessionAuthState: SessionAuthState;
  sessionAuthError: string | null;

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
  activeSymbolCount: number;
  ticksReceivedCount: number;
  lastTickTime: number;
  fps: number;
  componentRenderCounts: Record<string, number>;

  // UI State
  theme: 'light' | 'dark';
  activeTab: 'positions' | 'orders' | 'history' | 'benchmark';
  mobileTab: 'quotes' | 'chart' | 'trade' | 'positions' | 'history';
  isMobileAccountDrawerOpen: boolean;
  isPerfLabOpen: boolean;

  // Actions
  setSocketStatus: (status: SocketStatus) => void;
  setSessionAuthState: (state: SessionAuthState) => void;
  handleServerError: (err: ErrorPayload) => void;
  initSessionFromSocket: (data: SessionReadyPayload) => void;
  setSelectedSymbol: (symbol: string) => void;
  setActiveSymbolCount: (count: number) => void;
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
  setTheme: (theme: 'light' | 'dark') => void;
  toggleTheme: () => void;
  setActiveTab: (tab: 'positions' | 'orders' | 'history' | 'benchmark') => void;
  setMobileTab: (tab: 'quotes' | 'chart' | 'trade' | 'positions' | 'history') => void;
  setMobileAccountDrawerOpen: (open: boolean) => void;
  toggleMobileAccountDrawer: () => void;
  togglePerfLab: () => void;
  recordComponentRender: (name: string) => void;
  updateFps: (fps: number) => void;
  resetAccount: () => void;
}

const getInitialTheme = (): 'light' | 'dark' => {
  if (typeof localStorage !== 'undefined' || typeof window !== 'undefined') {
    try {
      if (typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem('trading_terminal_theme');
        if (saved === 'dark' || saved === 'light') {
          return saved;
        }
      }
    } catch {
      // Storage unavailable
    }
  }
  return 'light';
};

export const useTradingStore = create<TradingState>((set, get) => {
  const initialSymbolsMap: Record<string, SymbolConfig> = {};
  for (const s of ALL_SYMBOLS) {
    initialSymbolsMap[s.symbol] = s;
  }

  const initialTheme = getInitialTheme();
  const initialAccountContext = getInitialAccount();

  return {
    socketStatus: 'DISCONNECTED',
    sessionAuthState: initialAccountContext.isExternal ? 'EXTERNAL_PENDING' : 'DEMO',
    sessionAuthError: null,

    account: initialAccountContext.account,
    ledger: initialAccountContext.ledger,

    symbols: initialSymbolsMap,
    activeSymbolList: INITIAL_SYMBOLS,
    selectedSymbol: 'EURUSD',
    quotes: {},

    positions: [],
    orders: [],
    executions: [],
    closedTrades: [],

    activeSymbolCount: 18,
    ticksReceivedCount: 0,
    lastTickTime: Date.now(),
    fps: 60,
    componentRenderCounts: {},

    theme: initialTheme,
    activeTab: 'positions',
    mobileTab: 'quotes',
    isMobileAccountDrawerOpen: false,
    isPerfLabOpen: false,

    setSocketStatus: (socketStatus) => set({ socketStatus }),

    setSessionAuthState: (sessionAuthState) => set({ sessionAuthState }),

    handleServerError: (err: ErrorPayload) => {
      const isExpired = err.code === 'SESSION_EXPIRED';
      const isUnauthorized = err.code === 'UNAUTHORIZED' || err.code === 'MISSING_CREDENTIAL';
      const isNotProvisioned = err.code === 'ACCOUNT_NOT_PROVISIONED';

      set((state) => {
        let nextAuthState = state.sessionAuthState;
        let errorMessage = err.message || 'Server error';

        if (isExpired) {
          nextAuthState = 'EXTERNAL_EXPIRED';
          errorMessage = err.message || 'CRM Launch Session Expired. Please relaunch from your CRM Client Panel.';
        } else if (isNotProvisioned) {
          nextAuthState = 'EXTERNAL_ERROR';
          errorMessage = err.message || 'Trading account has not been provisioned by broker management.';
        } else if (isUnauthorized) {
          nextAuthState = 'EXTERNAL_ERROR';
          errorMessage = err.message || 'CRM Launch Authentication Failed. Invalid or unverified launch token.';
        } else if (state.account.sessionMode === 'EXTERNAL' && state.sessionAuthState === 'EXTERNAL_PENDING') {
          nextAuthState = 'EXTERNAL_ERROR';
          errorMessage = err.message || 'Failed to establish external trading session.';
        }

        return {
          sessionAuthState: nextAuthState,
          sessionAuthError: errorMessage,
        };
      });
    },

    initSessionFromSocket: (data) => {
      const symbolsMap: Record<string, SymbolConfig> = {};
      for (const s of data.symbols) {
        symbolsMap[s.symbol] = s;
      }

      set({
        sessionAuthState: data.account.sessionMode === 'EXTERNAL' ? 'EXTERNAL_AUTHENTICATED' : 'DEMO',
        sessionAuthError: null,
        account: data.account,
        symbols: symbolsMap,
        activeSymbolList: data.symbols,
        positions: data.positions.filter((p) => p.status === 'OPEN'),
        closedTrades: data.positions.filter((p) => p.status === 'CLOSED'),
        orders: data.orders,
        executions: data.executions || [],
        ledger: data.ledger,
      });

      // Ensure all active platform symbols are subscribed on server
      tradingSocket.subscribeSymbols(data.symbols.map((s) => s.symbol));
    },

    setSelectedSymbol: (symbol: string) => {
      set({ selectedSymbol: symbol });
      // Ensure selected symbol is subscribed on server
      tradingSocket.subscribeSymbols([symbol]);
    },

    setActiveSymbolCount: (count: number) => {
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

    setTheme: (theme: 'light' | 'dark') => {
      if (typeof localStorage !== 'undefined' || typeof window !== 'undefined') {
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem('trading_terminal_theme', theme);
          }
          if (typeof document !== 'undefined' && document.documentElement) {
            document.documentElement.setAttribute('data-theme', theme);
            if (theme === 'dark') {
              document.documentElement.classList.add('dark');
              if (document.body) document.body.classList.add('dark');
            } else {
              document.documentElement.classList.remove('dark');
              if (document.body) document.body.classList.remove('dark');
            }
          }
        } catch {
          // Storage unavailable
        }
      }
      set({ theme });
    },

    toggleTheme: () => {
      const nextTheme = get().theme === 'dark' ? 'light' : 'dark';
      get().setTheme(nextTheme);
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
      // In external CRM mode, resetting demo balance is prohibited; re-verify session with server
      if (get().account.sessionMode === 'EXTERNAL' || get().sessionAuthState.startsWith('EXTERNAL')) {
        set({ sessionAuthState: 'EXTERNAL_PENDING', sessionAuthError: null });
        const token = extractLaunchToken();
        if (token) {
          tradingSocket.reinitializeSession(token);
        } else {
          tradingSocket.connect();
        }
        return;
      }
      tradingSocket.connect();
    },
  };
});

// Reactively bind external account state if a launch token is detected at runtime
if (typeof window !== 'undefined') {
  onLaunchTokenDetected((_token, claims) => {
    if (claims && claims.accountNumber) {
      useTradingStore.getState().setSessionAuthState('EXTERNAL_PENDING');
      const current = useTradingStore.getState().account;
      if (current.accountNumber !== String(claims.accountNumber) || current.sessionMode !== 'EXTERNAL') {
        const bal = typeof claims.balance === 'number'
          ? claims.balance
          : (typeof claims.initialBalance === 'number' ? claims.initialBalance : 0.00);
        useTradingStore.getState().setAccountState({
          id: claims.accountId || `acc_ext_${claims.accountNumber}`,
          tenantId: claims.tenantId || 'tenant_default',
          clientId: claims.sub,
          accountNumber: String(claims.accountNumber),
          platform: (claims.platform as any) || 'MT5',
          currency: claims.currency || 'USD',
          accountType: (claims.accountType as any) || 'LIVE',
          sessionMode: 'EXTERNAL',
          leverage: claims.leverage || 100,
          balance: bal,
          equity: bal,
          usedMargin: 0.00,
          freeMargin: bal,
          marginLevel: 0,
          marginCallLevel: 100,
          stopOutLevel: 50,
          status: 'ACTIVE',
          tradingEnabled: true,
        });
      }
    }
  });
}
