/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * SERVER TRADING RUNTIME (CENTRAL COORDINATOR - T3A)
 * Single authoritative in-memory state engine orchestrating Market, Accounts,
 * Orders (Market, Limit, Stop, Cancel, Replace), and Positions.
 */

import { AccountRegistry } from './AccountRegistry';
import { ClientRegistry, ClientSession } from './ClientRegistry';
import { MarketEngine } from '../market/MarketEngine';
import type { IMarketDataProvider } from '../market/IMarketDataProvider';
import { TiingoMarketDataAdapter } from '../market/TiingoMarketDataAdapter';
import { OrderEngine } from '../trading/OrderEngine';
import { PositionEngine } from '../trading/PositionEngine';
import { RiskEngine } from '../trading/RiskEngine';
import { ExecutionRegistry } from '../trading/ExecutionRegistry';
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
import {
  AccountStatePayload,
  CancelOrderPayload,
  ExecutionPayload,
  OrderAckPayload,
  OrderUpdatePayload,
  PositionClosedPayload,
  PositionUpdatePayload,
  QuotePayload,
  ReplaceOrderPayload,
  SessionInitPayload,
  SessionReadyPayload,
  WsEnvelope,
} from '../ws/wsProtocol';
import { SessionTokenService } from '../auth/SessionTokenService';
import { DatabaseClient } from '../db/DatabaseClient';
import { TradingPersistenceService } from './TradingPersistenceService';

export function createDefaultMarketProvider(): IMarketDataProvider {
  const useRealData = process.env.USE_REAL_MARKET_DATA === 'true';
  const token = process.env.TIINGO_API_TOKEN?.trim();

  if (useRealData && token) {
    console.log('[TradingRuntime] Initializing Tiingo Market Data Adapter (5 FX Majors: EURUSD, GBPUSD, USDJPY, USDCHF, AUDUSD)...');
    return new TiingoMarketDataAdapter({
      apiToken: token,
      tickers: ['eurusd', 'gbpusd', 'usdjpy', 'usdchf', 'audusd'],
    });
  }

  if (useRealData && !token) {
    console.warn('[TradingRuntime] USE_REAL_MARKET_DATA is true, but TIINGO_API_TOKEN is not set. Falling back to synthetic MarketEngine.');
  }

  return new MarketEngine(10);
}

export interface SessionInitResult {
  success: boolean;
  readyPayload?: SessionReadyPayload;
  error?: string;
  errorCode?: 'UNAUTHORIZED' | 'SESSION_EXPIRED' | 'MISSING_CREDENTIAL' | 'ACCOUNT_NOT_FOUND' | 'INVALID_SESSION';
}

export class TradingRuntime {
  public readonly market: IMarketDataProvider;
  public readonly accounts: AccountRegistry;
  public readonly clients: ClientRegistry;
  public readonly orders: OrderEngine;
  public readonly positions: PositionEngine;
  public readonly executions: ExecutionRegistry;
  public readonly persistence: TradingPersistenceService;
  public readonly startedAt: number = Date.now();

  constructor(marketProvider?: IMarketDataProvider) {
    this.market = marketProvider || createDefaultMarketProvider();
    this.accounts = new AccountRegistry();
    this.clients = new ClientRegistry();
    this.orders = new OrderEngine((accId) => this.accounts.getAccount(accId));
    this.positions = new PositionEngine();
    this.executions = new ExecutionRegistry();
    this.persistence = new TradingPersistenceService(DatabaseClient.getInstance());

    // Wire single controlled market tick loop to the authoritative runtime
    this.market.subscribe((batch) => this.handleMarketTickBatch(batch));
  }

  public start(): void {
    this.market.start();
  }

  public stop(): void {
    this.market.stop();
  }

  /**
   * Broadcast helper: safely sends a typed envelope to a specific client.
   */
  public sendToClient<T>(session: ClientSession, type: WsEnvelope<T>['type'], payload: T, requestId?: string): void {
    if (session.ws.readyState !== session.ws.OPEN) return;
    const envelope: WsEnvelope<T> = {
      type,
      requestId,
      timestamp: Date.now(),
      payload,
    };
    try {
      session.ws.send(JSON.stringify(envelope));
    } catch {
      // Ignore transient socket send errors
    }
  }

  /**
   * Send typed envelope to all connected sessions for a given account.
   */
  public sendToAccount<T>(accountId: string, type: WsEnvelope<T>['type'], payload: T, requestId?: string): void {
    const sessions = this.clients.getClientsForAccount(accountId);
    for (const session of sessions) {
      this.sendToClient(session, type, payload, requestId);
    }
  }

  /**
   * Handle incoming market quote batch from MarketEngine:
   * 1. Check SL/TP triggers on open positions.
   * 2. Check LIMIT / STOP triggers on active working orders.
   * 3. Mark positions to market.
   * 4. Recalculate affected accounts.
   * 5. Broadcast quotes targetedly to subscribed clients.
   */
  private handleMarketTickBatch(batch: Record<string, Quote>): void {
    const affectedAccountIds = new Set<string>();

    for (const [symbol, quote] of Object.entries(batch)) {
      const symbolCfg = this.market.getSymbolConfig(symbol);
      if (!symbolCfg) continue;

      // 1. Process SL/TP triggered closes on open positions
      const { updatedPositions, triggeredCloses } = this.positions.updateMarkPriceAndCheckTriggers(
        symbol,
        quote,
        symbolCfg
      );

      for (const closeOutcome of triggeredCloses) {
        const pos = closeOutcome.closedPosition;
        affectedAccountIds.add(pos.accountId);

        const account = this.accounts.getAccount(pos.accountId);
        if (account) {
          const newBalance = Number((account.balance + closeOutcome.realizedPnL).toFixed(2));
          account.balance = newBalance;

          const desc = closeOutcome.closeReason === 'STOP_LOSS'
            ? `SL Triggered: Closed ${pos.side} ${pos.volume} ${pos.symbol} @ ${pos.currentPrice}`
            : closeOutcome.closeReason === 'TAKE_PROFIT'
            ? `TP Triggered: Closed ${pos.side} ${pos.volume} ${pos.symbol} @ ${pos.currentPrice}`
            : `Closed ${pos.side} ${pos.volume} ${pos.symbol} @ ${pos.currentPrice}`;

          const ledgerEntry = this.accounts.createLedgerEntry(
            account.id,
            'TRADE_PNL',
            closeOutcome.realizedPnL,
            newBalance,
            desc,
            pos.id
          );

          this.accounts.updateAccount(account);

          if (closeOutcome.execution) {
            this.executions.recordExecution(closeOutcome.execution);
            this.sendToAccount<ExecutionPayload>(pos.accountId, 'EXECUTION', { execution: closeOutcome.execution });
          }

          // Persist SL/TP triggered position close atomically to PostgreSQL
          this.persistence.recordPositionClose(
            pos,
            closeOutcome.execution,
            ledgerEntry,
            account,
            account.tenantId
          ).catch((err) => console.error('[Persistence] SL/TP close persist error:', err));

          // Emit POSITION_CLOSED
          this.sendToAccount<PositionClosedPayload>(pos.accountId, 'POSITION_CLOSED', {
            position: pos,
            ledgerEntry,
            execution: closeOutcome.execution,
          });
        }
      }

      // 2. Check LIMIT / STOP Working Order Triggers
      const triggeredWorkingOrders = this.orders.checkWorkingOrderTriggers(
        symbol,
        quote,
        symbolCfg,
        (accId) => this.accounts.getAccount(accId)
      );
      for (const triggered of triggeredWorkingOrders) {
        const order = triggered.triggeredOrder;
        affectedAccountIds.add(order.accountId);

        if (order.status === 'REJECTED' || !triggered.positionTemplate) {
          // Trigger-time risk validation failed
          const account = this.accounts.getAccount(order.accountId);
          this.persistence.orders.saveOrder(order, account?.tenantId || 'tenant_default').catch((err) =>
            console.error('[Persistence] Trigger reject persist error:', err)
          );
          this.sendToAccount<OrderUpdatePayload>(order.accountId, 'ORDER_UPDATE', { order });
          continue;
        }

        const account = this.accounts.getAccount(order.accountId);
        const leverage = account?.leverage || 100;
        triggered.positionTemplate.marginLocked = RiskEngine.calculateRequiredMargin(
          order.volume,
          order.executionPrice,
          symbolCfg.contractSize,
          leverage
        );

        const newPosition = this.positions.openPosition(triggered.positionTemplate);

        // Record Authoritative Execution
        if (triggered.execution) {
          triggered.execution.positionId = newPosition.id;
          this.executions.recordExecution(triggered.execution);
          this.sendToAccount<ExecutionPayload>(order.accountId, 'EXECUTION', { execution: triggered.execution });
        }

        // Immediately recalculate account state so subsequent triggers have correct margin
        if (account) {
          const openPositions = this.positions.getOpenPositionsForAccount(account.id);
          const allQuotes = this.market.getAllQuotes();
          const allSymbolsMap: Record<string, SymbolConfig> = {};
          for (const s of this.market.getAllSymbols()) {
            allSymbolsMap[s.symbol] = s;
          }

          const riskSnapshot = RiskEngine.recalculateAccountState(account, openPositions, allQuotes, allSymbolsMap);
          account.equity = riskSnapshot.equity;
          account.usedMargin = riskSnapshot.usedMargin;
          account.freeMargin = riskSnapshot.freeMargin;
          account.marginLevel = riskSnapshot.marginLevel;
          this.accounts.updateAccount(account);

          // Persist order fill, position opening, execution, and account state atomically
          this.persistence.recordOrderExecution(
            order,
            newPosition,
            triggered.execution,
            account,
            account.tenantId
          ).catch((err) => console.error('[Persistence] Triggered order execution persist error:', err));
        }

        // Broadcast order update and newly opened position
        this.sendToAccount<OrderUpdatePayload>(order.accountId, 'ORDER_UPDATE', { order });
        this.sendToAccount<PositionUpdatePayload>(order.accountId, 'POSITION_UPDATE', { position: newPosition });
        if (account) {
          this.sendToAccount<AccountStatePayload>(account.id, 'ACCOUNT_STATE', { account });
        }
      }

      // 3. Process open position mark-to-market updates
      for (const pos of updatedPositions) {
        affectedAccountIds.add(pos.accountId);
        this.sendToAccount<PositionUpdatePayload>(pos.accountId, 'POSITION_UPDATE', { position: pos });
      }
    }

    // 4. Recalculate affected accounts
    for (const accId of affectedAccountIds) {
      const account = this.accounts.getAccount(accId);
      if (!account) continue;

      const openPositions = this.positions.getOpenPositionsForAccount(accId);
      const allQuotes = this.market.getAllQuotes();
      const allSymbolsMap: Record<string, SymbolConfig> = {};
      for (const s of this.market.getAllSymbols()) {
        allSymbolsMap[s.symbol] = s;
      }

      const riskSnapshot = RiskEngine.recalculateAccountState(account, openPositions, allQuotes, allSymbolsMap);
      account.equity = riskSnapshot.equity;
      account.usedMargin = riskSnapshot.usedMargin;
      account.freeMargin = riskSnapshot.freeMargin;
      account.marginLevel = riskSnapshot.marginLevel;

      this.accounts.updateAccount(account);
      this.sendToAccount<AccountStatePayload>(accId, 'ACCOUNT_STATE', { account });
    }

    // 5. Broadcast quotes ONLY to subscribed clients (Targeted subscriptions)
    const clientQuoteBatches = new Map<ClientSession, Record<string, Quote>>();

    for (const [symbol, quote] of Object.entries(batch)) {
      const subscribers = this.clients.getClientsForSymbol(symbol);
      for (const client of subscribers) {
        let b = clientQuoteBatches.get(client);
        if (!b) {
          b = {};
          clientQuoteBatches.set(client, b);
        }
        b[symbol] = quote;
      }
    }

    for (const [client, quoteMap] of clientQuoteBatches.entries()) {
      this.sendToClient<QuotePayload>(client, 'QUOTE', { quotes: quoteMap });
    }
  }

  /**
   * Authoritatively initializes session for a WebSocket connection.
   * Supports:
   * - MODE A (DEMO): Standalone testing/showcase.
   * - MODE B (EXTERNAL): Authenticated via cryptographically verified CRM launch token.
   * Strict security: Does NOT fall back to DEMO if an external token is invalid/expired.
   */
  public async initializeSession(
    connectionId: string,
    initPayload?: SessionInitPayload | string
  ): Promise<SessionInitResult> {
    const session = this.clients.getSession(connectionId);
    if (!session) {
      return { success: false, errorCode: 'INVALID_SESSION', error: 'Connection session not found' };
    }

    let payload: SessionInitPayload;
    if (typeof initPayload === 'string') {
      payload = { preferredAccountId: initPayload };
    } else {
      payload = initPayload || {};
    }

    const mode = payload.mode || (payload.token ? 'EXTERNAL' : 'DEMO');
    let resolvedAccount: TradingAccount | undefined;

    if (mode === 'EXTERNAL' || payload.token) {
      // MODE B — EXTERNAL / CRM-LAUNCHED SESSION
      const token = payload.token?.trim();
      if (!token) {
        return {
          success: false,
          errorCode: 'MISSING_CREDENTIAL',
          error: 'External session launch requires a signed launch token',
        };
      }

      const verifyResult = SessionTokenService.verifyLaunchToken(token);
      if (!verifyResult.valid || !verifyResult.claims) {
        const code = verifyResult.error === 'SESSION_EXPIRED' ? 'SESSION_EXPIRED' : 'UNAUTHORIZED';
        return {
          success: false,
          errorCode: code,
          error: verifyResult.errorMessage || 'Invalid or unverified external launch token',
        };
      }

      const claims = verifyResult.claims;

      // Ownership check: Prevent browser from claiming a different account than the token grants
      if (
        payload.preferredAccountId &&
        payload.preferredAccountId !== claims.accountId &&
        payload.preferredAccountId !== claims.accountNumber
      ) {
        return {
          success: false,
          errorCode: 'UNAUTHORIZED',
          error: `Requested account '${payload.preferredAccountId}' does not match authenticated token authorization`,
        };
      }

      // Initialize PostgreSQL persistence layer
      await this.persistence.init();

      try {
        // Authoritative account resolution from PostgreSQL repository with tenant isolation
        resolvedAccount = await this.persistence.accounts.getExternalAccount(claims.tenantId, claims.accountId, claims.accountNumber);

        if (!resolvedAccount) {
          resolvedAccount = await this.persistence.accounts.provisionExternalAccount(claims);
        } else {
          // Client ownership check: Prevent a different client from hijacking an existing account
          if (resolvedAccount.clientId && resolvedAccount.clientId !== claims.sub) {
            return {
              success: false,
              errorCode: 'UNAUTHORIZED',
              error: `Selected account '${claims.accountNumber}' belongs to a different client`,
            };
          }
          // Existing account: load it, do not reset balance/positions/orders/ledger
          resolvedAccount.clientId = claims.sub;
          if (claims.platform) resolvedAccount.platform = claims.platform;
          resolvedAccount.sessionMode = 'EXTERNAL';
          await this.persistence.accounts.updateAccountMetadataOnly(resolvedAccount);
        }

        // Recover persisted state from PostgreSQL into runtime in-memory engines
        const hydrated = await this.persistence.hydrateAccountSession(resolvedAccount.id);
        if (hydrated) {
          this.accounts.hydrateAccount(hydrated.account, hydrated.ledger);
          this.positions.hydratePositions(hydrated.positions);
          this.orders.hydrateOrders(hydrated.orders);
          this.executions.hydrateExecutions(hydrated.executions);
        }
      } catch (err: any) {
        return {
          success: false,
          errorCode: 'UNAUTHORIZED',
          error: err?.message || 'Failed to authenticate and resolve selected external account',
        };
      }
    } else {
      // MODE A — STANDALONE DEMO
      if (payload.preferredAccountId) {
        // Enforce that only registered demo accounts can be selected in DEMO mode
        if (!this.accounts.isDemoAccount(payload.preferredAccountId)) {
          return {
            success: false,
            errorCode: 'UNAUTHORIZED',
            error: `Direct account selection of '${payload.preferredAccountId}' requires an authenticated external launch token`,
          };
        }
        resolvedAccount = this.accounts.getAccount(payload.preferredAccountId);
      }

      if (!resolvedAccount) {
        resolvedAccount = this.accounts.getAccount('DEMO-1001') || this.accounts.getAllAccounts()[0];
      }
    }

    if (!resolvedAccount) {
      return {
        success: false,
        errorCode: 'ACCOUNT_NOT_FOUND',
        error: 'Unable to resolve authoritative trading account',
      };
    }

    // Bind authoritative account to connection
    session.accountId = resolvedAccount.id;

    // Default subscription: top active symbols
    const activeSymbols = this.market.getActiveSymbols().map((s) => s.symbol);
    this.clients.subscribeSymbols(connectionId, activeSymbols);

    const positions = this.positions.getPositionsForAccount(resolvedAccount.id);
    const orders = this.orders.getOrdersForAccount(resolvedAccount.id);
    const executions = this.executions.getExecutionsForAccount(resolvedAccount.id);
    const ledger = this.accounts.getLedger(resolvedAccount.id);

    const readyPayload: SessionReadyPayload = {
      connectionId,
      account: resolvedAccount,
      symbols: this.market.getAllSymbols(),
      positions,
      orders,
      executions,
      ledger,
      activeSymbols,
    };

    return {
      success: true,
      readyPayload,
    };
  }

  /**
   * Execute order on behalf of authenticated connection (MARKET, LIMIT, STOP).
   */
  public async placeOrder(
    connectionId: string,
    orderData: {
      symbol: string;
      side: 'BUY' | 'SELL';
      type: 'MARKET' | 'LIMIT' | 'STOP';
      volume: number;
      requestedPrice?: number;
      stopLoss?: number;
      takeProfit?: number;
      clientOrderId?: string;
    },
    requestId?: string
  ): Promise<OrderResult> {
    const session = this.clients.getSession(connectionId);
    if (!session) {
      return {
        success: false,
        order: null as any,
        error: 'Invalid or disconnected session',
      };
    }

    const account = this.accounts.getAccount(session.accountId);
    if (!account) {
      return {
        success: false,
        order: null as any,
        error: 'Account not found',
      };
    }

    const quote = this.market.getQuote(orderData.symbol);
    const symbolCfg = this.market.getSymbolConfig(orderData.symbol);

    const request: OrderRequest = {
      accountId: account.id,
      symbol: orderData.symbol,
      side: orderData.side,
      type: orderData.type,
      volume: orderData.volume,
      requestedPrice: orderData.requestedPrice,
      stopLoss: orderData.stopLoss,
      takeProfit: orderData.takeProfit,
      clientOrderId: orderData.clientOrderId,
    };

    const { result, positionTemplate } = this.orders.executeOrder(
      request,
      account,
      quote,
      symbolCfg
    );

    if (result.success) {
      if (result.order.status === 'FILLED' && positionTemplate) {
        // Immediate fill (Market order or immediate Limit/Stop trigger)
        const position = this.positions.openPosition(positionTemplate);
        result.position = position;

        // Record Authoritative Execution
        if (result.execution) {
          result.execution.positionId = position.id;
          this.executions.recordExecution(result.execution);
          this.sendToAccount<ExecutionPayload>(account.id, 'EXECUTION', { execution: result.execution });
        }

        // Recalculate account
        const openPositions = this.positions.getOpenPositionsForAccount(account.id);
        const allQuotes = this.market.getAllQuotes();
        const allSymbolsMap: Record<string, SymbolConfig> = {};
        for (const s of this.market.getAllSymbols()) {
          allSymbolsMap[s.symbol] = s;
        }

        const riskSnapshot = RiskEngine.recalculateAccountState(account, openPositions, allQuotes, allSymbolsMap);
        account.equity = riskSnapshot.equity;
        account.usedMargin = riskSnapshot.usedMargin;
        account.freeMargin = riskSnapshot.freeMargin;
        account.marginLevel = riskSnapshot.marginLevel;
        this.accounts.updateAccount(account);

        // Persist order execution to PostgreSQL atomically
        await this.persistence.recordOrderExecution(
          result.order,
          position,
          result.execution,
          account,
          account.tenantId
        ).catch((err) => console.error('[Persistence] Order execution persist error:', err));

        // Send ORDER_ACK to originating client
        this.sendToClient<OrderAckPayload>(session, 'ORDER_ACK', result, requestId);
        // Send ORDER_UPDATE and POSITION_UPDATE to all account sessions
        this.sendToAccount<OrderUpdatePayload>(account.id, 'ORDER_UPDATE', { order: result.order });
        this.sendToAccount<PositionUpdatePayload>(account.id, 'POSITION_UPDATE', { position });
        this.sendToAccount<AccountStatePayload>(account.id, 'ACCOUNT_STATE', { account });
      } else {
        // Working order placed (status === 'WORKING')
        await this.persistence.recordOrderPlacement(result.order, account.tenantId).catch((err) =>
          console.error('[Persistence] Working order persist error:', err)
        );
        this.sendToClient<OrderAckPayload>(session, 'ORDER_ACK', result, requestId);
        this.sendToAccount<OrderUpdatePayload>(account.id, 'ORDER_UPDATE', { order: result.order });
      }
    } else {
      // Rejection
      this.sendToClient<OrderAckPayload>(session, 'ORDER_ACK', result, requestId);
    }

    return result;
  }

  /**
   * Cancel an active WORKING order.
   */
  public async cancelOrder(
    connectionId: string,
    orderId: string,
    requestId?: string
  ): Promise<{ success: boolean; order?: Order; error?: string }> {
    const session = this.clients.getSession(connectionId);
    if (!session) {
      return { success: false, error: 'Invalid or disconnected session' };
    }

    const res = this.orders.cancelWorkingOrder(orderId, session.accountId);
    if (res.success && res.order) {
      const account = this.accounts.getAccount(session.accountId);
      await this.persistence.orders.saveOrder(res.order, account?.tenantId || 'tenant_default').catch((err) =>
        console.error('[Persistence] Cancel order persist error:', err)
      );
      // Broadcast ORDER_UPDATE with CANCELLED status
      this.sendToAccount<OrderUpdatePayload>(session.accountId, 'ORDER_UPDATE', { order: res.order });
      this.sendToClient(session, 'ORDER_ACK', { success: true, order: res.order }, requestId);
      return { success: true, order: res.order };
    } else {
      this.sendToClient(session, 'ERROR', {
        code: 'CANCEL_FAILED',
        message: res.error || 'Failed to cancel order',
      }, requestId);
      return { success: false, error: res.error };
    }
  }

  /**
   * Replace an active WORKING order.
   */
  public async replaceOrder(
    connectionId: string,
    payload: ReplaceOrderPayload,
    requestId?: string
  ): Promise<{ success: boolean; oldOrder?: Order; newOrder?: Order; error?: string }> {
    const session = this.clients.getSession(connectionId);
    if (!session) {
      return { success: false, error: 'Invalid or disconnected session' };
    }

    const account = this.accounts.getAccount(session.accountId);
    if (!account) {
      return { success: false, error: 'Account not found' };
    }

    const originalOrder = this.orders.getOrder(payload.orderId);
    if (!originalOrder) {
      this.sendToClient(session, 'ERROR', { code: 'NOT_FOUND', message: 'Original order not found' }, requestId);
      return { success: false, error: 'Original order not found' };
    }

    const quote = this.market.getQuote(originalOrder.symbol);
    const symbolCfg = this.market.getSymbolConfig(originalOrder.symbol);

    const outcome = this.orders.replaceWorkingOrder(
      payload,
      session.accountId,
      account,
      quote,
      symbolCfg
    );

    if (outcome.success && outcome.oldOrder && outcome.newOrder) {
      // Persist replaced old order
      await this.persistence.orders.saveOrder(outcome.oldOrder, account.tenantId).catch((err) =>
        console.error('[Persistence] Replace old order persist error:', err)
      );
      // Emit update for old order (REPLACED)
      this.sendToAccount<OrderUpdatePayload>(account.id, 'ORDER_UPDATE', { order: outcome.oldOrder });

      if (outcome.positionTemplate && outcome.newOrder.status === 'FILLED') {
        // Immediate execution of replaced order
        const position = this.positions.openPosition(outcome.positionTemplate);

        // Record Authoritative Execution
        if (outcome.execution) {
          outcome.execution.positionId = position.id;
          this.executions.recordExecution(outcome.execution);
          this.sendToAccount<ExecutionPayload>(account.id, 'EXECUTION', { execution: outcome.execution });
        }

        // Recalculate account
        const openPositions = this.positions.getOpenPositionsForAccount(account.id);
        const allQuotes = this.market.getAllQuotes();
        const allSymbolsMap: Record<string, SymbolConfig> = {};
        for (const s of this.market.getAllSymbols()) {
          allSymbolsMap[s.symbol] = s;
        }

        const riskSnapshot = RiskEngine.recalculateAccountState(account, openPositions, allQuotes, allSymbolsMap);
        account.equity = riskSnapshot.equity;
        account.usedMargin = riskSnapshot.usedMargin;
        account.freeMargin = riskSnapshot.freeMargin;
        account.marginLevel = riskSnapshot.marginLevel;
        this.accounts.updateAccount(account);

        // Persist new order execution atomically
        await this.persistence.recordOrderExecution(
          outcome.newOrder,
          position,
          outcome.execution,
          account,
          account.tenantId
        ).catch((err) => console.error('[Persistence] Replace new order execution persist error:', err));

        this.sendToClient<OrderAckPayload>(session, 'ORDER_ACK', { success: true, order: outcome.newOrder, position }, requestId);
        this.sendToAccount<OrderUpdatePayload>(account.id, 'ORDER_UPDATE', { order: outcome.newOrder });
        this.sendToAccount<PositionUpdatePayload>(account.id, 'POSITION_UPDATE', { position });
        this.sendToAccount<AccountStatePayload>(account.id, 'ACCOUNT_STATE', { account });
      } else {
        // New working order
        await this.persistence.recordOrderPlacement(outcome.newOrder, account.tenantId).catch((err) =>
          console.error('[Persistence] Replace new working order persist error:', err)
        );
        this.sendToClient<OrderAckPayload>(session, 'ORDER_ACK', { success: true, order: outcome.newOrder }, requestId);
        this.sendToAccount<OrderUpdatePayload>(account.id, 'ORDER_UPDATE', { order: outcome.newOrder });
      }

      return {
        success: true,
        oldOrder: outcome.oldOrder,
        newOrder: outcome.newOrder,
      };
    } else {
      this.sendToClient(session, 'ERROR', {
        code: 'REPLACE_FAILED',
        message: outcome.error || 'Failed to replace order',
      }, requestId);
      return { success: false, error: outcome.error };
    }
  }

  /**
   * Modify Position SL/TP
   */
  public async modifyPosition(
    connectionId: string,
    positionId: string,
    stopLoss?: number,
    takeProfit?: number,
    requestId?: string
  ): Promise<boolean> {
    const session = this.clients.getSession(connectionId);
    if (!session) return false;

    const pos = this.positions.getPosition(positionId);
    if (!pos || pos.accountId !== session.accountId) {
      this.sendToClient(session, 'ERROR', { code: 'UNAUTHORIZED', message: 'Position does not belong to session account' }, requestId);
      return false;
    }

    const res = this.positions.modifySLTP(positionId, stopLoss, takeProfit);
    if (res.success && res.position) {
      const account = this.accounts.getAccount(session.accountId);
      await this.persistence.positions.savePosition(res.position, account?.tenantId || 'tenant_default').catch((err) =>
        console.error('[Persistence] Modify position persist error:', err)
      );
      this.sendToAccount<PositionUpdatePayload>(session.accountId, 'POSITION_UPDATE', { position: res.position }, requestId);
      return true;
    }
    return false;
  }

  /**
   * Close Position Manually (supports Full Close or Partial Close)
   */
  public async closePosition(
    connectionId: string,
    positionId: string,
    volume?: number,
    requestId?: string
  ): Promise<boolean> {
    const session = this.clients.getSession(connectionId);
    if (!session) return false;

    const pos = this.positions.getPosition(positionId);
    if (!pos || pos.accountId !== session.accountId) {
      this.sendToClient(session, 'ERROR', { code: 'UNAUTHORIZED', message: 'Position does not belong to session account' }, requestId);
      return false;
    }

    const quote = this.market.getQuote(pos.symbol);
    const symbolCfg = this.market.getSymbolConfig(pos.symbol);
    if (!quote || !symbolCfg) {
      this.sendToClient(session, 'ERROR', { code: 'NO_QUOTE', message: 'Live quote unavailable for closing' }, requestId);
      return false;
    }

    const res = this.positions.closePosition(positionId, quote, symbolCfg, 'MANUAL', volume);
    if (res.success && res.outcome) {
      const account = this.accounts.getAccount(pos.accountId);
      if (account) {
        account.balance = Number((account.balance + res.outcome.realizedPnL).toFixed(2));
        const desc = res.outcome.isPartialClose
          ? `Partially Closed ${pos.side} ${res.outcome.closedVolume} ${pos.symbol} @ ${res.outcome.closedPosition.currentPrice} (Remaining: ${res.outcome.remainingVolume}L)`
          : `Manually Closed ${pos.side} ${pos.volume} ${pos.symbol} @ ${res.outcome.closedPosition.currentPrice}`;

        const ledgerEntry = this.accounts.createLedgerEntry(
          account.id,
          'TRADE_PNL',
          res.outcome.realizedPnL,
          account.balance,
          desc,
          pos.id
        );

        if (res.outcome.execution) {
          this.executions.recordExecution(res.outcome.execution);
          this.sendToAccount<ExecutionPayload>(account.id, 'EXECUTION', { execution: res.outcome.execution });
        }

        // Recalculate remaining open positions
        const openPositions = this.positions.getOpenPositionsForAccount(account.id);
        const allQuotes = this.market.getAllQuotes();
        const allSymbolsMap: Record<string, SymbolConfig> = {};
        for (const s of this.market.getAllSymbols()) {
          allSymbolsMap[s.symbol] = s;
        }

        const riskSnapshot = RiskEngine.recalculateAccountState(account, openPositions, allQuotes, allSymbolsMap);
        account.equity = riskSnapshot.equity;
        account.usedMargin = riskSnapshot.usedMargin;
        account.freeMargin = riskSnapshot.freeMargin;
        account.marginLevel = riskSnapshot.marginLevel;
        this.accounts.updateAccount(account);

        // Persist position close atomically to PostgreSQL
        await this.persistence.recordPositionClose(
          res.outcome.closedPosition,
          res.outcome.execution,
          ledgerEntry,
          account,
          account.tenantId
        ).catch((err) => console.error('[Persistence] Position close persist error:', err));

        if (res.outcome.isPartialClose) {
          this.sendToAccount<PositionUpdatePayload>(account.id, 'POSITION_UPDATE', { position: res.outcome.closedPosition });
        } else {
          this.sendToAccount<PositionClosedPayload>(account.id, 'POSITION_CLOSED', {
            position: res.outcome.closedPosition,
            ledgerEntry,
            execution: res.outcome.execution,
          }, requestId);
        }
        this.sendToAccount<AccountStatePayload>(account.id, 'ACCOUNT_STATE', { account });
      }
      return true;
    }

    return false;
  }

  private pendingExecutions: Set<string> = new Set();

  /**
   * Authoritative execution ingestion method with persistent duplicate protection.
   */
  public async processExecution(execution: Execution): Promise<{ success: boolean; duplicate: boolean }> {
    if (this.executions.isDuplicate(execution.id) || this.pendingExecutions.has(execution.id)) {
      return { success: false, duplicate: true };
    }
    this.pendingExecutions.add(execution.id);

    try {
      const account = this.accounts.getAccount(execution.accountId);
      if (!account) {
        return { success: false, duplicate: false };
      }

      const persistResult = await this.persistence.applyExecution(
        execution,
        undefined,
        undefined,
        undefined,
        undefined,
        account.tenantId
      );

      if (persistResult.duplicate) {
        return { success: false, duplicate: true };
      }

      this.executions.recordExecution(execution);
      return { success: true, duplicate: false };
    } finally {
      this.pendingExecutions.delete(execution.id);
    }
  }

  public getRuntimeStats() {
    const marketMetrics = this.market.getMetrics();
    return {
      connectedClients: this.clients.getClientCount(),
      activeAccounts: this.clients.getUniqueAccountCount(),
      totalAccounts: this.accounts.getAllAccounts().length,
      activeSymbols: marketMetrics.activeSymbolsCount,
      totalSymbols: this.market.getAllSymbols().length,
      activeOrders: this.orders.getOrderCount(),
      workingOrders: this.orders.getWorkingOrderCount(),
      openPositions: this.positions.getOpenPositionCount(),
      totalExecutions: this.executions.getExecutionCount(),
      ticksGeneratedCount: marketMetrics.ticksGeneratedCount,
      lastTickTimestamp: marketMetrics.lastTickTimestamp,
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
    };
  }
}
