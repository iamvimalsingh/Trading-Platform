/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * SERVER-AUTHORITATIVE EXECUTION PRICE RESOLVER (T3C)
 * Provides deterministic execution pricing:
 * BUY -> Ask
 * SELL -> Bid
 * Serves as clean architectural seam for future slippage/spread modeling.
 */

import { OrderSide, Quote } from '../types/trading';

export class ExecutionResolver {
  /**
   * Resolves the authoritative execution price based on order side and market quote.
   * BUY executes at Ask, SELL executes at Bid.
   * Deterministic zero-slippage default for current simulator.
   */
  public static resolvePrice(side: OrderSide, quote: Quote, slippagePips: number = 0): number {
    const basePrice = side === 'BUY' ? quote.ask : quote.bid;
    // Reserved seam for future slippage modeling
    if (slippagePips !== 0) {
      // Deterministic adjustment if requested
      const delta = side === 'BUY' ? slippagePips : -slippagePips;
      return Number((basePrice + delta).toFixed(5));
    }
    return basePrice;
  }
}
