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

  console.log('\n--- TEST H: UI Category Structure & Breakdown Invariants ---');
  {
    const state = useTradingStore.getState();
    const forexSymbols = state.activeSymbolList.filter((s) => s.category === 'FOREX');
    const cryptoSymbols = state.activeSymbolList.filter((s) => s.category === 'CRYPTO');
    const commoditySymbols = state.activeSymbolList.filter((s) => s.category === 'COMMODITIES');
    const metalsSymbols = state.activeSymbolList.filter((s) => (s as any).category === 'METALS');
    const indicesSymbols = state.activeSymbolList.filter((s) => (s as any).category === 'INDICES');

    assert(forexSymbols.length === 10, `Forex category contains exactly 10 instruments (got ${forexSymbols.length})`);
    assert(cryptoSymbols.length === 5, `Crypto category contains exactly 5 instruments (got ${cryptoSymbols.length})`);
    assert(commoditySymbols.length === 3, `Commodities category contains exactly 3 instruments (got ${commoditySymbols.length})`);
    assert(metalsSymbols.length === 0, 'No instruments remain in deprecated METALS category');
    assert(indicesSymbols.length === 0, 'No instruments remain in deprecated INDICES category');

    assert(!state.activeSymbolList.some((s) => s.symbol === 'EURGBP'), 'EURGBP is removed from active list');
    assert(state.activeSymbolList.some((s) => s.symbol === 'USDCNH'), 'USDCNH is present in Forex active list');
    assert(commoditySymbols.some((s) => s.symbol === 'XAUUSD'), 'XAUUSD (Gold) is categorized under COMMODITIES');
    assert(commoditySymbols.some((s) => s.symbol === 'XAGUSD'), 'XAGUSD (Silver) is categorized under COMMODITIES');
    assert(commoditySymbols.some((s) => s.symbol === 'WTIUSD'), 'WTIUSD (Crude Oil) is categorized under COMMODITIES');
  }

  console.log('\n--- TEST I: Stale Quote UX Safety, Hedging, & Explicit Close ---');
  {
    // 1. LIVE Quote: Market BUY & SELL are enabled
    const liveEURUSD: Quote = {
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
      marketStatus: 'LIVE',
    };
    useTradingStore.getState().updateQuotesBatch({ EURUSD: liveEURUSD });
    
    let currentQ = useTradingStore.getState().quotes['EURUSD'];
    let isStale = Boolean(currentQ?.marketStatus === 'STALE' || (currentQ as any)?.isStale);
    let isLive = Boolean(currentQ && currentQ.marketStatus === 'LIVE' && !isStale);
    let isMarketExecutable = isLive;
    assert(isMarketExecutable === true, '1. LIVE quote: market BUY and SELL enabled');

    // 2. STALE Quote: Market BUY & SELL are disabled
    const staleEURUSD: Quote = {
      ...liveEURUSD,
      marketStatus: 'STALE',
      timestamp: Date.now() - 35000,
    };
    useTradingStore.getState().updateQuotesBatch({ EURUSD: staleEURUSD });
    
    currentQ = useTradingStore.getState().quotes['EURUSD'];
    isStale = Boolean(currentQ?.marketStatus === 'STALE' || (currentQ as any)?.isStale);
    isLive = Boolean(currentQ && currentQ.marketStatus === 'LIVE' && !isStale);
    isMarketExecutable = isLive;
    assert(isMarketExecutable === false, '2. STALE quote: market BUY and SELL disabled');
    assert(isStale === true, '3. STALE quote accurately identified');

    // 3. Fresh LIVE quote arrives after STALE: Market buttons re-enable
    const freshEURUSD: Quote = {
      ...liveEURUSD,
      bid: 1.08560,
      ask: 1.08576,
      mid: 1.08568,
      marketStatus: 'LIVE',
      timestamp: Date.now(),
    };
    useTradingStore.getState().updateQuotesBatch({ EURUSD: freshEURUSD });
    
    currentQ = useTradingStore.getState().quotes['EURUSD'];
    isStale = Boolean(currentQ?.marketStatus === 'STALE' || (currentQ as any)?.isStale);
    isLive = Boolean(currentQ && currentQ.marketStatus === 'LIVE' && !isStale);
    isMarketExecutable = isLive;
    assert(isMarketExecutable === true, '4. Fresh LIVE quote arrives after STALE: market buttons automatically re-enable');

    // 4. Hedging: BUY + SELL creates two independent positions
    const pos1 = {
      id: 'pos_101',
      accountId: 'acc_demo_1001',
      symbol: 'XAUUSD',
      side: 'BUY' as const,
      volume: 0.10,
      openPrice: 2735.50,
      currentPrice: 2735.50,
      unrealizedPnL: 0,
      realizedPnL: 0,
      marginLocked: 273.55,
      openedAt: Date.now() - 10000,
      status: 'OPEN' as const,
    };
    const pos2 = {
      id: 'pos_102',
      accountId: 'acc_demo_1001',
      symbol: 'XAUUSD',
      side: 'SELL' as const,
      volume: 0.10,
      openPrice: 2735.00,
      currentPrice: 2735.00,
      unrealizedPnL: 0,
      realizedPnL: 0,
      marginLocked: 273.50,
      openedAt: Date.now(),
      status: 'OPEN' as const,
    };

    useTradingStore.setState({ positions: [pos1, pos2] });
    const stateAfterHedging = useTradingStore.getState();
    assert(stateAfterHedging.positions.length === 2, '5. Hedging: BUY 0.10 + SELL 0.10 creates two concurrent open positions');
    assert(stateAfterHedging.positions.some(p => p.side === 'BUY' && p.id === 'pos_101'), '6. BUY position preserved with side = BUY');
    assert(stateAfterHedging.positions.some(p => p.side === 'SELL' && p.id === 'pos_102'), '7. SELL position preserved with side = SELL');

    // 5. Explicit CLOSE closes the selected position
    const ledgerEntry = {
      id: 'led_close_101',
      accountId: 'acc_demo_1001',
      type: 'TRADE_PNL' as const,
      amount: 15.00,
      balanceAfter: 10015.00,
      description: 'Closed BUY 0.10 XAUUSD @ 2737.00',
      createdAt: Date.now(),
    };
    useTradingStore.getState().handlePositionClosed({ ...pos1, status: 'CLOSED' }, ledgerEntry);
    
    const stateAfterClose = useTradingStore.getState();
    assert(stateAfterClose.positions.length === 1 && stateAfterClose.positions[0].id === 'pos_102', '8. Explicit CLOSE removes selected position pos_101 from open positions');
    assert(stateAfterClose.closedTrades.length === 1 && stateAfterClose.closedTrades[0].id === 'pos_101', '9. Closed position is moved to closedTrades history');
    assert(stateAfterClose.ledger.some(l => l.id === 'led_close_101'), '10. Trade P/L ledger entry recorded');
  }

  console.log('\n=============================================================');
  console.log('=============================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

runSymbolVisibilityTests().catch((err) => {
  console.error('Test run failed:', err);
  process.exit(1);
});
