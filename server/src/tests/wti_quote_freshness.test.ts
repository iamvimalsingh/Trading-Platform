/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * WTI/USD REST FALLBACK QUOTE FRESHNESS & ORDER EXECUTION REGRESSION TESTS
 * Validates deterministic freshness calculation, separated polling/stale thresholds,
 * exact-once epoch timestamp normalization, stale order rejection, and fresh recovery.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { TwelveDataMarketDataAdapter } from '../market/TwelveDataMarketDataAdapter';
import { MarketDataRouter } from '../market/MarketDataRouter';
import { OrderEngine } from '../trading/OrderEngine';
import { AccountRegistry } from '../runtime/AccountRegistry';
import { InstrumentRegistry } from '../market/InstrumentRegistry';
import { NormalizedInternalQuote } from '../types/marketData';
import { OrderRequest, Quote } from '../types/trading';

describe('WTI/USD REST Fallback Quote Freshness & Order Execution Suite', () => {
  const accountRegistry = new AccountRegistry();
  const testAccount = accountRegistry.getAccount('acc_demo_1001')!;
  const orderEngine = new OrderEngine((accId) => accountRegistry.getAccount(accId));
  const instrumentRegistry = InstrumentRegistry.getInstance();
  const wtiConfig = instrumentRegistry.getSymbol('WTIUSD')!;

  // Test 1: WTI REST Quote Normalization & Exact-Once Epoch Conversion
  it('1. Normalizes WTI/USD REST quote with exact-once epoch-second to ms conversion', () => {
    const adapter = new TwelveDataMarketDataAdapter({
      apiKey: 'test_key_dummy',
      staleThresholdMs: 15000,
      restStaleThresholdMs: 45000,
      restPollIntervalMs: 15000,
    });

    const receivedQuotes: NormalizedInternalQuote[] = [];
    adapter.onQuote((q) => receivedQuotes.push(q));

    // Simulate raw Twelve Data price event with timestamp in epoch seconds (e.g. 1728135776 = ~2024-10-05)
    const rawEpochSec = 1728135776;
    (adapter as any).processPriceEvent({
      event: 'price',
      symbol: 'WTI/USD',
      price: 72.50,
      bid: 72.48,
      ask: 72.52,
      timestamp: rawEpochSec,
    });

    assert.strictEqual(receivedQuotes.length, 1, 'Received 1 normalized quote');
    const q = receivedQuotes[0];
    assert.strictEqual(q.symbol, 'WTIUSD', 'Mapped to canonical WTIUSD');
    assert.strictEqual(q.digits, 2, 'WTIUSD digits is 2');
    assert.strictEqual(q.bid, 72.48, 'Bid price formatted correctly');
    assert.strictEqual(q.ask, 72.52, 'Ask price formatted correctly');
    assert.strictEqual(q.mid, 72.50, 'Mid price computed correctly');
    assert.strictEqual(q.timestamp, rawEpochSec * 1000, 'Epoch seconds converted exactly once to milliseconds');
    assert.strictEqual(q.providerTimestamp, rawEpochSec * 1000, 'Provider timestamp matches normalized epoch ms');
    assert(q.receivedTimestamp > 0, 'Server receivedTimestamp is set');
    assert.strictEqual(q.marketStatus, 'LIVE', 'Market status is LIVE on initial arrival');
  });

  // Test 2: Separated Polling Cadence and 45s Stale Threshold
  it('2. Separates 15s REST polling cadence from 45s stale threshold (does not mark stale at 20s)', () => {
    const adapter = new TwelveDataMarketDataAdapter({
      apiKey: 'test_key_dummy',
      staleThresholdMs: 15000,
      restStaleThresholdMs: 45000,
      restPollIntervalMs: 15000,
    });

    // Mark WTIUSD as unsupported on WebSocket (forces REST fallback threshold)
    (adapter as any).unsupportedWebSocketSymbols.add('WTIUSD');
    assert.strictEqual(adapter.getStaleThresholdForSymbol('WTIUSD'), 45000, 'WTIUSD uses 45000ms stale threshold');

    const now = Date.now();
    // Simulate quote received 20 seconds ago (exceeds 15s poll interval, but well within 45s threshold)
    const initialQuote: NormalizedInternalQuote = {
      symbol: 'WTIUSD',
      bid: 71.80,
      ask: 71.84,
      mid: 71.82,
      spread: 4.0,
      timestamp: now - 20000,
      providerTimestamp: now - 20000,
      receivedTimestamp: now - 20000,
      marketStatus: 'LIVE',
      providerId: 'twelve_data',
      assetClass: 'COMMODITIES',
      digits: 2,
      tickSize: 0.01,
      tickDirection: 'FLAT',
      high24h: 73.0,
      low24h: 70.0,
      change24h: 0,
      change24hPct: 0,
    };
    (adapter as any).quotes.set('WTIUSD', initialQuote);

    // Run stale check
    (adapter as any).checkStale();

    const currentQuote = adapter.getQuote('WTIUSD');
    assert.strictEqual(currentQuote?.marketStatus, 'LIVE', 'WTIUSD remains LIVE at 20s age (safe from false STALE)');
  });

  // Test 3: Delayed REST Response Beyond 45s Marks Stale
  it('3. Marks WTI/USD STALE when quote age exceeds 45s threshold', () => {
    const adapter = new TwelveDataMarketDataAdapter({
      apiKey: 'test_key_dummy',
      staleThresholdMs: 15000,
      restStaleThresholdMs: 45000,
      restPollIntervalMs: 15000,
    });

    (adapter as any).unsupportedWebSocketSymbols.add('WTIUSD');

    const now = Date.now();
    // Simulate quote received 50 seconds ago (exceeds 45s threshold)
    const agedQuote: NormalizedInternalQuote = {
      symbol: 'WTIUSD',
      bid: 71.80,
      ask: 71.84,
      mid: 71.82,
      spread: 4.0,
      timestamp: now - 50000,
      providerTimestamp: now - 50000,
      receivedTimestamp: now - 50000,
      marketStatus: 'LIVE',
      providerId: 'twelve_data',
      assetClass: 'COMMODITIES',
      digits: 2,
      tickSize: 0.01,
      tickDirection: 'FLAT',
      high24h: 73.0,
      low24h: 70.0,
      change24h: 0,
      change24hPct: 0,
    };
    (adapter as any).quotes.set('WTIUSD', agedQuote);

    // Run stale check
    (adapter as any).checkStale();

    const checked = adapter.getQuote('WTIUSD');
    assert.strictEqual(checked?.marketStatus, 'STALE', 'WTIUSD transitions to STALE after 50s without ticks');
  });

  // Test 4: New Successful REST Quote Clears STALE State
  it('4. Clears STALE state and broadcasts fresh LIVE quote upon successful REST update', () => {
    const adapter = new TwelveDataMarketDataAdapter({
      apiKey: 'test_key_dummy',
      staleThresholdMs: 15000,
      restStaleThresholdMs: 45000,
      restPollIntervalMs: 15000,
    });

    const emitted: NormalizedInternalQuote[] = [];
    adapter.onQuote((q) => emitted.push(q));

    // Initially in STALE state
    const staleQuote: NormalizedInternalQuote = {
      symbol: 'WTIUSD',
      bid: 71.80,
      ask: 71.84,
      mid: 71.82,
      spread: 4.0,
      timestamp: Date.now() - 60000,
      providerTimestamp: Date.now() - 60000,
      receivedTimestamp: Date.now() - 60000,
      marketStatus: 'STALE',
      providerId: 'twelve_data',
      assetClass: 'COMMODITIES',
      digits: 2,
      tickSize: 0.01,
      tickDirection: 'FLAT',
      high24h: 73.0,
      low24h: 70.0,
      change24h: 0,
      change24hPct: 0,
    };
    (adapter as any).quotes.set('WTIUSD', staleQuote);

    // Now a fresh REST poll succeeds
    const freshTimestamp = Date.now();
    (adapter as any).applyRestPrice('WTIUSD', 72.10, freshTimestamp);

    const refreshed = adapter.getQuote('WTIUSD');
    assert.strictEqual(refreshed?.marketStatus, 'LIVE', 'Status returned to LIVE');
    assert.strictEqual(refreshed?.mid, 72.10, 'Mid price updated to 72.10');
    assert(emitted.some((q) => q.symbol === 'WTIUSD' && q.marketStatus === 'LIVE'), 'Emitted fresh LIVE quote to listeners');
  });

  // Test 5: OrderEngine Rejects Execution Against STALE WTI Quote
  it('5. OrderEngine strictly blocks market execution when WTIUSD quote is STALE', () => {
    const staleQuote: Quote = {
      symbol: 'WTIUSD',
      bid: 71.80,
      ask: 71.84,
      mid: 71.82,
      spread: 4.0,
      high24h: 73.0,
      low24h: 70.0,
      change24h: 0,
      change24hPct: 0,
      timestamp: Date.now() - 60000,
      receivedTimestamp: Date.now() - 60000,
      tickDirection: 'FLAT',
      marketStatus: 'STALE',
      source: 'twelve_data',
    };

    const orderReq: OrderRequest = {
      accountId: testAccount.id,
      symbol: 'WTIUSD',
      side: 'BUY',
      type: 'MARKET',
      volume: 1.0,
    };

    const execution = orderEngine.executeMarketOrder(orderReq, testAccount, staleQuote, wtiConfig);
    assert.strictEqual(execution.result.success, false, 'Order execution must fail against STALE quote');
    assert(execution.result.error?.includes('STALE'), `Error message mentions STALE (got "${execution.result.error}")`);
    assert.strictEqual(execution.result.order?.status, 'REJECTED', 'Order status set to REJECTED');
  });

  // Test 6: OrderEngine Executes Market Order When WTI Quote is LIVE
  it('6. OrderEngine permits market order execution when WTIUSD quote is fresh LIVE', () => {
    const liveQuote: Quote = {
      symbol: 'WTIUSD',
      bid: 71.80,
      ask: 71.84,
      mid: 71.82,
      spread: 4.0,
      high24h: 73.0,
      low24h: 70.0,
      change24h: 0,
      change24hPct: 0,
      timestamp: Date.now(),
      receivedTimestamp: Date.now(),
      tickDirection: 'FLAT',
      marketStatus: 'LIVE',
      source: 'twelve_data',
    };

    const orderReq: OrderRequest = {
      accountId: testAccount.id,
      symbol: 'WTIUSD',
      side: 'BUY',
      type: 'MARKET',
      volume: 0.1,
    };

    const execution = orderEngine.executeMarketOrder(orderReq, testAccount, liveQuote, wtiConfig);
    assert.strictEqual(execution.result.success, true, 'Order executes successfully on LIVE quote');
    assert.strictEqual(execution.result.order?.status, 'FILLED', 'Order status is FILLED');
    assert.strictEqual(execution.result.order?.executionPrice, 71.84, 'BUY fills at ask price 71.84');
  });

  // Test 7: MarketDataRouter End-to-End WTI Freshness Integration
  it('7. MarketDataRouter routes WTI/USD quotes with 45s commodity threshold and updates status', () => {
    const twelveAdapter = new TwelveDataMarketDataAdapter({
      apiKey: '',
      staleThresholdMs: 15000,
      restStaleThresholdMs: 45000,
    });

    const router = new MarketDataRouter({
      twelveDataAdapter: twelveAdapter,
      isRealMarketData: true,
      categoryStaleThresholds: {
        FOREX: 15000,
        CRYPTO: 30000,
        COMMODITIES: 45000,
      },
    });
    router.start();

    assert.strictEqual(router.getStaleThresholdForSymbol('WTIUSD'), 45000, 'Router assigns 45000ms to WTIUSD');
    assert.strictEqual(router.getStaleThresholdForSymbol('EURUSD'), 15000, 'Router assigns 15000ms to EURUSD');

    const now = Date.now();
    (twelveAdapter as any).applyRestPrice('WTIUSD', 72.00, now);

    const quote = router.getQuote('WTIUSD');
    assert.strictEqual(quote?.symbol, 'WTIUSD');
    assert.strictEqual(quote?.marketStatus, 'LIVE');
    assert.strictEqual(quote?.mid, 72.00);
    router.stop();
  });

  // Test 8: Missing Twelve Data API Key Produces Explicit Warning
  it('8. Emits explicit backend diagnostic warning when TWELVE_DATA_API_KEY is missing', () => {
    const savedKey = process.env.TWELVE_DATA_API_KEY;
    delete process.env.TWELVE_DATA_API_KEY;

    let warningEmitted = false;
    const originalWarn = console.warn;
    console.warn = (...args: any[]) => {
      if (args.some((a) => typeof a === 'string' && a.includes('TWELVE_DATA_API_KEY is not configured'))) {
        warningEmitted = true;
      }
      originalWarn.apply(console, args);
    };

    try {
      const adapter = new TwelveDataMarketDataAdapter({ apiKey: '' });
      adapter.start();
      assert.strictEqual(adapter.isKeyConfigured(), false, 'Key identified as not configured');
      assert.strictEqual(warningEmitted, true, 'Explicit diagnostic warning was emitted');
    } finally {
      console.warn = originalWarn;
      if (savedKey) process.env.TWELVE_DATA_API_KEY = savedKey;
    }
  });

  // Test 9: WebSocket Quote Broadcast After WTI Refresh
  it('9. Dispatches WebSocket batch update to subscribers when WTI quote updates', () => {
    const twelveAdapter = new TwelveDataMarketDataAdapter({
      apiKey: '',
      staleThresholdMs: 15000,
      restStaleThresholdMs: 45000,
    });

    const router = new MarketDataRouter({
      twelveDataAdapter: twelveAdapter,
      isRealMarketData: true,
      categoryStaleThresholds: {
        FOREX: 15000,
        CRYPTO: 30000,
        COMMODITIES: 45000,
      },
    });
    router.start();

    const dispatchedBatches: Record<string, Quote>[] = [];
    router.subscribe((batch) => {
      dispatchedBatches.push(batch);
    });

    const now = Date.now();
    (twelveAdapter as any).applyRestPrice('WTIUSD', 72.35, now);

    assert(dispatchedBatches.length > 0, 'Dispatched at least one batch update');
    const lastBatch = dispatchedBatches[dispatchedBatches.length - 1];
    assert(lastBatch['WTIUSD'] !== undefined, 'Batch contains WTIUSD update');
    assert.strictEqual(lastBatch['WTIUSD'].mid, 72.35, 'WTIUSD mid price matches 72.35');
    assert.strictEqual(lastBatch['WTIUSD'].marketStatus, 'LIVE', 'WTIUSD market status is LIVE in broadcast');
    router.stop();
  });

  // Test 10: EURUSD WebSocket Path Remains Unchanged & Healthy
  it('10. Confirms EURUSD / Forex streaming path retains 15s fast threshold and unaffected by WTI REST configuration', () => {
    const router = new MarketDataRouter({
      isRealMarketData: true,
      categoryStaleThresholds: {
        FOREX: 15000,
        CRYPTO: 30000,
        COMMODITIES: 45000,
      },
    });

    assert.strictEqual(router.getStaleThresholdForSymbol('EURUSD'), 15000, 'EURUSD retains 15000ms threshold');
    assert.strictEqual(router.getStaleThresholdForSymbol('GBPUSD'), 15000, 'GBPUSD retains 15000ms threshold');
    assert.strictEqual(router.getStaleThresholdForSymbol('BTCUSD'), 30000, 'BTCUSD retains 30000ms threshold');
    assert.strictEqual(router.getStaleThresholdForSymbol('WTIUSD'), 45000, 'WTIUSD has 45000ms REST-fallback threshold');
  });
});
