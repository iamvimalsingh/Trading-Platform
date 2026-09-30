/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * RISK & POSITION CALCULATION ENGINE (CLIENT PREVIEW)
 * Authoritative, pure mathematical calculations for trading risk and margin,
 * mirroring server RiskEngine.
 */

import { OrderSide, Position, Quote, SymbolConfig, TradingAccount } from '../types/trading';

/**
 * Calculate required margin for a position based on leverage, contract size, and currency.
 */
export function calculateRequiredMargin(
  volume: number,
  openPrice: number,
  symbolOrContractSize: SymbolConfig | number | undefined,
  leverage: number,
  accountCurrency: string = 'USD',
  conversionQuotes?: Record<string, Quote>
): number {
  if (leverage <= 0 || volume <= 0 || openPrice <= 0) {
    return 0;
  }

  let symbolCfg: SymbolConfig | undefined;
  let contractSize: number;

  if (typeof symbolOrContractSize === 'object' && symbolOrContractSize !== null) {
    symbolCfg = symbolOrContractSize;
    contractSize = symbolCfg.contractSize;
  } else if (typeof symbolOrContractSize === 'number') {
    contractSize = symbolOrContractSize;
  } else {
    return 0;
  }

  if (!contractSize || contractSize <= 0) {
    return 0;
  }

  const baseCurrency = symbolCfg?.baseCurrency || 'EUR';
  const quoteCurrency = symbolCfg?.quoteCurrency || 'USD';

  let notionalInAccountCurrency: number;

  if (quoteCurrency === accountCurrency) {
    notionalInAccountCurrency = volume * contractSize * openPrice;
  } else if (baseCurrency === accountCurrency) {
    notionalInAccountCurrency = volume * contractSize;
  } else {
    const baseToAccountSymbol = `${baseCurrency}${accountCurrency}`;
    const quoteToAccountSymbol = `${quoteCurrency}${accountCurrency}`;

    if (conversionQuotes && conversionQuotes[baseToAccountSymbol]) {
      const baseQuote = conversionQuotes[baseToAccountSymbol];
      notionalInAccountCurrency = volume * contractSize * baseQuote.mid;
    } else if (conversionQuotes && conversionQuotes[quoteToAccountSymbol]) {
      const quoteQuote = conversionQuotes[quoteToAccountSymbol];
      const notionalInQuoteCurrency = volume * contractSize * openPrice;
      notionalInAccountCurrency = notionalInQuoteCurrency * quoteQuote.mid;
    } else {
      notionalInAccountCurrency = volume * contractSize * openPrice;
    }
  }

  const margin = notionalInAccountCurrency / leverage;
  return Math.round((margin + 1e-7) * 100) / 100;
}

/**
 * Calculate unrealized P/L for a position given current market quote.
 */
export function calculatePositionPnL(
  position: Pick<Position, 'side' | 'volume' | 'openPrice'> & { symbol?: string },
  quote: Pick<Quote, 'bid' | 'ask'>,
  contractSize: number,
  symbolCfg?: SymbolConfig,
  accountCurrency: string = 'USD',
  quotes?: Record<string, Quote>
): number {
  const currentPrice = position.side === 'BUY' ? quote.bid : quote.ask;
  const priceDiff = position.side === 'BUY' 
    ? (currentPrice - position.openPrice)
    : (position.openPrice - currentPrice);

  let rawPnL = priceDiff * position.volume * contractSize;

  if (symbolCfg && symbolCfg.quoteCurrency && symbolCfg.quoteCurrency !== accountCurrency) {
    if (symbolCfg.baseCurrency === accountCurrency) {
      if (currentPrice > 0) {
        rawPnL = rawPnL / currentPrice;
      }
    } else if (quotes) {
      const quoteToAccSymbol = `${symbolCfg.quoteCurrency}${accountCurrency}`;
      if (quotes[quoteToAccSymbol]) {
        rawPnL = rawPnL * quotes[quoteToAccSymbol].mid;
      }
    }
  }

  return Number(rawPnL.toFixed(2));
}

/**
 * Recalculate full account state based on current open positions and latest quotes.
 */
export function recalculateAccountState(
  account: TradingAccount,
  positions: Position[],
  quotes: Record<string, Quote>,
  symbols: Record<string, SymbolConfig>
): {
  equity: number;
  usedMargin: number;
  freeMargin: number;
  marginLevel: number;
  totalUnrealizedPnL: number;
  isMarginCall: boolean;
  isStopOut: boolean;
} {
  let totalUnrealizedPnL = 0;
  let totalUsedMargin = 0;

  for (const pos of positions) {
    if (pos.status !== 'OPEN') continue;

    const quote = quotes[pos.symbol];
    const symbolCfg = symbols[pos.symbol];

    if (!symbolCfg || symbolCfg.contractSize <= 0) {
      continue;
    }
    const contractSize = symbolCfg.contractSize;

    if (quote) {
      const pnl = calculatePositionPnL(pos, quote, contractSize, symbolCfg, account.currency, quotes);
      totalUnrealizedPnL += pnl;
    } else {
      totalUnrealizedPnL += pos.unrealizedPnL;
    }

    totalUsedMargin += pos.marginLocked;
  }

  totalUnrealizedPnL = Number(totalUnrealizedPnL.toFixed(2));
  totalUsedMargin = Number(totalUsedMargin.toFixed(2));
  
  const equity = Number((account.balance + totalUnrealizedPnL).toFixed(2));
  const freeMargin = Number((equity - totalUsedMargin).toFixed(2));
  
  const marginLevel = totalUsedMargin > 0 
    ? Number(((equity / totalUsedMargin) * 100).toFixed(2))
    : 0;

  const isMarginCall = totalUsedMargin > 0 && marginLevel <= account.marginCallLevel;
  const isStopOut = totalUsedMargin > 0 && marginLevel <= account.stopOutLevel;

  return {
    equity,
    usedMargin: totalUsedMargin,
    freeMargin,
    marginLevel,
    totalUnrealizedPnL,
    isMarginCall,
    isStopOut,
  };
}

/**
 * Validate whether an account has sufficient free margin to open a proposed order.
 */
export function validatePreTradeRisk(
  account: TradingAccount,
  requiredMargin: number,
  symbolCfg: SymbolConfig | undefined,
  volume: number
): { valid: boolean; reason?: string } {
  if (account.status !== 'ACTIVE') {
    return { valid: false, reason: `Account is currently ${account.status}` };
  }

  if (!symbolCfg) {
    return { valid: false, reason: 'Unknown symbol configuration' };
  }

  if (symbolCfg.contractSize <= 0) {
    return { valid: false, reason: `Invalid symbol contract size (${symbolCfg.contractSize})` };
  }

  if (account.leverage <= 0) {
    return { valid: false, reason: `Invalid account leverage (${account.leverage})` };
  }

  if (volume < symbolCfg.minVolume) {
    return { valid: false, reason: `Volume ${volume} is below minimum allowed (${symbolCfg.minVolume})` };
  }

  if (volume > symbolCfg.maxVolume) {
    return { valid: false, reason: `Volume ${volume} exceeds maximum allowed (${symbolCfg.maxVolume})` };
  }

  if (requiredMargin <= 0) {
    return { valid: false, reason: 'Calculated required margin must be greater than zero' };
  }

  if (requiredMargin > account.freeMargin) {
    return { 
      valid: false, 
      reason: `Insufficient Free Margin: Required $${requiredMargin.toFixed(2)}, Available $${account.freeMargin.toFixed(2)}` 
    };
  }

  return { valid: true };
}
