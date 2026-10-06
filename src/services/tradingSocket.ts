/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * CLIENT TRADING WEBSOCKET ADAPTER
 * Manages connection, auto-reconnection, typed command dispatch, and server event streaming.
 */

import {
  AccountStatePayload,
  CancelOrderPayload,
  ClosePositionPayload,
  ErrorPayload,
  ModifyPositionPayload,
  ExecutionPayload,
  OrderAckPayload,
  OrderUpdatePayload,
  PlaceOrderPayload,
  PositionClosedPayload,
  PositionUpdatePayload,
  QuotePayload,
  ReplaceOrderPayload,
  SessionInitPayload,
  SessionReadyPayload,
  WsEnvelope,
} from '../types/wsProtocol';
import { Execution, LedgerEntry, OrderResult, Quote, TradingAccount } from '../types/trading';

export type SocketStatus = 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED';

export interface LaunchTokenClaims {
  sub?: string;
  userId?: string;
  clientId?: string;
  accountId?: string;
  accountNumber?: string;
  tenantId?: string;
  platform?: string;
  currency?: string;
  accountType?: 'DEMO' | 'LIVE';
  leverage?: number;
  balance?: number;
  initialBalance?: number;
  exp?: number;
  iat?: number;
}

export function parseLaunchTokenClaims(token?: string | null): LaunchTokenClaims | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.trim().split('.');
  if (parts.length !== 3) return null;
  try {
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    let jsonStr: string;
    if (typeof atob !== 'undefined') {
      jsonStr = decodeURIComponent(
        atob(b64)
          .split('')
          .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
    } else if (typeof Buffer !== 'undefined') {
      jsonStr = Buffer.from(b64, 'base64').toString('utf8');
    } else {
      return null;
    }
    const raw = JSON.parse(jsonStr);
    const sub = raw.sub || raw.userId || raw.user_id || raw.clientId || raw.client_id;
    const accountId = raw.accountId || raw.account_id || raw.accountNumber || raw.account_number;
    const accountNumber = raw.accountNumber || raw.account_number || raw.accountId || raw.account_id;
    if (!accountNumber) return null;
    return {
      sub: sub ? String(sub) : undefined,
      accountId: accountId ? String(accountId) : undefined,
      accountNumber: String(accountNumber),
      tenantId: raw.tenantId || raw.tenant_id || 'tenant_default',
      platform: raw.platform || 'MT5',
      currency: raw.currency || 'USD',
      accountType: raw.accountType || raw.account_type || 'LIVE',
      leverage: raw.leverage ? Number(raw.leverage) : 100,
      balance: typeof raw.balance === 'number'
        ? raw.balance
        : typeof raw.initialBalance === 'number'
        ? raw.initialBalance
        : typeof raw.initial_balance === 'number'
        ? raw.initial_balance
        : (raw.balance !== undefined && raw.balance !== null && !isNaN(Number(raw.balance)))
        ? Number(raw.balance)
        : (raw.initialBalance !== undefined && raw.initialBalance !== null && !isNaN(Number(raw.initialBalance)))
        ? Number(raw.initialBalance)
        : undefined,
      initialBalance: typeof raw.initialBalance === 'number'
        ? raw.initialBalance
        : typeof raw.initial_balance === 'number'
        ? raw.initial_balance
        : typeof raw.balance === 'number'
        ? raw.balance
        : (raw.initialBalance !== undefined && raw.initialBalance !== null && !isNaN(Number(raw.initialBalance)))
        ? Number(raw.initialBalance)
        : (raw.balance !== undefined && raw.balance !== null && !isNaN(Number(raw.balance)))
        ? Number(raw.balance)
        : undefined,
      exp: raw.exp,
      iat: raw.iat,
    };
  } catch {
    return null;
  }
}

type TokenCallback = (token: string, claims: LaunchTokenClaims) => void;
const tokenListeners = new Set<TokenCallback>();

export function onLaunchTokenDetected(callback: TokenCallback): () => void {
  tokenListeners.add(callback);
  return () => tokenListeners.delete(callback);
}

let inMemoryLaunchToken: string | null = null;

export function setLaunchToken(token: string): void {
  if (!token || typeof token !== 'string') return;
  const trimmed = token.trim();
  if (trimmed.split('.').length !== 3) return;
  inMemoryLaunchToken = trimmed;
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem('trading_terminal_launch_token', trimmed);
    }
  } catch {
    // Storage access denied in sandboxed/cross-origin iframe
  }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('trading_terminal_launch_token', trimmed);
    }
  } catch {
    // Storage access denied in sandboxed/cross-origin iframe
  }
  const claims = parseLaunchTokenClaims(trimmed);
  if (claims) {
    if (tradingSocket) {
      tradingSocket.clearAuthFailure();
    }
    for (const listener of tokenListeners) {
      try {
        listener(trimmed, claims);
      } catch {
        // ignore listener errors
      }
    }
  }
}

export function getInitialAccount(): { account: TradingAccount; ledger: LedgerEntry[]; isExternal: boolean } {
  const token = extractLaunchToken();
  const claims = parseLaunchTokenClaims(token);

  if (claims && claims.accountNumber) {
    const bal = typeof claims.balance === 'number'
      ? claims.balance
      : typeof claims.initialBalance === 'number'
      ? claims.initialBalance
      : 0.00;
    const externalAccount: TradingAccount = {
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
    };

    return {
      account: externalAccount,
      ledger: [],
      isExternal: true,
    };
  }

  // Standalone DEMO fallback
  return {
    account: {
      id: 'acc_demo_1001',
      tenantId: 'tenant_default',
      accountNumber: 'DEMO-1001',
      platform: 'PROPRIETARY',
      currency: 'USD',
      accountType: 'DEMO',
      sessionMode: 'DEMO',
      leverage: 100,
      balance: 10000.00,
      equity: 10000.00,
      usedMargin: 0.00,
      freeMargin: 10000.00,
      marginLevel: 0,
      marginCallLevel: 100,
      stopOutLevel: 50,
      status: 'ACTIVE',
      tradingEnabled: true,
    },
    ledger: [
      {
        id: 'led_init_1',
        accountId: 'acc_demo_1001',
        type: 'DEPOSIT',
        amount: 10000.00,
        balanceAfter: 10000.00,
        description: 'Initial Demo Balance Credited',
        createdAt: Date.now() - 3600000,
      },
    ],
    isExternal: false,
  };
}

/**
 * Resolves and normalizes the target WebSocket URL for the trading client.
 * Priority:
 * 1. Explicitly configured build/runtime environment variable (VITE_WS_URL).
 * 2. Same-origin fallback (${protocol}//${host}/ws).
 */
export function resolveWebSocketUrl(
  envWsUrl?: string,
  locationObj?: { protocol: string; host: string }
): string {
  let wsUrl = '';
  const envVal = envWsUrl?.trim();
  if (envVal) {
    let normalized = envVal;
    // Normalize http(s) protocols to ws(s)
    if (normalized.startsWith('http://')) {
      normalized = 'ws://' + normalized.slice(7);
    } else if (normalized.startsWith('https://')) {
      normalized = 'wss://' + normalized.slice(8);
    } else if (!normalized.startsWith('ws://') && !normalized.startsWith('wss://')) {
      // Missing protocol prefix, default to wss://
      normalized = 'wss://' + normalized;
    }

    // Strip trailing slash
    if (normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1);
    }

    // Ensure path ends with /ws without creating double /ws/ws
    if (!normalized.endsWith('/ws')) {
      normalized = `${normalized}/ws`;
    }

    wsUrl = normalized;
  } else {
    // Fallback to same-origin host
    const loc = locationObj || (typeof window !== 'undefined' ? window.location : { protocol: 'http:', host: 'localhost:3000' });
    const protocol = loc.protocol === 'https:' ? 'wss:' : 'ws:';
    wsUrl = `${protocol}//${loc.host}/ws`;
  }

  // Pass launch token directly on connection handshake if available
  const token = extractLaunchToken();
  if (token) {
    const sep = wsUrl.includes('?') ? '&' : '?';
    wsUrl = `${wsUrl}${sep}token=${encodeURIComponent(token)}`;
  }

  return wsUrl;
}

/**
 * Safely extracts launch token from URL query parameter, URL hash,
 * in-memory cache, or sessionStorage.
 * Storage errors in cross-origin iframes will never prevent token return.
 */
export function extractLaunchToken(): string | null {
  if (inMemoryLaunchToken) {
    return inMemoryLaunchToken;
  }

  if (typeof window === 'undefined') return null;

  // 1. Check URL query parameters (all standard CRM parameter names)
  try {
    const params = new URLSearchParams(window.location.search);
    const candidateKeys = ['token', 'launchToken', 'launch_token', 'ssoToken', 'sso_token', 'sso', 'jwt', 'authToken', 'auth_token'];
    for (const key of candidateKeys) {
      const val = params.get(key)?.trim();
      if (val && val.split('.').length === 3) {
        setLaunchToken(val);
        return val;
      }
    }
  } catch {
    // ignore
  }

  // 2. Check URL hash (e.g. #token=... or #launchToken=...)
  try {
    if (window.location.hash) {
      const hashStr = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
      const hashParams = new URLSearchParams(hashStr);
      const candidateKeys = ['token', 'launchToken', 'launch_token', 'ssoToken', 'sso_token', 'sso', 'jwt', 'authToken'];
      for (const key of candidateKeys) {
        const val = hashParams.get(key)?.trim();
        if (val && val.split('.').length === 3) {
          setLaunchToken(val);
          return val;
        }
      }
    }
  } catch {
    // ignore
  }

  // 3. Check sessionStorage safely
  try {
    if (typeof sessionStorage !== 'undefined') {
      const saved = sessionStorage.getItem('trading_terminal_launch_token')?.trim();
      if (saved && saved.split('.').length === 3) {
        inMemoryLaunchToken = saved;
        return inMemoryLaunchToken;
      }
    }
  } catch {
    // ignore
  }

  // 4. Check localStorage safely
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('trading_terminal_launch_token')?.trim();
      if (saved && saved.split('.').length === 3) {
        inMemoryLaunchToken = saved;
        return inMemoryLaunchToken;
      }
    }
  } catch {
    // ignore
  }

  return inMemoryLaunchToken;
}

// Global listener for CRM parent window postMessage (for iframe integration)
if (typeof window !== 'undefined') {
  window.addEventListener('message', (event) => {
    try {
      const data = event.data;
      if (!data) return;
      let incomingToken: string | undefined;
      if (typeof data === 'string' && data.trim().split('.').length === 3) {
        incomingToken = data.trim();
      } else if (typeof data === 'object') {
        const candidate = data.token || data.launchToken || data.ssoToken || data.jwt || data.payload?.token;
        if (typeof candidate === 'string' && candidate.trim().split('.').length === 3) {
          incomingToken = candidate.trim();
        }
      }
      if (incomingToken) {
        setLaunchToken(incomingToken);
        if (tradingSocket) {
          tradingSocket.reinitializeSession(incomingToken);
        }
      }
    } catch {
      // ignore
    }
  });
}

type MessageHandler<T = any> = (payload: T, requestId?: string) => void;

export class TradingSocketClient {
  private ws: WebSocket | null = null;
  private status: SocketStatus = 'DISCONNECTED';
  private reconnectTimer: number | null = null;
  private pingInterval: number | null = null;
  private pendingRequests: Map<string, { resolve: (val: any) => void; reject: (err: any) => void; timer: number }> = new Map();
  private reqCounter: number = 0;
  private authFailureCode: string | null = null;

  // Registered Event Handlers
  private sessionReadyHandlers: Set<(data: SessionReadyPayload) => void> = new Set();
  private quoteHandlers: Set<(quotes: Record<string, Quote>) => void> = new Set();
  private accountStateHandlers: Set<(account: AccountStatePayload['account']) => void> = new Set();
  private orderAckHandlers: Set<(result: OrderAckPayload) => void> = new Set();
  private orderUpdateHandlers: Set<(order: OrderUpdatePayload['order']) => void> = new Set();
  private executionHandlers: Set<(execution: Execution) => void> = new Set();
  private positionUpdateHandlers: Set<(position: PositionUpdatePayload['position']) => void> = new Set();
  private positionClosedHandlers: Set<(payload: PositionClosedPayload) => void> = new Set();
  private errorHandlers: Set<(err: ErrorPayload) => void> = new Set();
  private statusHandlers: Set<(status: SocketStatus) => void> = new Set();

  private activeSubscribedSymbols: Set<string> = new Set();

  constructor() {
    // Lazy or explicit connect
  }

  public getStatus(): SocketStatus {
    return this.status;
  }

  public clearAuthFailure(): void {
    this.authFailureCode = null;
  }

  private setStatus(newStatus: SocketStatus) {
    if (this.status !== newStatus) {
      this.status = newStatus;
      for (const h of this.statusHandlers) {
        h(newStatus);
      }
    }
  }

  public reinitializeSession(token?: string): void {
    this.authFailureCode = null;
    const launchToken = token || extractLaunchToken();
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.disconnect();
      this.connect();
      return;
    }
    const initPayload: SessionInitPayload = launchToken
      ? { mode: 'EXTERNAL', token: launchToken }
      : { mode: 'DEMO' };
    this.send('SESSION_INIT', initPayload);
  }

  public connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.setStatus('CONNECTING');

    const envUrl = typeof import.meta !== 'undefined' && import.meta.env ? (import.meta.env.VITE_WS_URL as string | undefined) : undefined;
    const wsUrl = resolveWebSocketUrl(envUrl);

    try {
      this.ws = new WebSocket(wsUrl);
    } catch {
      this.handleSocketClosed();
      return;
    }

    this.ws.onopen = () => {
      this.setStatus('CONNECTED');
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }

      this.startPing();

      // Immediately transmit SESSION_INIT with detected launch context (EXTERNAL token or DEMO)
      const token = extractLaunchToken();
      const initPayload: SessionInitPayload = token
        ? { mode: 'EXTERNAL', token }
        : { mode: 'DEMO' };

      this.send('SESSION_INIT', initPayload);

      // If we had active subscribed symbols, resubscribe them
      if (this.activeSubscribedSymbols.size > 0) {
        this.subscribeSymbols(Array.from(this.activeSubscribedSymbols));
      }
    };

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const envelope: WsEnvelope = JSON.parse(event.data);
        this.handleServerMessage(envelope);
      } catch {
        // Ignore unparseable frames
      }
    };

    this.ws.onclose = () => {
      this.handleSocketClosed();
    };

    this.ws.onerror = () => {
      this.handleSocketClosed();
    };
  }

  private handleSocketClosed(): void {
    this.setStatus('DISCONNECTED');
    this.stopPing();
    this.ws = null;

    // Reject any pending correlated requests
    for (const [id, req] of this.pendingRequests.entries()) {
      clearTimeout(req.timer);
      req.reject(new Error('Connection closed'));
      this.pendingRequests.delete(id);
    }

    // Auto reconnect after 2 seconds unless an unrecoverable auth error (e.g. expired or unauthorized) occurred
    if (!this.reconnectTimer && this.authFailureCode !== 'SESSION_EXPIRED' && this.authFailureCode !== 'UNAUTHORIZED') {
      this.reconnectTimer = (typeof window !== 'undefined' ? window.setTimeout : setTimeout)(() => {
        this.reconnectTimer = null;
        this.connect();
      }, 2000) as any;
    }
  }

  public disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopPing();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setStatus('DISCONNECTED');
  }

  private startPing(): void {
    this.stopPing();
    this.pingInterval = (typeof window !== 'undefined' ? window.setInterval : setInterval)(() => {
      this.send('PING', {});
    }, 20000) as any;
  }

  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private send<T>(type: WsEnvelope<T>['type'], payload: T, requestId?: string): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    const envelope: WsEnvelope<T> = {
      type,
      requestId,
      timestamp: Date.now(),
      payload,
    };

    try {
      this.ws.send(JSON.stringify(envelope));
      return true;
    } catch {
      return false;
    }
  }

  private handleServerMessage(envelope: WsEnvelope): void {
    // If correlated response, resolve Promise
    if (envelope.requestId && this.pendingRequests.has(envelope.requestId)) {
      const pending = this.pendingRequests.get(envelope.requestId)!;
      clearTimeout(pending.timer);
      this.pendingRequests.delete(envelope.requestId);
      pending.resolve(envelope.payload);
    }

    switch (envelope.type) {
      case 'SESSION_READY': {
        this.authFailureCode = null;
        const payload = envelope.payload as SessionReadyPayload;
        for (const h of this.sessionReadyHandlers) h(payload);
        break;
      }

      case 'QUOTE': {
        const payload = envelope.payload as QuotePayload;
        for (const h of this.quoteHandlers) h(payload.quotes);
        break;
      }

      case 'ACCOUNT_STATE': {
        const payload = envelope.payload as AccountStatePayload;
        for (const h of this.accountStateHandlers) h(payload.account);
        break;
      }

      case 'ORDER_ACK': {
        const payload = envelope.payload as OrderAckPayload;
        for (const h of this.orderAckHandlers) h(payload);
        break;
      }

      case 'ORDER_UPDATE': {
        const payload = envelope.payload as OrderUpdatePayload;
        for (const h of this.orderUpdateHandlers) h(payload.order);
        break;
      }

      case 'EXECUTION': {
        const payload = envelope.payload as ExecutionPayload;
        for (const h of this.executionHandlers) h(payload.execution);
        break;
      }

      case 'POSITION_UPDATE': {
        const payload = envelope.payload as PositionUpdatePayload;
        for (const h of this.positionUpdateHandlers) h(payload.position);
        break;
      }

      case 'POSITION_CLOSED': {
        const payload = envelope.payload as PositionClosedPayload;
        for (const h of this.positionClosedHandlers) h(payload);
        break;
      }

      case 'ERROR': {
        const payload = envelope.payload as ErrorPayload;
        if (payload && (payload.code === 'SESSION_EXPIRED' || payload.code === 'UNAUTHORIZED')) {
          this.authFailureCode = payload.code;
        }
        for (const h of this.errorHandlers) h(payload);
        break;
      }
    }
  }

  public subscribeSymbols(symbols: string[]): void {
    for (const s of symbols) {
      this.activeSubscribedSymbols.add(s);
    }
    this.send('SUBSCRIBE_SYMBOLS', { symbols });
  }

  public unsubscribeSymbols(symbols: string[]): void {
    for (const s of symbols) {
      this.activeSubscribedSymbols.delete(s);
    }
    this.send('UNSUBSCRIBE_SYMBOLS', { symbols });
  }

  public placeOrder(order: PlaceOrderPayload): Promise<OrderResult> {
    const requestId = `req_ord_${++this.reqCounter}_${Date.now()}`;
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Order execution timed out'));
      }, 5000);

      this.pendingRequests.set(requestId, { resolve, reject, timer });

      const sent = this.send('PLACE_ORDER', order, requestId);
      if (!sent) {
        clearTimeout(timer);
        this.pendingRequests.delete(requestId);
        reject(new Error('WebSocket is not connected'));
      }
    });
  }

  public cancelOrder(orderId: string): Promise<any> {
    const requestId = `req_cancel_${++this.reqCounter}_${Date.now()}`;
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Cancel order timed out'));
      }, 5000);

      this.pendingRequests.set(requestId, { resolve, reject, timer });

      const sent = this.send('CANCEL_ORDER', { orderId }, requestId);
      if (!sent) {
        clearTimeout(timer);
        this.pendingRequests.delete(requestId);
        reject(new Error('WebSocket is not connected'));
      }
    });
  }

  public replaceOrder(payload: ReplaceOrderPayload): Promise<any> {
    const requestId = `req_replace_${++this.reqCounter}_${Date.now()}`;
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Replace order timed out'));
      }, 5000);

      this.pendingRequests.set(requestId, { resolve, reject, timer });

      const sent = this.send('REPLACE_ORDER', payload, requestId);
      if (!sent) {
        clearTimeout(timer);
        this.pendingRequests.delete(requestId);
        reject(new Error('WebSocket is not connected'));
      }
    });
  }

  public modifyPosition(positionId: string, stopLoss?: number, takeProfit?: number): void {
    const payload: ModifyPositionPayload = { positionId, stopLoss, takeProfit };
    this.send('MODIFY_POSITION', payload);
  }

  public closePosition(positionId: string): void {
    const payload: ClosePositionPayload = { positionId };
    this.send('CLOSE_POSITION', payload);
  }

  // Subscriber registration
  public onSessionReady(cb: (data: SessionReadyPayload) => void): () => void {
    this.sessionReadyHandlers.add(cb);
    return () => this.sessionReadyHandlers.delete(cb);
  }

  public onQuotes(cb: (quotes: Record<string, Quote>) => void): () => void {
    this.quoteHandlers.add(cb);
    return () => this.quoteHandlers.delete(cb);
  }

  public onAccountState(cb: (account: AccountStatePayload['account']) => void): () => void {
    this.accountStateHandlers.add(cb);
    return () => this.accountStateHandlers.delete(cb);
  }

  public onOrderAck(cb: (result: OrderAckPayload) => void): () => void {
    this.orderAckHandlers.add(cb);
    return () => this.orderAckHandlers.delete(cb);
  }

  public onOrderUpdate(cb: (order: OrderUpdatePayload['order']) => void): () => void {
    this.orderUpdateHandlers.add(cb);
    return () => this.orderUpdateHandlers.delete(cb);
  }

  public onExecution(cb: (execution: Execution) => void): () => void {
    this.executionHandlers.add(cb);
    return () => this.executionHandlers.delete(cb);
  }

  public onPositionUpdate(cb: (position: PositionUpdatePayload['position']) => void): () => void {
    this.positionUpdateHandlers.add(cb);
    return () => this.positionUpdateHandlers.delete(cb);
  }

  public onPositionClosed(cb: (payload: PositionClosedPayload) => void): () => void {
    this.positionClosedHandlers.add(cb);
    return () => this.positionClosedHandlers.delete(cb);
  }

  public onError(cb: (err: ErrorPayload) => void): () => void {
    this.errorHandlers.add(cb);
    return () => this.errorHandlers.delete(cb);
  }

  public onStatusChange(cb: (status: SocketStatus) => void): () => void {
    this.statusHandlers.add(cb);
    cb(this.status);
    return () => this.statusHandlers.delete(cb);
  }
}

// Singleton client instance
export const tradingSocket = new TradingSocketClient();
