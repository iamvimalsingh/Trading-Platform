/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * SERVER CLIENT REGISTRY
 * Tracks active WebSocket connections, session associations, and symbol subscriptions.
 */

import type { WebSocket } from 'ws';

export interface ClientSession {
  connectionId: string;
  accountId: string;
  connectedAt: number;
  lastSeenAt: number;
  subscribedSymbols: Set<string>;
  ws: WebSocket;
}

export interface ClientSessionSummary {
  connectionId: string;
  accountId: string;
  connectedAt: number;
  lastSeenAt: number;
  subscribedSymbols: string[];
}

export class ClientRegistry {
  private sessions: Map<string, ClientSession> = new Map();
  // Reverse index for fast symbol lookup: symbol -> Set of connectionIds
  private symbolSubscribers: Map<string, Set<string>> = new Map();

  public register(connectionId: string, accountId: string, ws: WebSocket): ClientSession {
    const now = Date.now();
    const session: ClientSession = {
      connectionId,
      accountId,
      connectedAt: now,
      lastSeenAt: now,
      subscribedSymbols: new Set(),
      ws,
    };
    this.sessions.set(connectionId, session);
    return session;
  }

  public unregister(connectionId: string): ClientSession | undefined {
    const session = this.sessions.get(connectionId);
    if (!session) return undefined;

    // Clean up symbol reverse index
    for (const symbol of session.subscribedSymbols) {
      const subs = this.symbolSubscribers.get(symbol);
      if (subs) {
        subs.delete(connectionId);
        if (subs.size === 0) {
          this.symbolSubscribers.delete(symbol);
        }
      }
    }

    this.sessions.delete(connectionId);
    return session;
  }

  public getSession(connectionId: string): ClientSession | undefined {
    return this.sessions.get(connectionId);
  }

  public updateLastSeen(connectionId: string): void {
    const session = this.sessions.get(connectionId);
    if (session) {
      session.lastSeenAt = Date.now();
    }
  }

  public subscribeSymbols(connectionId: string, symbols: string[]): string[] {
    const session = this.sessions.get(connectionId);
    if (!session) return [];

    const newlySubscribed: string[] = [];
    const MAX_SUBSCRIPTIONS = 100;

    for (const rawSym of symbols) {
      const sym = rawSym.toUpperCase();
      if (session.subscribedSymbols.size >= MAX_SUBSCRIPTIONS) {
        break; // Hardened against runaway subscriptions
      }
      if (!session.subscribedSymbols.has(sym)) {
        session.subscribedSymbols.add(sym);
        newlySubscribed.push(sym);

        let subs = this.symbolSubscribers.get(sym);
        if (!subs) {
          subs = new Set();
          this.symbolSubscribers.set(sym, subs);
        }
        subs.add(connectionId);
      }
    }
    return newlySubscribed;
  }

  public unsubscribeSymbols(connectionId: string, symbols: string[]): string[] {
    const session = this.sessions.get(connectionId);
    if (!session) return [];

    const unsubscribed: string[] = [];
    for (const rawSym of symbols) {
      const sym = rawSym.toUpperCase();
      if (session.subscribedSymbols.has(sym)) {
        session.subscribedSymbols.delete(sym);
        unsubscribed.push(sym);

        const subs = this.symbolSubscribers.get(sym);
        if (subs) {
          subs.delete(connectionId);
          if (subs.size === 0) {
            this.symbolSubscribers.delete(sym);
          }
        }
      }
    }
    return unsubscribed;
  }

  public getClientsForSymbol(symbol: string): ClientSession[] {
    const canonical = symbol.toUpperCase();
    const connectionIds = this.symbolSubscribers.get(canonical) || this.symbolSubscribers.get(symbol);
    if (!connectionIds || connectionIds.size === 0) return [];

    const clients: ClientSession[] = [];
    for (const id of connectionIds) {
      const s = this.sessions.get(id);
      if (s && s.ws.readyState === s.ws.OPEN) {
        clients.push(s);
      }
    }
    return clients;
  }

  public getClientsForAccount(accountId: string): ClientSession[] {
    const result: ClientSession[] = [];
    for (const s of this.sessions.values()) {
      if (s.accountId === accountId && s.ws.readyState === s.ws.OPEN) {
        result.push(s);
      }
    }
    return result;
  }

  public getAllClients(): ClientSession[] {
    return Array.from(this.sessions.values());
  }

  public getClientCount(): number {
    return this.sessions.size;
  }

  public getUniqueAccountCount(): number {
    const accounts = new Set<string>();
    for (const s of this.sessions.values()) {
      accounts.add(s.accountId);
    }
    return accounts.size;
  }

  public getSubscribedSymbolsSummary(): Record<string, number> {
    const summary: Record<string, number> = {};
    for (const [sym, set] of this.symbolSubscribers.entries()) {
      summary[sym] = set.size;
    }
    return summary;
  }

  public getClientSummaries(): ClientSessionSummary[] {
    return Array.from(this.sessions.values()).map((s) => ({
      connectionId: s.connectionId,
      accountId: s.accountId,
      connectedAt: s.connectedAt,
      lastSeenAt: s.lastSeenAt,
      subscribedSymbols: Array.from(s.subscribedSymbols),
    }));
  }
}
