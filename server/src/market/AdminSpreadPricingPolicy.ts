/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * ADMIN SPREAD PRICING POLICY (STEP 5)
 * Server-authoritative pair-wise spread policy with effective-dating,
 * tenant isolation, and seamless integration into the Step 4 quote pipeline.
 * 
 * Pipeline:
 * RAW PROVIDER QUOTE → NORMALIZATION → [ADMIN SPREAD POLICY] → CLIENT BID/ASK → TRADING ENGINE
 */

import { ClientFacingQuote, ISpreadPricingPolicy, NormalizedInternalQuote } from '../types/marketData';
import { SymbolConfig } from '../types/trading';
import { SpreadConfigRecord } from '../types/admin';

export class AdminSpreadPricingPolicy implements ISpreadPricingPolicy {
  public readonly policyName: string = 'AdminSpreadPricingPolicy';

  // In-memory cache for ultra-low latency quote throughput: tenantId -> symbol -> SpreadConfigRecord[]
  private configsByTenantSymbol: Map<string, SpreadConfigRecord[]> = new Map();

  constructor(initialConfigs?: SpreadConfigRecord[]) {
    if (initialConfigs) {
      for (const cfg of initialConfigs) {
        this.addConfig(cfg);
      }
    }
  }

  private getKey(tenantId: string, symbol: string): string {
    return `${(tenantId || 'tenant_default').trim().toLowerCase()}:${symbol.trim().toUpperCase()}`;
  }

  public addConfig(config: SpreadConfigRecord): void {
    const key = this.getKey(config.tenantId, config.symbol);
    const list = this.configsByTenantSymbol.get(key) || [];
    
    // Replace if same ID exists, else append
    const idx = list.findIndex((c) => c.id === config.id);
    if (idx !== -1) {
      list[idx] = { ...config };
    } else {
      list.push({ ...config });
    }

    // Sort by effectiveFrom descending (newest effective first)
    list.sort((a, b) => b.effectiveFrom - a.effectiveFrom);
    this.configsByTenantSymbol.set(key, list);
  }

  public removeConfig(tenantId: string, configId: string): void {
    for (const [key, list] of this.configsByTenantSymbol.entries()) {
      if (key.startsWith(`${tenantId.toLowerCase()}:`)) {
        const filtered = list.filter((c) => c.id !== configId);
        this.configsByTenantSymbol.set(key, filtered);
      }
    }
  }

  public getActiveConfig(tenantId: string, symbol: string, asOfTime: number = Date.now()): SpreadConfigRecord | undefined {
    const key = this.getKey(tenantId, symbol);
    const list = this.configsByTenantSymbol.get(key);
    if (!list || list.length === 0) {
      // Fallback check for tenant_default if specific tenant has no override
      if (tenantId !== 'tenant_default') {
        const defaultList = this.configsByTenantSymbol.get(this.getKey('tenant_default', symbol));
        if (defaultList) {
          return defaultList.find((c) => c.isActive && c.effectiveFrom <= asOfTime);
        }
      }
      return undefined;
    }

    return list.find((c) => c.isActive && c.effectiveFrom <= asOfTime);
  }

  public getAllConfigs(tenantId?: string): SpreadConfigRecord[] {
    const all: SpreadConfigRecord[] = [];
    for (const [key, list] of this.configsByTenantSymbol.entries()) {
      if (!tenantId || key.startsWith(`${tenantId.toLowerCase()}:`)) {
        all.push(...list);
      }
    }
    return all;
  }

  /**
   * Applies the effective spread configuration to the normalized internal quote.
   * If an active configuration is effective, spreads Bid and Ask symmetrically around normalized Mid.
   * If no configuration is active, preserves raw provider Bid/Ask seamlessly.
   */
  public applyPricing(
    quote: NormalizedInternalQuote,
    symbolCfg: SymbolConfig,
    tenantId: string = 'tenant_default'
  ): ClientFacingQuote {
    const activeCfg = this.getActiveConfig(tenantId, quote.symbol, quote.timestamp || Date.now());

    if (!activeCfg) {
      // Passthrough: Deliver pristine normalized provider pricing
      return {
        symbol: quote.symbol,
        bid: quote.bid,
        ask: quote.ask,
        spread: quote.spread,
        mid: quote.mid,
        high24h: quote.high24h,
        low24h: quote.low24h,
        change24h: quote.change24h,
        change24hPct: quote.change24hPct,
        timestamp: quote.timestamp,
        tickDirection: quote.tickDirection,
        marketStatus: quote.marketStatus,
        source: quote.providerId,
        providerTimestamp: quote.providerTimestamp,
        receivedTimestamp: quote.receivedTimestamp,
        digits: quote.digits,
        tickSize: quote.tickSize,
        sequence: quote.sequence,
      };
    }

    const digits = symbolCfg.digits ?? quote.digits ?? 5;
    const tickSize = symbolCfg.tickSize ?? quote.tickSize ?? Math.pow(10, -digits);
    const mid = quote.mid;

    let totalSpreadPrice: number;

    if (activeCfg.spreadUnit === 'PERCENTAGE') {
      totalSpreadPrice = mid * (activeCfg.spreadPoints / 100);
    } else if (activeCfg.spreadUnit === 'PIPS') {
      const pipMultiplier = digits === 3 || digits === 5 ? 10 * tickSize : tickSize;
      totalSpreadPrice = activeCfg.spreadPoints * pipMultiplier;
    } else {
      // Default: POINTS
      totalSpreadPrice = activeCfg.spreadPoints * tickSize;
    }

    const halfSpread = totalSpreadPrice / 2;
    const bid = Number((mid - halfSpread).toFixed(digits));
    const ask = Number((mid + halfSpread).toFixed(digits));
    const spread = Number((ask - bid).toFixed(digits));

    return {
      symbol: quote.symbol,
      bid,
      ask,
      spread,
      mid,
      high24h: Math.max(ask, quote.high24h),
      low24h: Math.min(bid, quote.low24h),
      change24h: quote.change24h,
      change24hPct: quote.change24hPct,
      timestamp: quote.timestamp,
      tickDirection: quote.tickDirection,
      marketStatus: quote.marketStatus,
      source: `${quote.providerId}:admin_spread`,
      providerTimestamp: quote.providerTimestamp,
      receivedTimestamp: quote.receivedTimestamp,
      digits,
      tickSize,
      sequence: quote.sequence,
    };
  }
}
