/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * SIMULATED ORDER EXECUTION ENGINE (PROJECT B)
 * Deterministic local execution matching without external broker dependency.
 */

import {
  LedgerEntry,
  Order,
  OrderRequest,
  OrderResult,
  Position,
  Quote,
  SymbolConfig,
  TradingAccount,
} from '../types/trading';
import { calculatePositionPnL, calculateRequiredMargin, validatePreTradeRisk } from './riskEngine';

let orderCounter = 1000;
let positionCounter = 5000;
let ledgerCounter = 8000;

export class ExecutionSimulator {
  /**
   * Execute a Market Order against current market quote.
   */
  public static executeOrder(
    request: OrderRequest,
    account: TradingAccount,
    quote: Quote | undefined,
    symbolCfg: SymbolConfig | undefined
  ): OrderResult {
    const now = Date.now();
    orderCounter++;
    const orderId = `ord_${orderCounter}`;
    const clientOrderId = `cli_${now}_${orderCounter}`;

    // Base Order Object
    const baseOrder: Order = {
      id: orderId,
      clientOrderId,
      accountId: account.id,
      symbol: request.symbol,
      side: request.side,
      type: request.type,
      volume: request.volume,
      requestedPrice: quote ? (request.side === 'BUY' ? quote.ask : quote.bid) : 0,
      executionPrice: 0,
      stopLoss: request.stopLoss,
      takeProfit: request.takeProfit,
      status: 'PENDING',
      createdAt: now,
    };

    if (!symbolCfg) {
      return {
        success: false,
        order: { ...baseOrder, status: 'REJECTED', rejectReason: 'Unknown Symbol' },
        error: `Symbol ${request.symbol} is not configured`,
      };
    }

    if (!quote) {
      return {
        success: false,
        order: { ...baseOrder, status: 'REJECTED', rejectReason: 'Off Market - No Quote Available' },
        error: `No live quote available for ${request.symbol}`,
      };
    }

    // Determine Fill Price: BUY executes at Ask, SELL executes at Bid
    const executionPrice = request.side === 'BUY' ? quote.ask : quote.bid;
    const requiredMargin = calculateRequiredMargin(
      request.volume,
      executionPrice,
      symbolCfg.contractSize,
      account.leverage
    );

    // Pre-Trade Risk Verification
    const riskCheck = validatePreTradeRisk(account, requiredMargin, symbolCfg, request.volume);
    if (!riskCheck.valid) {
      return {
        success: false,
        order: {
          ...baseOrder,
          status: 'REJECTED',
          requestedPrice: executionPrice,
          rejectReason: riskCheck.reason,
        },
        error: riskCheck.reason,
      };
    }

    // Fill the Order
    const filledOrder: Order = {
      ...baseOrder,
      status: 'FILLED',
      requestedPrice: executionPrice,
      executionPrice,
      executedAt: now,
    };

    // Instantiate Open Position
    positionCounter++;
    const positionId = `pos_${positionCounter}`;
    const initialPnL = calculatePositionPnL(
      { side: request.side, volume: request.volume, openPrice: executionPrice },
      quote,
      symbolCfg.contractSize
    );

    const position: Position = {
      id: positionId,
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
      success: true,
      order: filledOrder,
      position,
    };
  }

  /**
   * Close an open position at current market price.
   */
  public static closePosition(
    position: Position,
    quote: Quote,
    symbolCfg: SymbolConfig
  ): {
    closedPosition: Position;
    realizedPnL: number;
    releasedMargin: number;
    ledgerEntry: LedgerEntry;
  } {
    const now = Date.now();
    const closePrice = position.side === 'BUY' ? quote.bid : quote.ask;
    const finalPnL = calculatePositionPnL(
      { side: position.side, volume: position.volume, openPrice: position.openPrice },
      quote,
      symbolCfg.contractSize
    );

    const closedPosition: Position = {
      ...position,
      currentPrice: closePrice,
      realizedPnL: finalPnL,
      unrealizedPnL: 0,
      marginLocked: 0,
      closedAt: now,
      status: 'CLOSED',
    };

    ledgerCounter++;
    const ledgerEntry: LedgerEntry = {
      id: `led_${ledgerCounter}`,
      accountId: position.accountId,
      type: 'TRADE_PNL',
      amount: finalPnL,
      balanceAfter: 0, // Populated by state engine
      referenceId: position.id,
      description: `Closed ${position.side} ${position.volume} ${position.symbol} @ ${closePrice} (PnL: $${finalPnL > 0 ? '+' : ''}${finalPnL.toFixed(2)})`,
      createdAt: now,
    };

    return {
      closedPosition,
      realizedPnL: finalPnL,
      releasedMargin: position.marginLocked,
      ledgerEntry,
    };
  }
}
