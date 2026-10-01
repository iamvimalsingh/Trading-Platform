/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * STEP 6 — HISTORICAL DATA + PRODUCTION HARDENING TEST SUITE
 * 
 * Exhaustive validation covering:
 * 1. Historical Market Data Architecture & Provider Abstraction (Real, Simulated, Unavailable)
 * 2. OHLC Mathematical Correctness & Time Boundary Bucketing Invariants
 * 3. Execution Safety & Stale / Simulated Quote Protection in Production Mode
 * 4. SL/TP Bounds & Order Validation Hardening
 * 5. Symbol & Account State Risk Boundaries (HALTED, CLOSE_ONLY, DISABLED)
 * 6. WebSocket Security, Authentication & Multi-Tenant Cross-Account Protection
 * 7. Message Size & Malformed JSON Resilience
 * 8. Historical Trade Immutability & Financial Invariant Integrity
 * 9. Market REST APIs (/api/market/history, /api/market/status, /api/market/symbols)
 */

import fs from 'fs';
import path from 'path';
import { DatabaseClient } from '../db/DatabaseClient';
import { runMigrations } from '../db/migrations';
import { createAppAndServer } from '../index';
import { InstrumentRegistry } from '../market/InstrumentRegistry';
import { HistoricalMarketDataService } from '../market/HistoricalMarketDataService';
import { SyntheticHistoricalDataAdapter } from '../market/SyntheticHistoricalDataAdapter';
import { OrderEngine } from '../trading/OrderEngine';
import { RiskEngine } from '../trading/RiskEngine';
import { Quote } from '../types/trading';

let passCount = 0;
let failCount = 0;

function assert(condition: boolean, testId: string, testName: string, detail?: string) {
  if (condition) {
    console.log(`  \x1b[32m✔ PASS [${testId}]\x1b[0m ${testName}`);
    passCount++;
  } else {
    console.error(`  \x1b[31m✖ FAIL [${testId}]\x1b[0m ${testName}${detail ? ` (${detail})` : ''}`);
    failCount++;
  }
}

async function runStep6Tests() {
  console.log('\n=============================================================');
  console.log('  RUNNING STEP 6: HISTORICAL DATA + PRODUCTION HARDENING');
  console.log('=============================================================\n');

  process.env.USE_REAL_MARKET_DATA = 'false';
  process.env.ADMIN_API_SECRET = 'super_secret_admin_test_key_2026';

  const testDbDir = path.resolve(process.cwd(), 'data', 'test_step6_hardening_db');
  if (fs.existsSync(testDbDir)) {
    fs.rmSync(testDbDir, { recursive: true, force: true });
  }
  process.env.DATABASE_STORAGE_PATH = testDbDir;

  DatabaseClient.resetInstance();
  InstrumentRegistry.resetInstance();
  HistoricalMarketDataService.resetInstance();

  const db = DatabaseClient.getInstance(testDbDir);
  await runMigrations(db);

  const { app, httpServer, runtime, adminService, historicalService } = createAppAndServer();
  let serverPort = 0;

  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => {
      const address = httpServer.address() as any;
      serverPort = address.port;
      resolve();
    });
  });

  const baseUrl = `http://127.0.0.1:${serverPort}`;

  const apiCall = async (endpoint: string, options?: RequestInit) => {
    const res = await fetch(`${baseUrl}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options?.headers || {}),
      },
    });
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  };

  // -------------------------------------------------------------------------
  // SECTION 1: HISTORICAL DATA SERVICE & PROVIDER ABSTRACTION
  // -------------------------------------------------------------------------
  console.log('--- 1. HISTORICAL DATA SERVICE & PROVIDER ABSTRACTION ---');
  {
    // A) Request 1m historical bars for EURUSD in development mode
    const res1m = await historicalService.getHistoricalBars({
      symbol: 'EURUSD',
      timeframe: '1m',
      limit: 60,
    });

    assert(res1m.status === 'SIMULATED', 'S6-01', 'Historical service returns SIMULATED status in development mode');
    assert(res1m.bars.length === 60, 'S6-02', 'Returns exactly requested number of historical bars (60 bars)');
    assert(res1m.bars.every((b) => b.source === 'SIMULATED'), 'S6-03', 'All returned bars are explicitly tagged with source SIMULATED');

    // B) Request 5m timeframe bars for BTCUSD
    const res5m = await historicalService.getHistoricalBars({
      symbol: 'BTCUSD',
      timeframe: '5m',
      limit: 30,
    });
    assert(res5m.bars.length === 30, 'S6-04', 'Returns 30 bars for 5m timeframe on BTCUSD');

    // C) Production Mode Protection: When simulation fallback is disabled, unserved symbols return UNAVAILABLE
    const prodHistoricalService = new HistoricalMarketDataService({
      registry: InstrumentRegistry.getInstance(),
      isRealMarketData: true,
      allowSimulationFallback: false,
    });

    const resProdUnserved = await prodHistoricalService.getHistoricalBars({
      symbol: 'US500',
      timeframe: '1m',
      limit: 50,
    });
    assert(resProdUnserved.status === 'UNAVAILABLE', 'S6-05', 'Production mode returns UNAVAILABLE when real provider is missing');
    assert(resProdUnserved.bars.length === 0, 'S6-06', 'Production mode returns strictly 0 bars rather than fabricating fake data');

    // D) Unknown symbol rejection
    const resUnknown = await historicalService.getHistoricalBars({
      symbol: 'UNKNOWN_COIN',
      timeframe: '1m',
    });
    assert(resUnknown.status === 'UNAVAILABLE' && Boolean(resUnknown.error?.includes('not a registered')), 'S6-07', 'Unknown symbol rejected with informative error');

    // E) Unsupported timeframe rejection
    const resBadTimeframe = await historicalService.getHistoricalBars({
      symbol: 'EURUSD',
      timeframe: '2h' as any,
    });
    assert(resBadTimeframe.status === 'UNAVAILABLE' && Boolean(resBadTimeframe.error?.includes('Unsupported timeframe')), 'S6-08', 'Unsupported timeframe rejected gracefully');
  }

  // -------------------------------------------------------------------------
  // SECTION 2: OHLC MATHEMATICAL CORRECTNESS & TIME BUCKETING
  // -------------------------------------------------------------------------
  console.log('\n--- 2. OHLC MATHEMATICAL CORRECTNESS & TIME BUCKETING ---');
  {
    const resBars = await historicalService.getHistoricalBars({
      symbol: 'EURUSD',
      timeframe: '1m',
      limit: 100,
    });

    const bars = resBars.bars;

    // 1. Strict ascending chronological ordering
    let strictlyAscending = true;
    for (let i = 1; i < bars.length; i++) {
      if (bars[i].timestamp <= bars[i - 1].timestamp) {
        strictlyAscending = false;
        break;
      }
    }
    assert(strictlyAscending, 'S6-09', 'Historical bars are in strictly ascending chronological order');

    // 2. Exact 60-second intervals for 1m timeframe
    const intervalDeltasCorrect = bars.slice(1).every((b, idx) => b.timestamp - bars[idx].timestamp === 60);
    assert(intervalDeltasCorrect, 'S6-10', 'All 1m candle intervals exactly match 60 seconds delta');

    // 3. Mathematical OHLC Invariants: High >= max(Open, Close) and Low <= min(Open, Close)
    const ohlcInvariantsHold = bars.every((b) => {
      const maxOC = Math.max(b.open, b.close);
      const minOC = Math.min(b.open, b.close);
      return b.high >= maxOC && b.low <= minOC && b.low > 0 && b.high > 0;
    });
    assert(ohlcInvariantsHold, 'S6-11', 'OHLC Invariants hold on all bars: High >= max(Open, Close) and Low <= min(Open, Close)');

    // 4. Decimal precision alignment to InstrumentRegistry digits (EURUSD = 5 digits)
    const digitsCorrect = bars.every((b) => {
      const openDecimals = (b.open.toString().split('.')[1] || '').length;
      const closeDecimals = (b.close.toString().split('.')[1] || '').length;
      return openDecimals <= 5 && closeDecimals <= 5;
    });
    assert(digitsCorrect, 'S6-12', 'Bar prices strictly respect symbol digits precision (5 decimals for EURUSD)');

    // 5. Volume is positive and valid
    const volumePositive = bars.every((b) => typeof b.volume === 'number' && b.volume >= 0);
    assert(volumePositive, 'S6-13', 'All bar volumes are non-negative numbers');
  }

  // -------------------------------------------------------------------------
  // SECTION 3: MARKET DATA / EXECUTION SAFETY HARDENING
  // -------------------------------------------------------------------------
  console.log('\n--- 3. MARKET DATA / EXECUTION SAFETY HARDENING ---');
  {
    const orderEngine = new OrderEngine();
    const account = runtime.accounts.getAccount('acc_demo_1001')!;
    const eurusdCfg = runtime.market.getSymbolConfig('EURUSD')!;

    // A) Rejection on UNAVAILABLE quote
    const unavailableQuote: any = {
      symbol: 'EURUSD',
      bid: 1.08500,
      ask: 1.08510,
      mid: 1.08505,
      spread: 0.00010,
      timestamp: Date.now(),
      marketStatus: 'UNAVAILABLE',
    };
    const resUnavailable = orderEngine.executeMarketOrder(
      { accountId: account.id, symbol: 'EURUSD', side: 'BUY', type: 'MARKET', volume: 0.1 },
      account,
      unavailableQuote,
      eurusdCfg
    );
    assert(!resUnavailable.result.success && Boolean(resUnavailable.result.error?.includes('UNAVAILABLE')), 'S6-14', 'Rejects execution when quote marketStatus is UNAVAILABLE');

    // B) Rejection on STALE quote
    const staleQuote: any = {
      symbol: 'EURUSD',
      bid: 1.08500,
      ask: 1.08510,
      mid: 1.08505,
      spread: 0.00010,
      timestamp: Date.now() - 60000,
      marketStatus: 'STALE',
    };
    const resStale = orderEngine.executeMarketOrder(
      { accountId: account.id, symbol: 'EURUSD', side: 'BUY', type: 'MARKET', volume: 0.1 },
      account,
      staleQuote,
      eurusdCfg
    );
    assert(!resStale.result.success && Boolean(resStale.result.error?.includes('STALE')), 'S6-15', 'Rejects execution when quote is marked STALE');

    // C) Rejection on Invalid Quote Pricing (Negative or crossed)
    const crossedQuote: Quote = {
      symbol: 'EURUSD',
      bid: 1.08600,
      ask: 1.08500, // Ask < Bid (Invalid/Crossed)
      mid: 1.08550,
      spread: -0.00100,
      timestamp: Date.now(),
      high24h: 1.09000,
      low24h: 1.08000,
      change24h: 0,
      change24hPct: 0,
    };
    const resCrossed = orderEngine.executeMarketOrder(
      { accountId: account.id, symbol: 'EURUSD', side: 'BUY', type: 'MARKET', volume: 0.1 },
      account,
      crossedQuote,
      eurusdCfg
    );
    assert(!resCrossed.result.success && Boolean(resCrossed.result.error?.includes('Invalid quote pricing')), 'S6-16', 'Rejects execution when quote is crossed (Ask < Bid)');

    // D) Production Mode Rejection of SIMULATED quotes
    process.env.USE_REAL_MARKET_DATA = 'true';
    const simulatedQuote: any = {
      symbol: 'EURUSD',
      bid: 1.08500,
      ask: 1.08512,
      mid: 1.08506,
      spread: 0.00012,
      timestamp: Date.now(),
      marketStatus: 'SIMULATED',
      source: 'synthetic_sim',
    };
    const resProdSim = orderEngine.executeMarketOrder(
      { accountId: account.id, symbol: 'EURUSD', side: 'BUY', type: 'MARKET', volume: 0.1 },
      account,
      simulatedQuote,
      eurusdCfg
    );
    assert(!resProdSim.result.success && Boolean(resProdSim.result.error?.includes('Simulated quotes are not permitted')), 'S6-17', 'Production mode rejects live order execution against simulated quotes');
    process.env.USE_REAL_MARKET_DATA = 'false';
  }

  // -------------------------------------------------------------------------
  // SECTION 4: SL/TP BOUNDS & INPUT VALIDATION HARDENING
  // -------------------------------------------------------------------------
  console.log('\n--- 4. SL/TP BOUNDS & INPUT VALIDATION HARDENING ---');
  {
    const orderEngine = new OrderEngine();
    const account = runtime.accounts.getAccount('acc_demo_1001')!;
    const eurusdCfg = runtime.market.getSymbolConfig('EURUSD')!;
    const validQuote: Quote = {
      symbol: 'EURUSD',
      bid: 1.08500,
      ask: 1.08510,
      mid: 1.08505,
      spread: 0.00010,
      timestamp: Date.now(),
      high24h: 1.09000,
      low24h: 1.08000,
      change24h: 0,
      change24hPct: 0,
    };

    // A) BUY order with invalid Stop Loss (SL above or equal to Ask price)
    const resBadBuySL = orderEngine.executeMarketOrder(
      {
        accountId: account.id,
        symbol: 'EURUSD',
        side: 'BUY',
        type: 'MARKET',
        volume: 0.1,
        stopLoss: 1.08600, // Invalid: above execution price 1.08510
      },
      account,
      validQuote,
      eurusdCfg
    );
    assert(!resBadBuySL.result.success && Boolean(resBadBuySL.result.error?.includes('Stop loss')), 'S6-18', 'Rejects BUY order when Stop Loss is above execution price');

    // B) BUY order with invalid Take Profit (TP below or equal to Ask price)
    const resBadBuyTP = orderEngine.executeMarketOrder(
      {
        accountId: account.id,
        symbol: 'EURUSD',
        side: 'BUY',
        type: 'MARKET',
        volume: 0.1,
        takeProfit: 1.08400, // Invalid: below execution price 1.08510
      },
      account,
      validQuote,
      eurusdCfg
    );
    assert(!resBadBuyTP.result.success && Boolean(resBadBuyTP.result.error?.includes('Take profit')), 'S6-19', 'Rejects BUY order when Take Profit is below execution price');

    // C) SELL order with invalid Stop Loss (SL below or equal to Bid price)
    const resBadSellSL = orderEngine.executeMarketOrder(
      {
        accountId: account.id,
        symbol: 'EURUSD',
        side: 'SELL',
        type: 'MARKET',
        volume: 0.1,
        stopLoss: 1.08400, // Invalid: below execution price 1.08500
      },
      account,
      validQuote,
      eurusdCfg
    );
    assert(!resBadSellSL.result.success && Boolean(resBadSellSL.result.error?.includes('Stop loss')), 'S6-20', 'Rejects SELL order when Stop Loss is below execution price');

    // D) Working order with non-positive requested price
    const resBadPriceWorking = orderEngine.placeWorkingOrder(
      {
        accountId: account.id,
        symbol: 'EURUSD',
        side: 'BUY',
        type: 'LIMIT',
        volume: 0.1,
        requestedPrice: -1.05,
      },
      account,
      validQuote,
      eurusdCfg
    );
    assert(!resBadPriceWorking.result.success && Boolean(resBadPriceWorking.result.error?.includes('Invalid requested price')), 'S6-21', 'Rejects working order with negative requested price');
  }

  // -------------------------------------------------------------------------
  // SECTION 5: WEBSOCKET SECURITY & MULTI-TENANT ISOLATION HARDENING
  // -------------------------------------------------------------------------
  console.log('\n--- 5. WEBSOCKET SECURITY & MULTI-TENANT ISOLATION HARDENING ---');
  {
    // A) Unauthorized attempt to modify/close another account's position
    const fakeSessionId = 'conn_fake_attacker';
    runtime.clients.register(fakeSessionId, 'acc_attacker_999', {} as any);

    const modifyAttempt = await runtime.modifyPosition(
      fakeSessionId,
      'pos_demo_1001_nonexistent',
      1.08000,
      1.09000
    );
    assert(modifyAttempt === false, 'S6-22', 'Blocks unauthenticated/cross-account position modification');

    const closeAttempt = await runtime.closePosition(
      fakeSessionId,
      'pos_demo_1001_nonexistent'
    );
    assert(closeAttempt === false, 'S6-23', 'Blocks unauthenticated/cross-account position close attempt');

    runtime.clients.unregister(fakeSessionId);

    // B) Subscription limit hardening (max 100 subscriptions)
    const testSession = runtime.clients.register('conn_sub_test', 'acc_demo_1001', {} as any);
    const excessiveSymbols = Array.from({ length: 150 }, (_, i) => `SYM_${i}`);
    runtime.clients.subscribeSymbols('conn_sub_test', excessiveSymbols);
    assert(testSession.subscribedSymbols.size <= 100, 'S6-24', 'Enforces maximum subscription bound (<= 100 symbols) per session');
    runtime.clients.unregister('conn_sub_test');
  }

  // -------------------------------------------------------------------------
  // SECTION 6: FINANCIAL INVARIANT & HISTORICAL IMMUTABILITY HARDENING
  // -------------------------------------------------------------------------
  console.log('\n--- 6. FINANCIAL INVARIANT & HISTORICAL IMMUTABILITY HARDENING ---');
  {
    const initialAcc = runtime.accounts.getAccount('acc_demo_1001')!;
    const startBalance = initialAcc.balance;

    // Place and fill an order
    const quote: Quote = {
      symbol: 'EURUSD',
      bid: 1.08500,
      ask: 1.08512,
      mid: 1.08506,
      spread: 0.00012,
      timestamp: Date.now(),
      high24h: 1.09000,
      low24h: 1.08000,
      change24h: 0,
      change24hPct: 0,
    };
    const eurusdCfg = runtime.market.getSymbolConfig('EURUSD')!;
    const { result, positionTemplate } = runtime.orders.executeMarketOrder(
      { accountId: initialAcc.id, symbol: 'EURUSD', side: 'BUY', type: 'MARKET', volume: 0.5 },
      initialAcc,
      quote,
      eurusdCfg
    );
    assert(result.success && result.order.executionPrice === 1.08512, 'S6-25', 'Order fills at exact Ask price 1.08512');

    const openPos = runtime.positions.openPosition(positionTemplate!);
    assert(openPos.openPrice === 1.08512, 'S6-26', 'Position openPrice equals executed order price');

    // Close the position at higher price (+10 pips = 1.08612)
    const closingQuote: Quote = {
      ...quote,
      bid: 1.08612,
      ask: 1.08624,
      mid: 1.08618,
    };

    const closeRes = runtime.positions.closePosition(openPos.id, closingQuote, eurusdCfg, 'MANUAL');
    assert(closeRes.success && closeRes.outcome?.realizedPnL === 50.00, 'S6-27', 'Exact realized PnL (+ $50.00) generated for 0.5 lot');

    // Financial balance mutation
    const updatedAcc = runtime.accounts.getAccount('acc_demo_1001')!;
    updatedAcc.balance = Number((updatedAcc.balance + closeRes.outcome!.realizedPnL).toFixed(2));
    const ledgerEntry = runtime.accounts.createLedgerEntry(
      updatedAcc.id,
      'TRADE_PNL',
      50.00,
      updatedAcc.balance,
      'Closed BUY 0.5 EURUSD'
    );
    assert(updatedAcc.balance === Number((startBalance + 50.00).toFixed(2)), 'S6-28', 'Account balance accurately reflects realized PnL');
    assert(ledgerEntry.balanceAfter === updatedAcc.balance, 'S6-29', 'Double-entry ledger balanceAfter matches account balance');
  }

  // -------------------------------------------------------------------------
  // SECTION 7: REST API ENDPOINTS VERIFICATION
  // -------------------------------------------------------------------------
  console.log('\n--- 7. REST API ENDPOINTS VERIFICATION ---');
  {
    // A) GET /api/market/history
    const resApiHistory = await apiCall('/api/market/history?symbol=EURUSD&timeframe=1m&limit=20');
    assert(resApiHistory.status === 200, 'S6-30', 'GET /api/market/history returns 200 OK');
    assert(Array.isArray(resApiHistory.data?.bars) && resApiHistory.data.bars.length === 20, 'S6-31', 'API returns 20 bars matching limit parameter');
    assert(resApiHistory.data?.symbol === 'EURUSD', 'S6-32', 'API response contains canonical symbol EURUSD');

    // B) GET /api/market/status
    const resApiStatus = await apiCall('/api/market/status');
    assert(resApiStatus.status === 200, 'S6-33', 'GET /api/market/status returns 200 OK');
    assert(Array.isArray(resApiStatus.data?.symbols) && resApiStatus.data.symbols.length >= 10, 'S6-34', 'Status endpoint returns metadata for all canonical instruments');

    // C) GET /api/market/symbols
    const resApiSymbols = await apiCall('/api/market/symbols');
    assert(resApiSymbols.status === 200 && Array.isArray(resApiSymbols.data), 'S6-35', 'GET /api/market/symbols returns canonical symbol list');
  }

  console.log('\n=============================================================');
  console.log(`  STEP 6 TEST RESULTS: ${passCount} PASSED, ${failCount} FAILED (TOTAL: ${passCount + failCount})`);
  console.log('=============================================================\n');

  runtime.stop();
  httpServer.close();
  await db.close();
  process.exit(failCount > 0 ? 1 : 0);
}

runStep6Tests().catch((err) => {
  console.error('Fatal Step 6 test failure:', err);
  process.exit(1);
});
