/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * SERVER-AUTHORITATIVE POSITION ENGINE
 * Manages open positions, real-time mark-to-market valuation, SL/TP trigger monitoring, and closes.
 */

import { Execution, Position, Quote, SymbolConfig } from '../types/trading';
import { RiskEngine } from './RiskEngine';
import { ExecutionResolver } from './ExecutionResolver';

export interface PositionCloseOutcome {
  closedPosition: Position;
  realizedPnL: number;
  releasedMargin: number;
  closeReason: 'MANUAL' | 'STOP_LOSS' | 'TAKE_PROFIT' | 'STOP_OUT';
  execution: Execution;
}

export class PositionEngine {
  private positions: Map<string, Position> = new Map();
  private nextPositionId: number = 5000;
  private nextExecutionId: number = 8000;

  public openPosition(template: Omit<Position, 'id'>): Position {
    const positionId = `pos_${++this.nextPositionId}`;
    const position: Position = {
      ...template,
      id: positionId,
    };
    this.positions.set(positionId, position);
    return position;
  }

  public getPosition(positionId: string): Position | undefined {
    return this.positions.get(positionId);
  }

  public getPositionsForAccount(accountId: string): Position[] {
    const list: Position[] = [];
    for (const p of this.positions.values()) {
      if (p.accountId === accountId) {
        list.push(p);
      }
    }
    return list.sort((a, b) => b.openedAt - a.openedAt);
  }

  public getOpenPositionsForAccount(accountId: string): Position[] {
    return this.getPositionsForAccount(accountId).filter((p) => p.status === 'OPEN');
  }

  public hydratePositions(positions: Position[]): void {
    for (const p of positions) {
      this.positions.set(p.id, { ...p });
    }
  }

  public getAllOpenPositions(): Position[] {
    const list: Position[] = [];
    for (const p of this.positions.values()) {
      if (p.status === 'OPEN') {
        list.push(p);
      }
    }
    return list;
  }

  public modifySLTP(
    positionId: string,
    stopLoss?: number,
    takeProfit?: number
  ): { success: boolean; position?: Position; error?: string } {
    const pos = this.positions.get(positionId);
    if (!pos || pos.status !== 'OPEN') {
      return { success: false, error: 'Position not found or not open' };
    }

    pos.stopLoss = stopLoss !== undefined ? (isNaN(stopLoss) ? undefined : stopLoss) : pos.stopLoss;
    pos.takeProfit = takeProfit !== undefined ? (isNaN(takeProfit) ? undefined : takeProfit) : pos.takeProfit;

    return { success: true, position: { ...pos } };
  }

  public closePosition(
    positionId: string,
    quote: Quote,
    symbolCfg: SymbolConfig,
    reason: PositionCloseOutcome['closeReason'] = 'MANUAL'
  ): { success: boolean; outcome?: PositionCloseOutcome; error?: string } {
    const pos = this.positions.get(positionId);
    if (!pos || pos.status !== 'OPEN') {
      return { success: false, error: 'Position not found or not open' };
    }

    const now = Date.now();
    const closeSide = pos.side === 'BUY' ? 'SELL' : 'BUY';
    const closePrice = ExecutionResolver.resolvePrice(closeSide, quote);
    const finalPnL = RiskEngine.calculatePositionPnL(
      { side: pos.side, volume: pos.volume, openPrice: pos.openPrice },
      quote,
      symbolCfg.contractSize
    );

    const releasedMargin = pos.marginLocked;

    // Create Authoritative Closing Execution Record
    const execution: Execution = {
      id: `exec_${++this.nextExecutionId}`,
      positionId: pos.id,
      accountId: pos.accountId,
      symbol: pos.symbol,
      side: closeSide,
      type: 'CLOSE',
      volume: pos.volume,
      executionPrice: closePrice,
      commission: 0,
      fee: 0,
      realizedPnL: finalPnL,
      timestamp: now,
    };

    const closedPosition: Position = {
      ...pos,
      currentPrice: closePrice,
      realizedPnL: finalPnL,
      unrealizedPnL: 0,
      marginLocked: 0,
      closedAt: now,
      status: 'CLOSED',
    };

    this.positions.set(positionId, closedPosition);

    return {
      success: true,
      outcome: {
        closedPosition,
        realizedPnL: finalPnL,
        releasedMargin,
        closeReason: reason,
        execution,
      },
    };
  }

  /**
   * Process incoming quote: update open positions on this symbol and trigger SL/TP if crossed.
   */
  public updateMarkPriceAndCheckTriggers(
    symbol: string,
    quote: Quote,
    symbolCfg: SymbolConfig
  ): {
    updatedPositions: Position[];
    triggeredCloses: PositionCloseOutcome[];
  } {
    const updatedPositions: Position[] = [];
    const triggeredCloses: PositionCloseOutcome[] = [];

    for (const pos of this.positions.values()) {
      if (pos.status !== 'OPEN' || pos.symbol !== symbol) continue;

      const currentPrice = pos.side === 'BUY' ? quote.bid : quote.ask;
      const contractSize = symbolCfg.contractSize;

      // 1. Check Stop Loss & Take Profit
      let closeTrigger: 'STOP_LOSS' | 'TAKE_PROFIT' | null = null;

      if (pos.side === 'BUY') {
        if (pos.stopLoss !== undefined && pos.stopLoss > 0 && quote.bid <= pos.stopLoss) {
          closeTrigger = 'STOP_LOSS';
        } else if (pos.takeProfit !== undefined && pos.takeProfit > 0 && quote.bid >= pos.takeProfit) {
          closeTrigger = 'TAKE_PROFIT';
        }
      } else {
        // SELL
        if (pos.stopLoss !== undefined && pos.stopLoss > 0 && quote.ask >= pos.stopLoss) {
          closeTrigger = 'STOP_LOSS';
        } else if (pos.takeProfit !== undefined && pos.takeProfit > 0 && quote.ask <= pos.takeProfit) {
          closeTrigger = 'TAKE_PROFIT';
        }
      }

      if (closeTrigger) {
        const result = this.closePosition(pos.id, quote, symbolCfg, closeTrigger);
        if (result.success && result.outcome) {
          triggeredCloses.push(result.outcome);
        }
      } else {
        // Mark to market
        const pnl = RiskEngine.calculatePositionPnL(
          { side: pos.side, volume: pos.volume, openPrice: pos.openPrice },
          quote,
          contractSize
        );
        pos.currentPrice = currentPrice;
        pos.unrealizedPnL = pnl;
        updatedPositions.push({ ...pos });
      }
    }

    return { updatedPositions, triggeredCloses };
  }

  public getOpenPositionCount(): number {
    let count = 0;
    for (const p of this.positions.values()) {
      if (p.status === 'OPEN') count++;
    }
    return count;
  }
}
