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
} from '../../server/src/ws/wsProtocol';
import { Execution, OrderResult, Quote } from '../types/trading';

export type SocketStatus = 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED';

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

    return normalized;
  }

  // Fallback to same-origin host
  const loc = locationObj || (typeof window !== 'undefined' ? window.location : { protocol: 'http:', host: 'localhost:3000' });
  const protocol = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${loc.host}/ws`;
}

/**
 * Safely extracts launch token from URL query parameter (?token=...)
 * or cached sessionStorage. Sanitizes browser URL upon extraction
 * to prevent token leakage in browser history/referrers.
 */
export function extractLaunchToken(): string | null {
  if (typeof window === 'undefined') return null;

  try {
    const params = new URLSearchParams(window.location.search);
    const tokenFromUrl = params.get('token')?.trim();
    if (tokenFromUrl) {
      sessionStorage.setItem('trading_terminal_launch_token', tokenFromUrl);
      // Clean query parameter from browser address bar without reload
      params.delete('token');
      const newSearch = params.toString();
      const newUrl = window.location.pathname + (newSearch ? `?${newSearch}` : '') + window.location.hash;
      window.history.replaceState({}, document.title, newUrl);
      return tokenFromUrl;
    }

    return sessionStorage.getItem('trading_terminal_launch_token') || null;
  } catch {
    return null;
  }
}

type MessageHandler<T = any> = (payload: T, requestId?: string) => void;

export class TradingSocketClient {
  private ws: WebSocket | null = null;
  private status: SocketStatus = 'DISCONNECTED';
  private reconnectTimer: number | null = null;
  private pingInterval: number | null = null;
  private pendingRequests: Map<string, { resolve: (val: any) => void; reject: (err: any) => void; timer: number }> = new Map();
  private reqCounter: number = 0;

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

  private setStatus(newStatus: SocketStatus) {
    if (this.status !== newStatus) {
      this.status = newStatus;
      for (const h of this.statusHandlers) {
        h(newStatus);
      }
    }
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

    // Auto reconnect after 2 seconds
    if (!this.reconnectTimer) {
      this.reconnectTimer = window.setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, 2000);
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
    this.pingInterval = window.setInterval(() => {
      this.send('PING', {});
    }, 20000);
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
