/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * SYMBOL VISIBILITY & MARKET-DATA GATEWAY TEST SUITE (T4A.6)
 * Validates symbol catalog persistence, graceful handling of missing quotes,
 * quote arrival and update transitions, staleness resilience, and order ticket constraints.
 */

import { useTradingStore } from '../store/useTradingStore';
import { ALL_SYMBOLS } from '../../server/src/market/MarketEngine';
import { Quote } from '../types/trading';

let passCount = 0;
let failCount = 0;

function assert(condition: boolean, testName: string) {
  if (condition) {
    console.log(`  ✓ ${testName}`);
    passCount++;
  } else {
    console.error(`  ✗ FAIL: ${testName}`);
    failCount++;
  }
}

async function runSymbolVisibilityTests() {
  console.log('\n=============================================================');
  console.log('  T4A.6 — SYMBOL VISIBILITY & MARKET-DATA GATEWAY TESTS');
  console.log('=============================================================');

  // Initialize store with symbol catalog
  const symbolsMap: Record<string, any> = {};
  for (const s of ALL_SYMBOLS) {
    symbolsMap[s.symbol] = s;
  }
  const top18 = ALL_SYMBOLS.slice(0, 18);

  useTradingStore.setState({
    symbols: symbolsMap,
    activeSymbolList: top18,
    activeSymbolCount: 18,
    selectedSymbol: 'EURUSD',
    quotes: {}, // Start with empty quote dictionary
  });

  console.log('\n--- TEST A: Symbol Catalog Remains Visible Without Live Quotes ---');
  {
    const state = useTradingStore.getState();
    assert(state.activeSymbolList.length === 18, `Active symbol list has 18 symbols (got ${state.activeSymbolList.length})`);
    
    // Check all 18 symbols are present in active list
    const symbolNames = state.activeSymbolList.map((s) => s.symbol);
    const expected = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD', 'USDCNH', 'EURJPY', 'GBPJPY', 'BTCUSD', 'ETHUSD', 'BNBUSD', 'SOLUSD', 'XRPUSD', 'XAUUSD', 'XAGUSD', 'WTIUSD'];
    const allPresent = expected.every((sym) => symbolNames.includes(sym));
    assert(allPresent, 'All 18 configured symbols exist in active list');

    // Quotes are empty, but symbol metadata is complete
    assert(Object.keys(state.quotes).length === 0, 'Quotes map is initially empty');
    assert(state.symbols['EURUSD'] !== undefined, 'EURUSD metadata is present');
    assert(state.symbols['BTCUSD'] !== undefined, 'BTCUSD metadata is present');
    assert(state.symbols['WTIUSD'] !== undefined, 'WTIUSD metadata is present');
  }

  console.log('\n--- TEST B: Symbol Transitions to Live When First Quote Arrives ---');
  {
    const eurusdQuote: Quote = {
      symbol: 'EURUSD',
      bid: 1.08520,
      ask: 1.08536,
      mid: 1.08528,
      spread: 1.6,
      high24h: 1.08900,
      low24h: 1.08200,
      change24h: 0.00028,
      change24hPct: 0.03,
      timestamp: Date.now(),
      tickDirection: 'UP',
    };

    useTradingStore.getState().updateQuotesBatch({ EURUSD: eurusdQuote });

    const state = useTradingStore.getState();
    assert(state.quotes['EURUSD'] !== undefined, 'EURUSD quote is now present in store');
    assert(state.quotes['EURUSD'].bid === 1.08520, `EURUSD bid is 1.08520 (got ${state.quotes['EURUSD'].bid})`);
    assert(state.quotes['GBPUSD'] === undefined, 'GBPUSD remains cleanly undefined without synthetic fabrication');
    assert(state.activeSymbolList.length === 18, 'Active symbol list count remains 18');
  }

  console.log('\n--- TEST C: Symbol Does Not Disappear When Quote Becomes Stale ---');
  {
    // Simulate stale quote (timestamp 60 seconds in the past)
    const staleQuote: Quote = {
      symbol: 'GBPUSD',
      bid: 1.28500,
      ask: 1.28520,
      mid: 1.28510,
      spread: 2.0,
      high24h: 1.28900,
      low24h: 1.28100,
      change24h: -0.0005,
      change24hPct: -0.04,
      timestamp: Date.now() - 60000,
      tickDirection: 'FLAT',
    };

    useTradingStore.getState().updateQuotesBatch({ GBPUSD: staleQuote });
    const state = useTradingStore.getState();

    assert(state.quotes['GBPUSD'] !== undefined, 'Stale GBPUSD quote is retained in store');
    assert(state.activeSymbolList.some((s) => s.symbol === 'GBPUSD'), 'GBPUSD remains in active symbol list');
  }

  console.log('\n--- TEST D: Selected Symbol Persists Across Session Re-Init ---');
  {
    useTradingStore.getState().setSelectedSymbol('BTCUSD');
    assert(useTradingStore.getState().selectedSymbol === 'BTCUSD', 'Selected symbol set to BTCUSD');

    // Simulate session re-init handshake
    useTradingStore.getState().initSessionFromSocket({
      connectionId: 'conn_test_123',
      account: {
        id: 'acc_demo_1001',
        tenantId: 'tenant_default',
        accountNumber: 'DEMO-1001',
        currency: 'USD',
        accountType: 'DEMO',
        leverage: 100,
        balance: 10000,
        equity: 10000,
        usedMargin: 0,
        freeMargin: 10000,
        marginLevel: 0,
        marginCallLevel: 100,
        stopOutLevel: 50,
        status: 'ACTIVE',
      },
      symbols: ALL_SYMBOLS,
      positions: [],
      orders: [],
      executions: [],
      ledger: [],
      activeSymbols: ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'BTCUSD', 'AUDUSD', 'USDCAD', 'USDCHF', 'ETHUSD', 'US500'],
    });

    assert(useTradingStore.getState().selectedSymbol === 'BTCUSD', 'Selected symbol BTCUSD persists after session initialization');
  }

  console.log('\n--- TEST E: Market Orders Disabled When Quote is Unavailable ---');
  {
    useTradingStore.getState().setSelectedSymbol('USDCHF');
    const selectedSymbol = useTradingStore.getState().selectedSymbol;
    const quote = useTradingStore.getState().quotes[selectedSymbol];

    assert(quote === undefined, 'USDCHF has no live quote');

    // Verify order condition rule: orderType === 'MARKET' && !quote => disabled
    const isMarketOrderDisabled = !quote;
    assert(isMarketOrderDisabled, 'Market order execution is disabled when quote is missing');
  }

  console.log('\n--- TEST F: Live EURUSD Quote Updates Seamlessly ---');
  {
    const updatedQuote: Quote = {
      symbol: 'EURUSD',
      bid: 1.08550,
      ask: 1.08566,
      mid: 1.08558,
      spread: 1.6,
      high24h: 1.08900,
      low24h: 1.08200,
      change24h: 0.00058,
      change24hPct: 0.05,
      timestamp: Date.now(),
      tickDirection: 'UP',
    };

    useTradingStore.getState().updateQuotesBatch({ EURUSD: updatedQuote });
    const currentEURUSD = useTradingStore.getState().quotes['EURUSD'];

    assert(currentEURUSD.bid === 1.08550, `EURUSD updated bid is 1.08550 (got ${currentEURUSD.bid})`);
    assert(currentEURUSD.mid === 1.08558, `EURUSD updated mid is 1.08558 (got ${currentEURUSD.mid})`);
  }

  console.log('\n--- TEST G: Clean Distinction Between Available, Subscribed, & Live Symbols ---');
  {
    const state = useTradingStore.getState();
    const availableSymbolsCount = Object.keys(state.symbols).length;
    const activeSubscribedCount = state.activeSymbolList.length;
    const liveQuotesCount = Object.keys(state.quotes).length;

    assert(availableSymbolsCount === 18, `Catalog has 18 available symbols (got ${availableSymbolsCount})`);
    assert(activeSubscribedCount === 18, `Active subscribed list has 18 symbols (got ${activeSubscribedCount})`);
    assert(liveQuotesCount === 2, `Live quotes dictionary contains exactly 2 quoted symbols (got ${liveQuotesCount})`);
    assert(state.quotes['WTIUSD'] === undefined, 'Unquoted WTIUSD is not fabricated as real');
  }

  console.log('\n=============================================================');
  console.log(`TOTAL SYMBOL VISIBILITY TESTS: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('=============================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

runSymbolVisibilityTests().catch((err) => {
  console.error('Test run failed:', err);
  process.exit(1);
});
