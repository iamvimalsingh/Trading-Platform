/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * SERVER-AUTHORITATIVE ORDER ENGINE (T3A)
 * Validates, checks pre-trade risk, matches market & working orders (LIMIT / STOP),
 * handles cancellation & replacement, and manages complete order lifecycle.
 */

import {
  CancelOrderRequest,
  Execution,
  Order,
  OrderRequest,
  OrderResult,
  OrderStatus,
  Position,
  Quote,
  ReplaceOrderRequest,
  SymbolConfig,
  TradingAccount,
} from '../types/trading';
import { RiskEngine } from './RiskEngine';
import { ExecutionResolver } from './ExecutionResolver';

export interface TriggeredOrderExecution {
  triggeredOrder: Order;
  execution?: Execution;
  positionTemplate?: Position;
}

export interface ReplaceOrderOutcome {
  success: boolean;
  oldOrder?: Order;
  newOrder?: Order;
  execution?: Execution;
  positionTemplate?: Position;
  error?: string;
}

export class OrderEngine {
  public static isValidTransition(from: OrderStatus, to: OrderStatus): boolean {
    if (from === to) return true;
    switch (from) {
      case 'NEW':
        return to === 'WORKING' || to === 'FILLED' || to === 'REJECTED' || to === 'PENDING';
      case 'PENDING':
        return to === 'WORKING' || to === 'FILLED' || to === 'REJECTED' || to === 'CANCELLED';
      case 'WORKING':
        return to === 'PARTIALLY_FILLED' || to === 'FILLED' || to === 'CANCELLED' || to === 'REPLACED' || to === 'REJECTED';
      case 'PARTIALLY_FILLED':
        return to === 'PARTIALLY_FILLED' || to === 'FILLED' || to === 'CANCELLED';
      case 'FILLED':
      case 'CANCELLED':
      case 'REJECTED':
      case 'REPLACED':
        return false;
      default:
        return false;
    }
  }

  private orders: Map<string, Order> = new Map();
  private clientOrderIndex: Map<string, string> = new Map(); // clientOrderId -> orderId
  // Efficient symbol-indexed active working orders: symbol -> Map<orderId, Order>
  private workingOrdersBySymbol: Map<string, Map<string, Order>> = new Map();
  private nextOrderId: number = 1000;
  private nextExecutionId: number = 7000;
  private accountResolver?: (accountId: string) => TradingAccount | undefined;

  constructor(accountResolver?: (accountId: string) => TradingAccount | undefined) {
    this.accountResolver = accountResolver;
  }

  public setAccountResolver(resolver: (accountId: string) => TradingAccount | undefined): void {
    this.accountResolver = resolver;
  }

  public hydrateOrders(orders: Order[]): void {
    for (const o of orders) {
      this.orders.set(o.id, { ...o });
      if (o.clientOrderId) {
        this.clientOrderIndex.set(o.clientOrderId, o.id);
      }
      if (o.status === 'WORKING' || o.status === 'PENDING') {
        let symMap = this.workingOrdersBySymbol.get(o.symbol);
        if (!symMap) {
          symMap = new Map();
          this.workingOrdersBySymbol.set(o.symbol, symMap);
        }
        symMap.set(o.id, { ...o });
      }
    }
  }

  /**
   * Main entry point for placing an order (MARKET, LIMIT, or STOP)
   */
  public executeOrder(
    request: OrderRequest,
    account: TradingAccount,
    quote: Quote | undefined,
    symbolCfg: SymbolConfig | undefined
  ): { result: OrderResult; positionTemplate?: Position } {
    if (request.type === 'MARKET') {
      return this.executeMarketOrder(request, account, quote, symbolCfg);
    } else if (request.type === 'LIMIT' || request.type === 'STOP') {
      return this.placeWorkingOrder(request, account, quote, symbolCfg);
    } else {
      const orderId = `ord_${++this.nextOrderId}`;
      const rejected: Order = {
        id: orderId,
        clientOrderId: request.clientOrderId || `cli_${Date.now()}_${this.nextOrderId}`,
        accountId: account.id,
        symbol: request.symbol,
        side: request.side,
        type: request.type,
        volume: request.volume,
        requestedPrice: request.requestedPrice || 0,
        executionPrice: 0,
        status: 'REJECTED',
        rejectReason: `Unsupported order type ${request.type}`,
        createdAt: Date.now(),
      };
      this.saveOrder(rejected);
      return {
        result: {
          success: false,
          order: rejected,
          error: rejected.rejectReason,
        },
      };
    }
  }

  /**
   * MARKET Execution: Validates and fills immediately at Ask (BUY) or Bid (SELL).
   */
  public executeMarketOrder(
    request: OrderRequest,
    account: TradingAccount,
    quote: Quote | undefined,
    symbolCfg: SymbolConfig | undefined
  ): { result: OrderResult; positionTemplate?: Position } {
    const now = Date.now();
    const orderId = `ord_${++this.nextOrderId}`;
    const clientOrderId = request.clientOrderId || `cli_${now}_${this.nextOrderId}`;

    // Idempotency check: duplicate submission within session
    if (this.clientOrderIndex.has(clientOrderId)) {
      const existingId = this.clientOrderIndex.get(clientOrderId)!;
      const existing = this.orders.get(existingId)!;
      return {
        result: {
          success: existing.status === 'FILLED' || existing.status === 'WORKING',
          order: existing,
          error: existing.status === 'REJECTED' ? existing.rejectReason : 'Duplicate clientOrderId already processed',
        },
      };
    }

    const baseOrder: Order = {
      id: orderId,
      clientOrderId,
      accountId: account.id,
      symbol: request.symbol,
      side: request.side,
      type: 'MARKET',
      volume: request.volume,
      requestedPrice: quote ? (request.side === 'BUY' ? quote.ask : quote.bid) : 0,
      executionPrice: 0,
      stopLoss: request.stopLoss,
      takeProfit: request.takeProfit,
      status: 'PENDING',
      createdAt: now,
    };

    if (!symbolCfg) {
      const rejected: Order = {
        ...baseOrder,
        status: 'REJECTED',
        rejectReason: `Unknown symbol ${request.symbol}`,
      };
      this.saveOrder(rejected);
      return {
        result: {
          success: false,
          order: rejected,
          error: rejected.rejectReason,
        },
      };
    }

    if (!quote) {
      const rejected: Order = {
        ...baseOrder,
        status: 'REJECTED',
        rejectReason: `No live quote available for ${request.symbol}`,
      };
      this.saveOrder(rejected);
      return {
        result: {
          success: false,
          order: rejected,
          error: rejected.rejectReason,
        },
      };
    }

    // Production Hardening: Quote status & Staleness Verification
    const anyQuote = quote as any;
    if (anyQuote.marketStatus === 'UNAVAILABLE' || anyQuote.marketStatus === 'CLOSED' || anyQuote.marketStatus === 'DISCONNECTED') {
      const rejected: Order = {
        ...baseOrder,
        status: 'REJECTED',
        rejectReason: `Market data for ${request.symbol} is currently ${anyQuote.marketStatus}`,
      };
      this.saveOrder(rejected);
      return {
        result: { success: false, order: rejected, error: rejected.rejectReason },
      };
    }

    if (anyQuote.marketStatus === 'STALE') {
      const rejected: Order = {
        ...baseOrder,
        status: 'REJECTED',
        rejectReason: `Cannot execute order against STALE market quote for ${request.symbol}`,
      };
      this.saveOrder(rejected);
      return {
        result: { success: false, order: rejected, error: rejected.rejectReason },
      };
    }

    // In production mode, reject execution against simulated quotes
    if (process.env.USE_REAL_MARKET_DATA === 'true' && (anyQuote.marketStatus === 'SIMULATED' || anyQuote.source === 'synthetic_sim')) {
      const rejected: Order = {
        ...baseOrder,
        status: 'REJECTED',
        rejectReason: 'Simulated quotes are not permitted for live execution in production mode',
      };
      this.saveOrder(rejected);
      return {
        result: { success: false, order: rejected, error: rejected.rejectReason },
      };
    }

    // Quote price sanity verification
    if (quote.bid <= 0 || quote.ask <= 0 || quote.ask < quote.bid) {
      const rejected: Order = {
        ...baseOrder,
        status: 'REJECTED',
        rejectReason: `Invalid quote pricing received for ${request.symbol} (bid: ${quote.bid}, ask: ${quote.ask})`,
      };
      this.saveOrder(rejected);
      return {
        result: { success: false, order: rejected, error: rejected.rejectReason },
      };
    }

    // Determine Authoritative Execution Price: BUY fills at Ask, SELL fills at Bid
    const executionPrice = ExecutionResolver.resolvePrice(request.side, quote);

    // SL / TP bounds verification
    if (request.side === 'BUY') {
      if (request.stopLoss !== undefined && request.stopLoss > 0 && request.stopLoss >= executionPrice) {
        const rejected: Order = {
          ...baseOrder,
          requestedPrice: executionPrice,
          status: 'REJECTED',
          rejectReason: `Stop loss (${request.stopLoss}) for BUY order must be strictly below execution price (${executionPrice})`,
        };
        this.saveOrder(rejected);
        return {
          result: { success: false, order: rejected, error: rejected.rejectReason },
        };
      }
      if (request.takeProfit !== undefined && request.takeProfit > 0 && request.takeProfit <= executionPrice) {
        const rejected: Order = {
          ...baseOrder,
          requestedPrice: executionPrice,
          status: 'REJECTED',
          rejectReason: `Take profit (${request.takeProfit}) for BUY order must be strictly above execution price (${executionPrice})`,
        };
        this.saveOrder(rejected);
        return {
          result: { success: false, order: rejected, error: rejected.rejectReason },
        };
      }
    } else if (request.side === 'SELL') {
      if (request.stopLoss !== undefined && request.stopLoss > 0 && request.stopLoss <= executionPrice) {
        const rejected: Order = {
          ...baseOrder,
          requestedPrice: executionPrice,
          status: 'REJECTED',
          rejectReason: `Stop loss (${request.stopLoss}) for SELL order must be strictly above execution price (${executionPrice})`,
        };
        this.saveOrder(rejected);
        return {
          result: { success: false, order: rejected, error: rejected.rejectReason },
        };
      }
      if (request.takeProfit !== undefined && request.takeProfit > 0 && request.takeProfit >= executionPrice) {
        const rejected: Order = {
          ...baseOrder,
          requestedPrice: executionPrice,
          status: 'REJECTED',
          rejectReason: `Take profit (${request.takeProfit}) for SELL order must be strictly below execution price (${executionPrice})`,
        };
        this.saveOrder(rejected);
        return {
          result: { success: false, order: rejected, error: rejected.rejectReason },
        };
      }
    }

    const requiredMargin = RiskEngine.calculateRequiredMargin(
      request.volume,
      executionPrice,
      symbolCfg,
      account.leverage,
      account.currency
    );

    // Pre-Trade Risk Verification
    const riskCheck = RiskEngine.validatePreTradeRisk(account, requiredMargin, symbolCfg, request.volume);
    if (!riskCheck.valid) {
      const rejected: Order = {
        ...baseOrder,
        requestedPrice: executionPrice,
        status: 'REJECTED',
        rejectReason: riskCheck.reason,
      };
      this.saveOrder(rejected);
      return {
        result: {
          success: false,
          order: rejected,
          error: riskCheck.reason,
        },
      };
    }

    // Fill the Order Authoritatively
    const filledOrder: Order = {
      ...baseOrder,
      requestedPrice: executionPrice,
      executionPrice,
      status: 'FILLED',
      executedAt: now,
    };

    this.saveOrder(filledOrder);

    // Create Authoritative Opening Execution Record
    const execution: Execution = {
      id: `exec_${++this.nextExecutionId}`,
      orderId: filledOrder.id,
      accountId: account.id,
      symbol: request.symbol,
      side: request.side,
      type: 'OPEN',
      volume: request.volume,
      executionPrice,
      commission: 0,
      fee: 0,
      clientOrderId: filledOrder.clientOrderId,
      timestamp: now,
    };

    // Build the Position Template to be materialized by PositionEngine
    const initialPnL = RiskEngine.calculatePositionPnL(
      { side: request.side, volume: request.volume, openPrice: executionPrice },
      quote,
      symbolCfg.contractSize
    );

    const positionTemplate: Position = {
      id: '', // PositionEngine assigns authoritative position ID
      accountId: account.id,
      symbol: request.symbol,
      side: request.side,
      volume: request.volume,
      openPrice: executionPrice,
      currentPrice: executionPrice,
      unrealizedPnL: initialPnL,
      realizedPnL: 0,
      stopLoss: request.stopLoss,
      takeProfit: request.takeProfit,
      marginLocked: requiredMargin,
      openedAt: now,
      status: 'OPEN',
    };

    return {
      result: {
        success: true,
        order: filledOrder,
        execution,
      },
      positionTemplate,
    };
  }

  /**
   * WORKING Order Placement: Pre-trade validation for LIMIT / STOP orders.
   * If trigger condition is already met on placement against current quote, it executes immediately.
   * Otherwise, registers as an active WORKING order.
   */
  public placeWorkingOrder(
    request: OrderRequest,
    account: TradingAccount,
    quote: Quote | undefined,
    symbolCfg: SymbolConfig | undefined
  ): { result: OrderResult; positionTemplate?: Position } {
    const now = Date.now();
    const orderId = `ord_${++this.nextOrderId}`;
    const clientOrderId = request.clientOrderId || `cli_${now}_${this.nextOrderId}`;

    // Idempotency check
    if (this.clientOrderIndex.has(clientOrderId)) {
      const existingId = this.clientOrderIndex.get(clientOrderId)!;
      const existing = this.orders.get(existingId)!;
      return {
        result: {
          success: existing.status === 'WORKING' || existing.status === 'FILLED',
          order: existing,
          error: existing.status === 'REJECTED' ? existing.rejectReason : 'Duplicate clientOrderId already processed',
        },
      };
    }

    const requestedPrice = request.requestedPrice ?? 0;

    const baseOrder: Order = {
      id: orderId,
      clientOrderId,
      accountId: account.id,
      symbol: request.symbol,
      side: request.side,
      type: request.type,
      volume: request.volume,
      requestedPrice,
      executionPrice: 0,
      stopLoss: request.stopLoss,
      takeProfit: request.takeProfit,
      status: 'PENDING',
      createdAt: now,
    };

    if (!symbolCfg) {
      const rejected: Order = {
        ...baseOrder,
        status: 'REJECTED',
        rejectReason: `Unknown symbol ${request.symbol}`,
      };
      this.saveOrder(rejected);
      return {
        result: { success: false, order: rejected, error: rejected.rejectReason },
      };
    }

    if (requestedPrice <= 0 || isNaN(requestedPrice) || !isFinite(requestedPrice)) {
      const rejected: Order = {
        ...baseOrder,
        status: 'REJECTED',
        rejectReason: `Invalid requested price ${requestedPrice} for ${request.type} order`,
      };
      this.saveOrder(rejected);
      return {
        result: { success: false, order: rejected, error: rejected.rejectReason },
      };
    }

    // SL / TP bounds verification for working orders
    if (request.side === 'BUY') {
      if (request.stopLoss !== undefined && request.stopLoss > 0 && request.stopLoss >= requestedPrice) {
        const rejected: Order = {
          ...baseOrder,
          status: 'REJECTED',
          rejectReason: `Stop loss (${request.stopLoss}) for BUY order must be strictly below requested price (${requestedPrice})`,
        };
        this.saveOrder(rejected);
        return {
          result: { success: false, order: rejected, error: rejected.rejectReason },
        };
      }
      if (request.takeProfit !== undefined && request.takeProfit > 0 && request.takeProfit <= requestedPrice) {
        const rejected: Order = {
          ...baseOrder,
          status: 'REJECTED',
          rejectReason: `Take profit (${request.takeProfit}) for BUY order must be strictly above requested price (${requestedPrice})`,
        };
        this.saveOrder(rejected);
        return {
          result: { success: false, order: rejected, error: rejected.rejectReason },
        };
      }
    } else if (request.side === 'SELL') {
      if (request.stopLoss !== undefined && request.stopLoss > 0 && request.stopLoss <= requestedPrice) {
        const rejected: Order = {
          ...baseOrder,
          status: 'REJECTED',
          rejectReason: `Stop loss (${request.stopLoss}) for SELL order must be strictly above requested price (${requestedPrice})`,
        };
        this.saveOrder(rejected);
        return {
          result: { success: false, order: rejected, error: rejected.rejectReason },
        };
      }
      if (request.takeProfit !== undefined && request.takeProfit > 0 && request.takeProfit >= requestedPrice) {
        const rejected: Order = {
          ...baseOrder,
          status: 'REJECTED',
          rejectReason: `Take profit (${request.takeProfit}) for SELL order must be strictly below requested price (${requestedPrice})`,
        };
        this.saveOrder(rejected);
        return {
          result: { success: false, order: rejected, error: rejected.rejectReason },
        };
      }
    }

    // Pre-Trade Risk Verification based on requested price
    const requiredMargin = RiskEngine.calculateRequiredMargin(
      request.volume,
      requestedPrice,
      symbolCfg.contractSize,
      account.leverage
    );

    const riskCheck = RiskEngine.validatePreTradeRisk(account, requiredMargin, symbolCfg, request.volume);
    if (!riskCheck.valid) {
      const rejected: Order = {
        ...baseOrder,
        status: 'REJECTED',
        rejectReason: riskCheck.reason,
      };
      this.saveOrder(rejected);
      return {
        result: { success: false, order: rejected, error: riskCheck.reason },
      };
    }

    // Check if immediate trigger condition is met at current quote
    let triggered = false;
    let fillPrice = requestedPrice;

    if (quote) {
      if (request.type === 'LIMIT') {
        if (request.side === 'BUY' && quote.ask <= requestedPrice) {
          triggered = true;
          fillPrice = quote.ask;
        } else if (request.side === 'SELL' && quote.bid >= requestedPrice) {
          triggered = true;
          fillPrice = quote.bid;
        }
      } else if (request.type === 'STOP') {
        if (request.side === 'BUY' && quote.ask >= requestedPrice) {
          triggered = true;
          fillPrice = quote.ask;
        } else if (request.side === 'SELL' && quote.bid <= requestedPrice) {
          triggered = true;
          fillPrice = quote.bid;
        }
      }
    }

    if (triggered && quote) {
      const marginAtFill = RiskEngine.calculateRequiredMargin(
        request.volume,
        fillPrice,
        symbolCfg,
        account.leverage,
        account.currency
      );

      // Trigger-time risk revalidation at actual fill price
      const fillRisk = RiskEngine.validatePreTradeRisk(account, marginAtFill, symbolCfg, request.volume);
      if (!fillRisk.valid) {
        const rejected: Order = {
          ...baseOrder,
          requestedPrice,
          executionPrice: 0,
          status: 'REJECTED',
          rejectReason: fillRisk.reason || 'Insufficient Free Margin at trigger time',
        };
        this.saveOrder(rejected);
        return {
          result: { success: false, order: rejected, error: rejected.rejectReason },
        };
      }

      // Immediate execution
      const filledOrder: Order = {
        ...baseOrder,
        requestedPrice,
        executionPrice: fillPrice,
        status: 'FILLED',
        executedAt: now,
      };
      this.saveOrder(filledOrder);

      // Create Authoritative Opening Execution Record
      const execution: Execution = {
        id: `exec_${++this.nextExecutionId}`,
        orderId: filledOrder.id,
        accountId: account.id,
        symbol: request.symbol,
        side: request.side,
        type: 'OPEN',
        volume: request.volume,
        executionPrice: fillPrice,
        commission: 0,
        fee: 0,
        clientOrderId: filledOrder.clientOrderId,
        timestamp: now,
      };

      const initialPnL = RiskEngine.calculatePositionPnL(
        { side: request.side, volume: request.volume, openPrice: fillPrice },
        quote,
        symbolCfg.contractSize
      );

      const positionTemplate: Position = {
        id: '',
        accountId: account.id,
        symbol: request.symbol,
        side: request.side,
        volume: request.volume,
        openPrice: fillPrice,
        currentPrice: fillPrice,
        unrealizedPnL: initialPnL,
        realizedPnL: 0,
        stopLoss: request.stopLoss,
        takeProfit: request.takeProfit,
        marginLocked: marginAtFill,
        openedAt: now,
        status: 'OPEN',
      };

      return {
        result: {
          success: true,
          order: filledOrder,
          execution,
        },
        positionTemplate,
      };
    }

    // Register as active WORKING order
    const workingOrder: Order = {
      ...baseOrder,
      status: 'WORKING',
    };

    this.saveOrder(workingOrder);
    this.addWorkingOrder(workingOrder);

    return {
      result: {
        success: true,
        order: workingOrder,
      },
    };
  }

  /**
   * Check trigger conditions for active working orders on symbol when a new tick arrives.
   */
  public checkWorkingOrderTriggers(
    symbol: string,
    quote: Quote,
    symbolCfg: SymbolConfig,
    accountResolver?: (accountId: string) => TradingAccount | undefined
  ): TriggeredOrderExecution[] {
    const symbolMap = this.workingOrdersBySymbol.get(symbol);
    if (!symbolMap || symbolMap.size === 0) return [];

    const triggeredList: TriggeredOrderExecution[] = [];
    const resolver = accountResolver || this.accountResolver;
    const candidates = Array.from(symbolMap.values());

    for (const order of candidates) {
      if (order.status !== 'WORKING') continue;

      let isTriggered = false;
      let fillPrice = order.requestedPrice;

      if (order.type === 'LIMIT') {
        if (order.side === 'BUY') {
          // BUY LIMIT: Ask reaches or moves below limit price
          if (quote.ask <= order.requestedPrice) {
            isTriggered = true;
            fillPrice = quote.ask;
          }
        } else {
          // SELL LIMIT: Bid reaches or moves above limit price
          if (quote.bid >= order.requestedPrice) {
            isTriggered = true;
            fillPrice = quote.bid;
          }
        }
      } else if (order.type === 'STOP') {
        if (order.side === 'BUY') {
          // BUY STOP: Ask reaches or moves above stop price
          if (quote.ask >= order.requestedPrice) {
            isTriggered = true;
            fillPrice = quote.ask;
          }
        } else {
          // SELL STOP: Bid reaches or moves below stop price
          if (quote.bid <= order.requestedPrice) {
            isTriggered = true;
            fillPrice = quote.bid;
          }
        }
      }

      if (!isTriggered) continue;

      // 1. Atomically remove from active working orders immediately to prevent duplicate execution
      this.removeWorkingOrder(order.id, order.symbol);

      const now = Date.now();
      const account = resolver ? resolver(order.accountId) : undefined;
      const leverage = account?.leverage || 100;

      const requiredMargin = RiskEngine.calculateRequiredMargin(
        order.volume,
        fillPrice,
        symbolCfg,
        leverage,
        account?.currency
      );

      // 2. Trigger-time risk revalidation
      let riskValid = true;
      let rejectReason: string | undefined;

      if (account) {
        const riskCheck = RiskEngine.validatePreTradeRisk(account, requiredMargin, symbolCfg, order.volume);
        if (!riskCheck.valid) {
          riskValid = false;
          rejectReason = riskCheck.reason || 'Insufficient Free Margin at trigger time';
        }
      }

      if (!riskValid) {
        // Deterministic terminal rejection state
        order.status = 'REJECTED';
        order.rejectReason = rejectReason;
        order.executionPrice = 0;
        this.orders.set(order.id, { ...order });

        triggeredList.push({
          triggeredOrder: { ...order },
        });
        continue;
      }

      // 3. Mark as FILLED
      order.status = 'FILLED';
      order.executionPrice = fillPrice;
      order.executedAt = now;
      this.orders.set(order.id, { ...order });

      // Deduct margin tentatively for any subsequent order for same account in this tick
      if (account) {
        account.usedMargin = Number((account.usedMargin + requiredMargin).toFixed(2));
        account.freeMargin = Number((account.freeMargin - requiredMargin).toFixed(2));
      }

      // 4. Create Authoritative Opening Execution Record
      const execution: Execution = {
        id: `exec_${++this.nextExecutionId}`,
        orderId: order.id,
        accountId: order.accountId,
        symbol: order.symbol,
        side: order.side,
        type: 'OPEN',
        volume: order.volume,
        executionPrice: fillPrice,
        commission: 0,
        fee: 0,
        clientOrderId: order.clientOrderId,
        timestamp: now,
      };

      // 5. Build position template with attached SL / TP
      const initialPnL = RiskEngine.calculatePositionPnL(
        { side: order.side, volume: order.volume, openPrice: fillPrice },
        quote,
        symbolCfg.contractSize
      );

      const positionTemplate: Position = {
        id: '',
        accountId: order.accountId,
        symbol: order.symbol,
        side: order.side,
        volume: order.volume,
        openPrice: fillPrice,
        currentPrice: fillPrice,
        unrealizedPnL: initialPnL,
        realizedPnL: 0,
        stopLoss: order.stopLoss,
        takeProfit: order.takeProfit,
        marginLocked: requiredMargin,
        openedAt: now,
        status: 'OPEN',
      };

      triggeredList.push({
        triggeredOrder: { ...order },
        execution,
        positionTemplate,
      });
    }

    return triggeredList;
  }

  /**
   * Cancel an active WORKING order.
   */
  public cancelWorkingOrder(
    orderId: string,
    accountId: string
  ): { success: boolean; order?: Order; error?: string } {
    const order = this.orders.get(orderId);
    if (!order) {
      return { success: false, error: 'Order not found' };
    }

    if (order.accountId !== accountId) {
      return { success: false, error: 'Unauthorized: order belongs to a different account' };
    }

    if (order.status === 'FILLED') {
      return { success: false, error: 'Cannot cancel an already filled order' };
    }

    if (order.status === 'CANCELLED') {
      return { success: false, error: 'Order is already cancelled' };
    }

    if (order.status === 'REPLACED') {
      return { success: false, error: 'Cannot cancel a replaced order' };
    }

    if (order.status !== 'WORKING' && order.status !== 'PENDING') {
      return { success: false, error: `Order in status ${order.status} cannot be cancelled` };
    }

    // Transition to CANCELLED
    order.status = 'CANCELLED';
    this.orders.set(order.id, { ...order });
    this.removeWorkingOrder(order.id, order.symbol);

    return {
      success: true,
      order: { ...order },
    };
  }

  /**
   * Replace an active WORKING order with modified price, SL, TP, or volume.
   */
  public replaceWorkingOrder(
    request: ReplaceOrderRequest,
    accountId: string,
    account: TradingAccount,
    quote: Quote | undefined,
    symbolCfg: SymbolConfig | undefined
  ): ReplaceOrderOutcome {
    const original = this.orders.get(request.orderId);
    if (!original) {
      return { success: false, error: 'Original order not found' };
    }

    if (original.accountId !== accountId) {
      return { success: false, error: 'Unauthorized: order belongs to a different account' };
    }

    if (original.status !== 'WORKING' && original.status !== 'PENDING') {
      return {
        success: false,
        error: `Cannot replace order in status ${original.status}. Only WORKING orders can be replaced.`,
      };
    }

    const newPrice = request.requestedPrice !== undefined ? request.requestedPrice : original.requestedPrice;
    const newVolume = request.volume !== undefined ? request.volume : original.volume;
    const newSL = request.stopLoss !== undefined ? request.stopLoss : original.stopLoss;
    const newTP = request.takeProfit !== undefined ? request.takeProfit : original.takeProfit;

    if (newPrice <= 0) {
      return { success: false, error: 'Invalid replacement price' };
    }

    if (!symbolCfg) {
      return { success: false, error: `Symbol config not found for ${original.symbol}` };
    }

    // Determine if replacement triggers immediately against current quote
    let triggered = false;
    let fillPrice = newPrice;

    if (quote) {
      if (original.type === 'LIMIT') {
        if (original.side === 'BUY' && quote.ask <= newPrice) {
          triggered = true;
          fillPrice = quote.ask;
        } else if (original.side === 'SELL' && quote.bid >= newPrice) {
          triggered = true;
          fillPrice = quote.bid;
        }
      } else if (original.type === 'STOP') {
        if (original.side === 'BUY' && quote.ask >= newPrice) {
          triggered = true;
          fillPrice = quote.ask;
        } else if (original.side === 'SELL' && quote.bid <= newPrice) {
          triggered = true;
          fillPrice = quote.bid;
        }
      }
    }

    // Pre-trade risk validation for the replacement at actual effective price
    const evalPrice = triggered ? fillPrice : newPrice;
    const requiredMargin = RiskEngine.calculateRequiredMargin(
      newVolume,
      evalPrice,
      symbolCfg,
      account.leverage,
      account.currency
    );

    const riskCheck = RiskEngine.validatePreTradeRisk(account, requiredMargin, symbolCfg, newVolume);
    if (!riskCheck.valid) {
      return { success: false, error: riskCheck.reason || 'Risk check failed on replacement' };
    }

    // 1. Mark original as REPLACED and remove from working index
    original.status = 'REPLACED';
    this.orders.set(original.id, { ...original });
    this.removeWorkingOrder(original.id, original.symbol);

    // 2. Create new working order
    const now = Date.now();
    const newOrderId = `ord_${++this.nextOrderId}`;
    const newClientOrderId = request.clientOrderId || `cli_${now}_${this.nextOrderId}`;

    const newWorkingOrder: Order = {
      id: newOrderId,
      clientOrderId: newClientOrderId,
      accountId: original.accountId,
      symbol: original.symbol,
      side: original.side,
      type: original.type,
      volume: newVolume,
      requestedPrice: newPrice,
      executionPrice: 0,
      stopLoss: newSL,
      takeProfit: newTP,
      status: 'WORKING',
      createdAt: now,
    };

    if (triggered && quote) {
      newWorkingOrder.status = 'FILLED';
      newWorkingOrder.executionPrice = fillPrice;
      newWorkingOrder.executedAt = now;
      this.saveOrder(newWorkingOrder);

      const marginAtFill = RiskEngine.calculateRequiredMargin(
        newVolume,
        fillPrice,
        symbolCfg.contractSize,
        account.leverage
      );

      const initialPnL = RiskEngine.calculatePositionPnL(
        { side: newWorkingOrder.side, volume: newVolume, openPrice: fillPrice },
        quote,
        symbolCfg.contractSize
      );

      const execution: Execution = {
        id: `exec_${++this.nextExecutionId}`,
        orderId: newWorkingOrder.id,
        accountId: original.accountId,
        symbol: original.symbol,
        side: original.side,
        type: 'OPEN',
        volume: newVolume,
        executionPrice: fillPrice,
        commission: 0,
        fee: 0,
        clientOrderId: newWorkingOrder.clientOrderId,
        timestamp: now,
      };

      const positionTemplate: Position = {
        id: '',
        accountId: original.accountId,
        symbol: original.symbol,
        side: original.side,
        volume: newVolume,
        openPrice: fillPrice,
        currentPrice: fillPrice,
        unrealizedPnL: initialPnL,
        realizedPnL: 0,
        stopLoss: newSL,
        takeProfit: newTP,
        marginLocked: marginAtFill,
        openedAt: now,
        status: 'OPEN',
      };

      return {
        success: true,
        oldOrder: { ...original },
        newOrder: { ...newWorkingOrder },
        execution,
        positionTemplate,
      };
    }

    // Register active new working order
    this.saveOrder(newWorkingOrder);
    this.addWorkingOrder(newWorkingOrder);

    return {
      success: true,
      oldOrder: { ...original },
      newOrder: { ...newWorkingOrder },
    };
  }

  private addWorkingOrder(order: Order): void {
    let map = this.workingOrdersBySymbol.get(order.symbol);
    if (!map) {
      map = new Map();
      this.workingOrdersBySymbol.set(order.symbol, map);
    }
    map.set(order.id, order);
  }

  private removeWorkingOrder(orderId: string, symbol: string): void {
    const map = this.workingOrdersBySymbol.get(symbol);
    if (map) {
      map.delete(orderId);
    }
  }

  private saveOrder(order: Order): void {
    this.orders.set(order.id, order);
    if (order.clientOrderId) {
      this.clientOrderIndex.set(order.clientOrderId, order.id);
    }
  }

  public getOrder(orderId: string): Order | undefined {
    return this.orders.get(orderId);
  }

  public getWorkingOrdersForAccount(accountId: string): Order[] {
    const list: Order[] = [];
    for (const symbolMap of this.workingOrdersBySymbol.values()) {
      for (const ord of symbolMap.values()) {
        if (ord.accountId === accountId && ord.status === 'WORKING') {
          list.push({ ...ord });
        }
      }
    }
    return list.sort((a, b) => b.createdAt - a.createdAt);
  }

  public getAllWorkingOrders(): Order[] {
    const list: Order[] = [];
    for (const symbolMap of this.workingOrdersBySymbol.values()) {
      for (const ord of symbolMap.values()) {
        if (ord.status === 'WORKING') {
          list.push({ ...ord });
        }
      }
    }
    return list.sort((a, b) => b.createdAt - a.createdAt);
  }

  public getOrdersForAccount(accountId: string): Order[] {
    const list: Order[] = [];
    for (const ord of this.orders.values()) {
      if (ord.accountId === accountId) {
        list.push({ ...ord });
      }
    }
    return list.sort((a, b) => b.createdAt - a.createdAt);
  }

  public getAllOrders(): Order[] {
    return Array.from(this.orders.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  public getOrderCount(): number {
    return this.orders.size;
  }

  public getWorkingOrderCount(): number {
    let count = 0;
    for (const symbolMap of this.workingOrdersBySymbol.values()) {
      count += symbolMap.size;
    }
    return count;
  }
}
