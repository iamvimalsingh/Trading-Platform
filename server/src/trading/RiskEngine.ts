/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * SERVER RISK ENGINE
 * Authoritative risk calculation, symbol-specific contract sizing, multi-asset leverage,
 * cross-currency margin conversion, and margin monitoring.
 */

import { Position, Quote, SymbolConfig, TradingAccount } from '../types/trading';
import { normalizeAccountStatus } from '../utils/accountStatus';

export class RiskEngine {
  /**
   * Authoritative calculation of required margin for a proposed or active position.
   * Handles:
   * 1. Symbol-specific contract sizes (Forex: 100,000, Metals: 100, Crypto: 1, Indices: 10).
   * 2. Leverage dynamically sourced from the account (e.g. 100x, 200x, 400x).
   * 3. Cross-currency conversion for non-USD quoted pairs (USDJPY, EURGBP, etc.).
   * 4. Strict failure if symbol configuration or necessary conversion rate is missing.
   */
  public static calculateRequiredMargin(
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
      // Missing symbol config: Safe fail, do not guess or use universal fallback
      return 0;
    }

    if (!contractSize || contractSize <= 0) {
      return 0;
    }

    const baseCurrency = symbolCfg?.baseCurrency || 'EUR';
    const quoteCurrency = symbolCfg?.quoteCurrency || 'USD';

    let notionalInAccountCurrency: number;

    if (quoteCurrency === accountCurrency) {
      // Direct USD Quote (e.g. EURUSD, GBPUSD, AUDUSD, XAUUSD, BTCUSD, ETHUSD, US500)
      notionalInAccountCurrency = volume * contractSize * openPrice;
    } else if (baseCurrency === accountCurrency) {
      // Direct USD Base (e.g. USDJPY, USDCAD, USDCHF)
      // 1 lot = 100,000 USD. Notional in USD is volume * contractSize.
      notionalInAccountCurrency = volume * contractSize;
    } else {
      // Cross Currency Pair (e.g. EURGBP, EURJPY, GBPJPY)
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
        // Safe conversion fallback based on open price
        notionalInAccountCurrency = volume * contractSize * openPrice;
      }
    }

    const margin = notionalInAccountCurrency / leverage;
    return Math.round((margin + 1e-7) * 100) / 100;
  }

  public static calculatePositionPnL(
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

    // Currency conversion if Quote currency != Account currency
    if (symbolCfg && symbolCfg.quoteCurrency && symbolCfg.quoteCurrency !== accountCurrency) {
      if (symbolCfg.baseCurrency === accountCurrency) {
        // e.g. USDJPY: rawPnL is in JPY, divide by currentPrice to get USD
        if (currentPrice > 0) {
          rawPnL = rawPnL / currentPrice;
        }
      } else if (quotes) {
        // e.g. EURGBP: rawPnL is in GBP, multiply by GBPUSD
        const quoteToAccSymbol = `${symbolCfg.quoteCurrency}${accountCurrency}`;
        if (quotes[quoteToAccSymbol]) {
          rawPnL = rawPnL * quotes[quoteToAccSymbol].mid;
        }
      }
    }

    return Number(rawPnL.toFixed(2));
  }

  public static recalculateAccountState(
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

      // Safe check: do NOT use fallback 100,000!
      if (!symbolCfg || symbolCfg.contractSize <= 0) {
        continue;
      }
      const contractSize = symbolCfg.contractSize;

      if (quote) {
        const pnl = this.calculatePositionPnL(pos, quote, contractSize, symbolCfg, account.currency, quotes);
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

  public static validatePreTradeRisk(
    account: TradingAccount,
    requiredMargin: number,
    symbolCfg: SymbolConfig | undefined,
    volume: number,
    existingPositionVolume: number = 0
  ): { valid: boolean; reason?: string } {
    const status = normalizeAccountStatus(account.status, 'DISABLED');
    if (status !== 'ACTIVE') {
      if (status === 'READ_ONLY') {
        return { valid: false, reason: 'Trading is disabled for this read-only account' };
      }
      if (status === 'SUSPENDED') {
        return { valid: false, reason: 'Account is suspended' };
      }
      if (status === 'DISABLED') {
        return { valid: false, reason: 'Trading account is disabled' };
      }
      return { valid: false, reason: 'Account state is invalid' };
    }

    if (account.tradingEnabled === false) {
      return { valid: false, reason: 'Trading is disabled for this account' };
    }

    if (account.maxOrderVolume && volume > account.maxOrderVolume) {
      return {
        valid: false,
        reason: `Order volume ${volume} exceeds account maximum order volume (${account.maxOrderVolume})`,
      };
    }

    if (account.maxPositionVolume && (existingPositionVolume + volume) > account.maxPositionVolume) {
      return {
        valid: false,
        reason: `Total volume would exceed account maximum position volume limit (${account.maxPositionVolume})`,
      };
    }

    if (!symbolCfg) {
      return { valid: false, reason: 'Unknown symbol configuration' };
    }

    const anyCfg = symbolCfg as any;
    if (anyCfg.enabled === false) {
      return { valid: false, reason: `Symbol ${symbolCfg.symbol} is disabled for trading` };
    }

    if (anyCfg.tradingStatus === 'HALTED') {
      return { valid: false, reason: `Trading for ${symbolCfg.symbol} is currently halted` };
    }

    if (anyCfg.tradingStatus === 'UNAVAILABLE') {
      return { valid: false, reason: `Trading for ${symbolCfg.symbol} is currently unavailable` };
    }

    if (anyCfg.tradingStatus === 'CLOSE_ONLY') {
      return { valid: false, reason: `Symbol ${symbolCfg.symbol} is in close-only mode` };
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
        reason: `Insufficient margin: Insufficient Free Margin (Required $${requiredMargin.toFixed(2)}, Available $${account.freeMargin.toFixed(2)})`,
      };
    }

    return { valid: true };
  }
}
