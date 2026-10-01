/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * SERVER WEBSOCKET ENGINE
 * WebSocket server lifecycle, message parsing, validation, and session dispatching.
 */

import { Server as HttpServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { TradingRuntime } from '../runtime/TradingRuntime';
import {
  CancelOrderPayload,
  ClosePositionPayload,
  ModifyPositionPayload,
  PlaceOrderPayload,
  ReplaceOrderPayload,
  SessionInitPayload,
  SubscribeSymbolsPayload,
  UnsubscribeSymbolsPayload,
  WsEnvelope,
} from './wsProtocol';

export class TradingWebSocketServer {
  private wss: WebSocketServer;
  private runtime: TradingRuntime;
  private connectionCounter: number = 0;
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(server: HttpServer | null, runtime: TradingRuntime, path: string = '/ws') {
    this.runtime = runtime;
    if (server) {
      this.wss = new WebSocketServer({ server, path });
    } else {
      this.wss = new WebSocketServer({ noServer: true });
    }

    this.setupListeners();
    this.startHeartbeat();
  }

  public getWss(): WebSocketServer {
    return this.wss;
  }

  private setupListeners(): void {
    this.wss.on('connection', async (ws: WebSocket, req: any) => {
      const connectionId = `conn_${++this.connectionCounter}`;
      // Register temporary session
      const session = this.runtime.clients.register(connectionId, 'unauthenticated', ws);

      ws.on('message', (data: Buffer | string) => {
        this.handleMessage(connectionId, data);
      });

      ws.on('close', () => {
        this.runtime.clients.unregister(connectionId);
      });

      ws.on('error', () => {
        this.runtime.clients.unregister(connectionId);
      });

      // Check if external launch token is passed directly on WebSocket connection query string
      let tokenFromQuery: string | undefined;
      if (req?.url) {
        try {
          const urlObj = new URL(req.url, 'http://localhost');
          tokenFromQuery = urlObj.searchParams.get('token')?.trim() || undefined;
        } catch {
          // ignore malformed URL
        }
      }

      if (tokenFromQuery) {
        // External launch token specified on connection handshake
        const result = await this.runtime.initializeSession(connectionId, {
          mode: 'EXTERNAL',
          token: tokenFromQuery,
        });

        if (result.success && result.readyPayload) {
          this.runtime.sendToClient(session, 'SESSION_READY', result.readyPayload);
          const initialQuotes: Record<string, any> = {};
          for (const sym of result.readyPayload.activeSymbols) {
            const q = this.runtime.market.getQuote(sym);
            if (q) initialQuotes[sym] = q;
          }
          if (Object.keys(initialQuotes).length > 0) {
            this.runtime.sendToClient(session, 'QUOTE', { quotes: initialQuotes });
          }
        } else {
          session.accountId = 'unauthenticated';
          this.runtime.sendToClient(session, 'ERROR', {
            code: result.errorCode || 'UNAUTHORIZED',
            message: result.error || 'External launch authentication failed',
          });
        }
      } else {
        // Standalone default launch: initialize demo mode
        const result = await this.runtime.initializeSession(connectionId, { mode: 'DEMO' });
        if (result.success && result.readyPayload) {
          this.runtime.sendToClient(session, 'SESSION_READY', result.readyPayload);
          const initialQuotes: Record<string, any> = {};
          for (const sym of result.readyPayload.activeSymbols) {
            const q = this.runtime.market.getQuote(sym);
            if (q) initialQuotes[sym] = q;
          }
          if (Object.keys(initialQuotes).length > 0) {
            this.runtime.sendToClient(session, 'QUOTE', { quotes: initialQuotes });
          }
        }
      }
    });
  }

  private async handleMessage(connectionId: string, rawData: Buffer | string): Promise<void> {
    const session = this.runtime.clients.getSession(connectionId);
    if (!session) return;

    // 1. Bound message size to 64KB
    if (rawData.length > 65536) {
      this.runtime.sendToClient(session, 'ERROR', {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Message exceeds 64KB limit',
      });
      return;
    }

    // 2. Parse JSON safely
    let envelope: WsEnvelope;
    try {
      envelope = JSON.parse(rawData.toString());
    } catch {
      this.runtime.sendToClient(session, 'ERROR', {
        code: 'INVALID_JSON',
        message: 'Malformed JSON payload',
      });
      return;
    }

    if (!envelope || typeof envelope !== 'object' || !envelope.type) {
      this.runtime.sendToClient(session, 'ERROR', {
        code: 'INVALID_ENVELOPE',
        message: 'Envelope must have a type property',
      });
      return;
    }

    this.runtime.clients.updateLastSeen(connectionId);

    try {
      // 3. Dispatch based on message type
      switch (envelope.type) {
        case 'SESSION_INIT': {
          const payload = envelope.payload as SessionInitPayload | undefined;
          const result = await this.runtime.initializeSession(connectionId, payload);
          if (result.success && result.readyPayload) {
            this.runtime.sendToClient(session, 'SESSION_READY', result.readyPayload, envelope.requestId);

            // Seed client with baseline quotes for active symbols if available
            const initialQuotes: Record<string, any> = {};
            for (const sym of result.readyPayload.activeSymbols) {
              const q = this.runtime.market.getQuote(sym);
              if (q) initialQuotes[sym] = q;
            }
            if (Object.keys(initialQuotes).length > 0) {
              this.runtime.sendToClient(session, 'QUOTE', { quotes: initialQuotes });
            }
          } else {
            session.accountId = 'unauthenticated';
            this.runtime.sendToClient(session, 'ERROR', {
              code: result.errorCode || 'UNAUTHORIZED',
              message: result.error || 'Session initialization failed',
            }, envelope.requestId);
          }
          break;
        }

      case 'SUBSCRIBE_SYMBOLS': {
        const payload = envelope.payload as SubscribeSymbolsPayload;
        if (!payload || !Array.isArray(payload.symbols)) {
          this.runtime.sendToClient(session, 'ERROR', { code: 'INVALID_PAYLOAD', message: 'symbols array is required' }, envelope.requestId);
          return;
        }
        this.runtime.clients.subscribeSymbols(connectionId, payload.symbols);

        // Send current quotes for newly subscribed symbols
        const quotesToSend: Record<string, any> = {};
        for (const sym of payload.symbols) {
          const q = this.runtime.market.getQuote(sym);
          if (q) quotesToSend[sym] = q;
        }
        if (Object.keys(quotesToSend).length > 0) {
          this.runtime.sendToClient(session, 'QUOTE', { quotes: quotesToSend }, envelope.requestId);
        }
        break;
      }

      case 'UNSUBSCRIBE_SYMBOLS': {
        const payload = envelope.payload as UnsubscribeSymbolsPayload;
        if (payload && Array.isArray(payload.symbols)) {
          this.runtime.clients.unsubscribeSymbols(connectionId, payload.symbols);
        }
        break;
      }

      case 'PLACE_ORDER': {
        if (!session.accountId || session.accountId === 'unauthenticated') {
          this.runtime.sendToClient(session, 'ERROR', {
            code: 'UNAUTHORIZED',
            message: 'Session is not authenticated. Please initialize session first.',
          }, envelope.requestId);
          return;
        }

        const payload = envelope.payload as PlaceOrderPayload;
        if (!payload || !payload.symbol || !payload.side || typeof payload.volume !== 'number' || payload.volume <= 0) {
          this.runtime.sendToClient(session, 'ERROR', { code: 'INVALID_ORDER', message: 'Invalid order parameters' }, envelope.requestId);
          return;
        }

        await this.runtime.placeOrder(connectionId, payload, envelope.requestId);
        break;
      }

      case 'CANCEL_ORDER': {
        if (!session.accountId || session.accountId === 'unauthenticated') {
          this.runtime.sendToClient(session, 'ERROR', {
            code: 'UNAUTHORIZED',
            message: 'Session is not authenticated. Please initialize session first.',
          }, envelope.requestId);
          return;
        }

        const payload = envelope.payload as CancelOrderPayload;
        if (!payload || !payload.orderId) {
          this.runtime.sendToClient(session, 'ERROR', { code: 'INVALID_PAYLOAD', message: 'orderId is required' }, envelope.requestId);
          return;
        }

        await this.runtime.cancelOrder(connectionId, payload.orderId, envelope.requestId);
        break;
      }

      case 'REPLACE_ORDER': {
        if (!session.accountId || session.accountId === 'unauthenticated') {
          this.runtime.sendToClient(session, 'ERROR', {
            code: 'UNAUTHORIZED',
            message: 'Session is not authenticated. Please initialize session first.',
          }, envelope.requestId);
          return;
        }

        const payload = envelope.payload as ReplaceOrderPayload;
        if (!payload || !payload.orderId) {
          this.runtime.sendToClient(session, 'ERROR', { code: 'INVALID_PAYLOAD', message: 'orderId is required' }, envelope.requestId);
          return;
        }

        await this.runtime.replaceOrder(connectionId, payload, envelope.requestId);
        break;
      }

      case 'MODIFY_POSITION': {
        if (!session.accountId || session.accountId === 'unauthenticated') {
          this.runtime.sendToClient(session, 'ERROR', {
            code: 'UNAUTHORIZED',
            message: 'Session is not authenticated. Please initialize session first.',
          }, envelope.requestId);
          return;
        }

        const payload = envelope.payload as ModifyPositionPayload;
        if (!payload || !payload.positionId) {
          this.runtime.sendToClient(session, 'ERROR', { code: 'INVALID_PAYLOAD', message: 'positionId is required' }, envelope.requestId);
          return;
        }
        await this.runtime.modifyPosition(connectionId, payload.positionId, payload.stopLoss, payload.takeProfit, envelope.requestId);
        break;
      }

      case 'CLOSE_POSITION': {
        if (!session.accountId || session.accountId === 'unauthenticated') {
          this.runtime.sendToClient(session, 'ERROR', {
            code: 'UNAUTHORIZED',
            message: 'Session is not authenticated. Please initialize session first.',
          }, envelope.requestId);
          return;
        }

        const payload = envelope.payload as ClosePositionPayload;
        if (!payload || !payload.positionId) {
          this.runtime.sendToClient(session, 'ERROR', { code: 'INVALID_PAYLOAD', message: 'positionId is required' }, envelope.requestId);
          return;
        }
        await this.runtime.closePosition(connectionId, payload.positionId, payload.volume, envelope.requestId);
        break;
      }

      case 'PING': {
        this.runtime.sendToClient(session, 'PONG', { time: Date.now() }, envelope.requestId);
        break;
      }

      default: {
        this.runtime.sendToClient(session, 'ERROR', {
          code: 'UNKNOWN_MESSAGE_TYPE',
          message: `Unrecognized message type: ${envelope.type}`,
        }, envelope.requestId);
        break;
      }
    }
  } catch (err: any) {
    console.error('[wsServer] Unhandled message error:', err);
    this.runtime.sendToClient(session, 'ERROR', {
      code: 'INTERNAL_ERROR',
      message: err.message || 'Internal server error processing message',
    }, envelope.requestId);
  }
}

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      const sessions = this.runtime.clients.getAllClients();
      for (const s of sessions) {
        // Disconnect clients silent for > 60s
        if (now - s.lastSeenAt > 60000) {
          s.ws.terminate();
          this.runtime.clients.unregister(s.connectionId);
        }
      }
    }, 30000);
  }

  public close(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    this.wss.close();
  }
}
