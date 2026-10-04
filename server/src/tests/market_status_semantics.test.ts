/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * MARKET STATUS SEMANTICS TEST SUITE
 * Validates:
 * 1. FX weekend = CLOSED (respecting actual trading sessions/weekend schedule)
 * 2. LIVE quote = LIVE
 * 3. Stale quote = STALE (respecting category thresholds)
 * 4. No quote = WAITING_FOR_PROVIDER
 * 5. Provider failure = UNAVAILABLE
 */

import { MarketDataRouter } from '../market/MarketDataRouter';
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

async function runMarketStatusSemanticsTests() {
  console.log('\n=============================================================');
  console.log('  MARKET STATUS SEMANTICS TEST SUITE');
  console.log('=============================================================\n');

  const router = new MarketDataRouter({ isRealMarketData: true });
  router.start();

  console.log('--- 1. FX Weekend Schedule Verification (CLOSED) ---');
  {
    // Force a Saturday timestamp (e.g. Saturday Oct 3, 2026, 14:00 UTC)
    const saturdayTimestamp = Date.UTC(2026, 9, 3, 14, 0, 0); // Saturday
    const quoteEurusd = router.getEnrichedQuote('EURUSD', saturdayTimestamp);
    assert(quoteEurusd?.marketStatus === 'CLOSED', 'MS-01', 'FX market on Saturday evaluates to CLOSED');

    // Force a Friday after 21:00 UTC timestamp (e.g. Friday Oct 2, 2026, 22:30 UTC)
    const fridayClosedTimestamp = Date.UTC(2026, 9, 2, 22, 30, 0);
    const quoteClosedFri = router.getEnrichedQuote('EURUSD', fridayClosedTimestamp);
    assert(quoteClosedFri?.marketStatus === 'CLOSED', 'MS-02', 'FX market on Friday after 21:00 UTC evaluates to CLOSED');

    // Force a Sunday before 21:00 UTC timestamp (e.g. Sunday Oct 4, 2026, 12:00 UTC)
    const sundayClosedTimestamp = Date.UTC(2026, 9, 4, 12, 0, 0);
    const quoteClosedSun = router.getEnrichedQuote('EURUSD', sundayClosedTimestamp);
    assert(quoteClosedSun?.marketStatus === 'CLOSED', 'MS-03', 'FX market on Sunday before 21:00 UTC evaluates to CLOSED');
  }

  console.log('\n--- 2. LIVE Quote Verification ---');
  {
    // Force a Wednesday timestamp (Open FX market, e.g. Wednesday Oct 7, 2026, 14:00 UTC)
    const wednesdayTimestamp = Date.UTC(2026, 9, 7, 14, 0, 0);
    const liveQuote: Quote = {
      symbol: 'EURUSD',
      bid: 1.08500,
      ask: 1.08516,
      mid: 1.08508,
      spread: 1.6,
      high24h: 1.0900,
      low24h: 1.0800,
      change24h: 0.0005,
      change24hPct: 0.05,
      timestamp: wednesdayTimestamp,
      tickDirection: 'UP',
      marketStatus: 'LIVE',
      source: 'tiingo_fx',
    };
    
    const routerOpen = new MarketDataRouter({ isRealMarketData: true });
    routerOpen.start();
    (routerOpen as any).quotes.set('EURUSD', liveQuote);

    const evaluated = routerOpen.getEnrichedQuote('EURUSD', wednesdayTimestamp);
    assert(evaluated?.marketStatus === 'LIVE', 'MS-04', 'FX market during week with recent quote evaluates to LIVE');
  }

  console.log('\n--- 3. STALE Quote Verification ---');
  {
    const wednesdayTimestamp = Date.UTC(2026, 9, 7, 14, 0, 0);
    const oldQuote: Quote = {
      symbol: 'EURUSD',
      bid: 1.08500,
      ask: 1.08516,
      mid: 1.08508,
      spread: 1.6,
      high24h: 1.0900,
      low24h: 1.0800,
      change24h: 0.0005,
      change24hPct: 0.05,
      timestamp: wednesdayTimestamp - 20000, // 20s old (> 15s threshold for FX)
      tickDirection: 'FLAT',
      marketStatus: 'LIVE',
      source: 'tiingo_fx',
    };

    const routerStale = new MarketDataRouter({ isRealMarketData: true });
    routerStale.start();
    (routerStale as any).quotes.set('EURUSD', oldQuote);

    const evaluated = routerStale.getEnrichedQuote('EURUSD', wednesdayTimestamp);
    assert(evaluated?.marketStatus === 'STALE', 'MS-05', 'Quote older than freshness threshold evaluates to STALE');
  }

  console.log('\n--- 4. NO QUOTE Verification (WAITING_FOR_PROVIDER) ---');
  {
    const wednesdayTimestamp = Date.UTC(2026, 9, 7, 14, 0, 0);
    const routerEmpty = new MarketDataRouter({ isRealMarketData: true });
    (routerEmpty as any).isRunning = true;

    const evaluated = routerEmpty.getEnrichedQuote('EURUSD', wednesdayTimestamp);
    assert(evaluated?.marketStatus === 'WAITING_FOR_PROVIDER', 'MS-06', 'Market open with no quote evaluates to WAITING_FOR_PROVIDER');
  }

  console.log('\n--- 5. PROVIDER FAILURE Verification (UNAVAILABLE) ---');
  {
    const wednesdayTimestamp = Date.UTC(2026, 9, 7, 14, 0, 0);
    const routerDown = new MarketDataRouter({ isRealMarketData: true });
    (routerDown as any).isRunning = false; // Disconnected / unavailable

    const evaluated = routerDown.getEnrichedQuote('EURUSD', wednesdayTimestamp);
    assert(evaluated?.marketStatus === 'UNAVAILABLE', 'MS-07', 'Provider failure / disconnected evaluates to UNAVAILABLE');
  }

  console.log('\n=============================================================');
  console.log(`TOTAL MARKET STATUS TESTS: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('=============================================================\n');

  router.stop();

  if (failCount > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runMarketStatusSemanticsTests().catch((err) => {
  console.error('Market status test execution failed:', err);
  process.exit(1);
});
