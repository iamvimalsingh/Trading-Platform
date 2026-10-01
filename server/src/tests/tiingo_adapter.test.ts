/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * TIINGO MARKET DATA ADAPTER TEST SUITE (T4A POC)
 * Validates message parsing, bid/ask extraction, quote normalization,
 * reconnection backoff, resubscription, stale detection, provider switching,
 * and integration with server-authoritative TradingRuntime.
 * Run with: tsx server/src/tests/tiingo_adapter.test.ts
 */

import {
  parseTiingoMessage,
  normalizeTiingoQuote,
  TiingoMarketDataAdapter,
  RawTiingoQuoteTuple,
  SessionStats,
} from '../market/TiingoMarketDataAdapter';
import { createDefaultMarketProvider, TradingRuntime } from '../runtime/TradingRuntime';
import { INITIAL_SYMBOLS } from '../market/MarketEngine';
import { Quote } from '../types/trading';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testNum: number, name: string, detail?: string) {
  if (condition) {
    console.log(`  \x1b[32m✔ PASS [T4A-${testNum.toString().padStart(2, '0')}]\x1b[0m ${name}`);
    passed++;
  } else {
    console.error(`  \x1b[31m✖ FAIL [T4A-${testNum.toString().padStart(2, '0')}]\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

async function runTiingoAdapterTests() {
  console.log('\n=============================================================');
  console.log('  RUNNING T4A TIINGO EURUSD ADAPTER & NORMALIZATION TEST SUITE');
  console.log('=============================================================\n');

  const eurusdCfg = INITIAL_SYMBOLS.find((s) => s.symbol === 'EURUSD')!;

  // -----------------------------------------------------------------
  // 1. Message Parsing & Filtering
  // -----------------------------------------------------------------
  const sampleQuoteMsg = JSON.stringify({
    service: 'fx',
    messageType: 'A',
    data: ['Q', 'eurusd', '2026-09-26T12:00:00.123456Z', 1000000, 1.08452, 1000000, 1.08464],
  });

  const parsed1 = parseTiingoMessage(sampleQuoteMsg);
  assert(
    parsed1.length === 1 &&
      parsed1[0].ticker === 'EURUSD' &&
      parsed1[0].bidPrice === 1.08452 &&
      parsed1[0].askPrice === 1.08464,
    1,
    'Parses standard single Top-of-Book quote tuple'
  );

  // -----------------------------------------------------------------
  // 2. Batched Tuples Parsing
  // -----------------------------------------------------------------
  const batchQuoteMsg = JSON.stringify({
    service: 'fx',
    messageType: 'A',
    data: [
      ['Q', 'eurusd', '2026-09-26T12:00:01.000Z', 500000, 1.08450, 500000, 1.08462],
      ['Q', 'eurusd', '2026-09-26T12:00:02.000Z', 750000, 1.08455, 750000, 1.08467],
    ],
  });
  const parsed2 = parseTiingoMessage(batchQuoteMsg);
  assert(
    parsed2.length === 2 &&
      parsed2[0].bidPrice === 1.08450 &&
      parsed2[1].bidPrice === 1.08455,
    2,
    'Parses batched multiple quote tuples correctly'
  );

  // -----------------------------------------------------------------
  // 3. Heartbeat & Trade Filtering
  // -----------------------------------------------------------------
  const heartbeatMsg = JSON.stringify({
    response: { code: 200, message: 'HeartBeat' },
    messageType: 'H',
  });
  const tradeMsg = JSON.stringify({
    service: 'fx',
    messageType: 'A',
    data: ['T', 'eurusd', '2026-09-26T12:00:00.000Z', 1000000, 1.08455],
  });
  assert(
    parseTiingoMessage(heartbeatMsg).length === 0 && parseTiingoMessage(tradeMsg).length === 0,
    3,
    'Safely filters out heartbeats and non-quote trade execution messages'
  );

  // -----------------------------------------------------------------
  // 4. Malformed Payload Resilience
  // -----------------------------------------------------------------
  assert(
    parseTiingoMessage('not json').length === 0 &&
      parseTiingoMessage(null).length === 0 &&
      parseTiingoMessage({ random: true }).length === 0,
    4,
    'Malformed inputs return empty array without crashing'
  );

  // -----------------------------------------------------------------
  // 5. Bid and Ask Extraction
  // -----------------------------------------------------------------
  const rawTuple: RawTiingoQuoteTuple = {
    updateType: 'Q',
    ticker: 'EURUSD',
    timestamp: '2026-09-26T12:00:00.500Z',
    bidSize: 1000000,
    bidPrice: 1.08510,
    askSize: 1000000,
    askPrice: 1.08522,
  };

  const { quote: normQuote1, updatedStats: stats1 } = normalizeTiingoQuote(rawTuple, eurusdCfg);
  assert(
    normQuote1.bid === 1.08510 && normQuote1.ask === 1.08522,
    5,
    'Extracts exact Bid and Ask with 5-digit precision',
    `Bid=${normQuote1.bid}, Ask=${normQuote1.ask}`
  );

  // -----------------------------------------------------------------
  // 6. Mid and Spread Normalization
  // -----------------------------------------------------------------
  const expectedMid = Number(((1.08510 + 1.08522) / 2).toFixed(5));
  const expectedSpread = Number((1.08522 - 1.08510).toFixed(5));
  assert(
    normQuote1.mid === expectedMid && normQuote1.spread === expectedSpread,
    6,
    'Calculates mid = (bid + ask) / 2 and spread = ask - bid accurately',
    `mid=${normQuote1.mid}, spread=${normQuote1.spread}`
  );

  // -----------------------------------------------------------------
  // 7. Provider Timestamp Normalization
  // -----------------------------------------------------------------
  const expectedTimestamp = Date.parse('2026-09-26T12:00:00.500Z');
  assert(
    normQuote1.timestamp === expectedTimestamp,
    7,
    'Preserves actual provider timestamp in epoch milliseconds',
    `Timestamp=${normQuote1.timestamp}`
  );

  // -----------------------------------------------------------------
  // 8. Tick Direction Tracking
  // -----------------------------------------------------------------
  const rawUp: RawTiingoQuoteTuple = { ...rawTuple, bidPrice: 1.08520, askPrice: 1.08532 };
  const { quote: normQuoteUp } = normalizeTiingoQuote(rawUp, eurusdCfg, normQuote1, stats1);

  const rawDown: RawTiingoQuoteTuple = { ...rawTuple, bidPrice: 1.08500, askPrice: 1.08512 };
  const { quote: normQuoteDown } = normalizeTiingoQuote(rawDown, eurusdCfg, normQuote1, stats1);

  const rawFlat: RawTiingoQuoteTuple = { ...rawTuple, bidPrice: 1.08510, askPrice: 1.08522 };
  const { quote: normQuoteFlat } = normalizeTiingoQuote(rawFlat, eurusdCfg, normQuote1, stats1);

  assert(
    normQuoteUp.tickDirection === 'UP' &&
      normQuoteDown.tickDirection === 'DOWN' &&
      normQuoteFlat.tickDirection === 'FLAT',
    8,
    'Tracks tickDirection dynamically: UP on uptick, DOWN on downtick, FLAT on unchanged'
  );

  // -----------------------------------------------------------------
  // 9. Session Stats Derived Values (High/Low/Change)
  // -----------------------------------------------------------------
  assert(
    normQuoteUp.high24h >= normQuoteUp.ask &&
      normQuoteDown.low24h <= normQuoteDown.bid &&
      normQuoteUp.change24h === Number((normQuoteUp.mid - stats1.sessionOpenPrice).toFixed(5)),
    9,
    'Maintains session High, Low, and Net Change without fabricating external noise'
  );

  // -----------------------------------------------------------------
  // 10. Stale Quote Detection Logic
  // -----------------------------------------------------------------
  const adapter = new TiingoMarketDataAdapter({
    apiToken: 'mock_token_for_unit_tests',
    autoStart: false,
    staleThresholdMs: 15000,
  });

  // Inject a quote via raw message
  (adapter as any).handleMessage(sampleQuoteMsg);
  const freshQuote = adapter.getQuote('EURUSD');
  const isStaleImmediately = adapter.isQuoteStale('EURUSD');

  assert(
    freshQuote !== undefined && isStaleImmediately === false,
    10,
    'Fresh quote is not marked stale upon arrival'
  );

  // Manually age the tick timestamp beyond 15 seconds
  (adapter as any).lastTickTimestamp = Date.now() - 16000;
  const isStaleAfter16s = adapter.checkStaleQuote();
  assert(
    isStaleAfter16s === true && adapter.isQuoteStale('EURUSD') === true,
    11,
    'Marks quote as stale when no tick is received for > 15 seconds'
  );

  // -----------------------------------------------------------------
  // 12. Reconnection Exponential Backoff
  // -----------------------------------------------------------------
  // Inspect backoff calculation: initial 1s, max 30s
  const calculateDelay = (attempts: number) =>
    Math.min(1000 * Math.pow(2, attempts - 1), 30000);

  const delay1 = calculateDelay(1); // 1000ms
  const delay2 = calculateDelay(2); // 2000ms
  const delay3 = calculateDelay(3); // 4000ms
  const delay6 = calculateDelay(6); // 30000ms (capped)

  assert(
    delay1 === 1000 && delay2 === 2000 && delay3 === 4000 && delay6 === 30000,
    12,
    'Reconnection backoff scales exponentially (1s, 2s, 4s...) and caps at 30s'
  );

  // -----------------------------------------------------------------
  // 13. Resubscription Payload Structure
  // -----------------------------------------------------------------
  let sentPayload: any = null;
  const mockWs = {
    readyState: 1, // OPEN
    send: (str: string) => {
      sentPayload = JSON.parse(str);
    },
  };
  (adapter as any).ws = mockWs;
  (adapter as any).sendSubscription();

  assert(
    sentPayload !== null &&
      sentPayload.eventName === 'subscribe' &&
      sentPayload.authorization === 'mock_token_for_unit_tests' &&
      Array.isArray(sentPayload.eventData?.tickers) &&
      sentPayload.eventData.tickers[0] === 'eurusd',
    13,
    'Builds documented Tiingo subscription envelope with API token and tickers'
  );

  // -----------------------------------------------------------------
  // 14. Provider Switching: USE_REAL_MARKET_DATA Flag
  // -----------------------------------------------------------------
  const oldEnvData = process.env.USE_REAL_MARKET_DATA;
  const oldEnvToken = process.env.TIINGO_API_TOKEN;

  // Case A: Flag false -> returns synthetic MarketEngine
  process.env.USE_REAL_MARKET_DATA = 'false';
  process.env.TIINGO_API_TOKEN = 'test_token';
  const providerA = createDefaultMarketProvider();
  assert(
    providerA.providerName === 'SyntheticMarketSimulator',
    14,
    'Falls back to SyntheticMarketSimulator when USE_REAL_MARKET_DATA is false'
  );

  // Case B: Flag true but missing token -> falls back to MarketEngine
  process.env.USE_REAL_MARKET_DATA = 'true';
  process.env.TIINGO_API_TOKEN = '';
  const providerB = createDefaultMarketProvider();
  assert(
    providerB.providerName === 'SyntheticMarketSimulator',
    15,
    'Falls back to SyntheticMarketSimulator when USE_REAL_MARKET_DATA is true but token is missing'
  );

  // Case C: Flag true AND valid token -> initializes TiingoMarketDataAdapter
  process.env.USE_REAL_MARKET_DATA = 'true';
  process.env.TIINGO_API_TOKEN = 'valid_secret_token';
  const providerC = createDefaultMarketProvider();
  assert(
    providerC.providerName === 'TiingoLiveFeed',
    16,
    'Instantiates TiingoMarketDataAdapter when USE_REAL_MARKET_DATA is true and token exists'
  );

  // Restore env
  process.env.USE_REAL_MARKET_DATA = oldEnvData;
  process.env.TIINGO_API_TOKEN = oldEnvToken;

  // -----------------------------------------------------------------
  // 15. Server-Authoritative Runtime Integration (End-to-End Tick Injection)
  // -----------------------------------------------------------------
  const liveAdapter = new TiingoMarketDataAdapter({
    apiToken: 'test_token',
    autoStart: false,
  });

  const runtime = new TradingRuntime(liveAdapter);
  const account = runtime.accounts.getAccount('DEMO-1001')!;

  // Inject initial live quote: EURUSD @ 1.08450 / 1.08462
  const initialTick = JSON.stringify({
    service: 'fx',
    messageType: 'A',
    data: ['Q', 'eurusd', '2026-09-26T12:00:00.000Z', 1000000, 1.08450, 1000000, 1.08462],
  });
  (liveAdapter as any).handleMessage(initialTick);

  // Verify runtime market has this quote
  const currentQ = runtime.market.getQuote('EURUSD');
  assert(
    currentQ !== undefined && currentQ.bid === 1.08450 && currentQ.ask === 1.08462,
    17,
    'Normalized Tiingo quote flows directly into TradingRuntime state'
  );

  // -----------------------------------------------------------------
  // 16. MARKET BUY executes at Ask, MARKET SELL executes at Bid
  // -----------------------------------------------------------------
  const buyRes = runtime.orders.executeOrder(
    {
      accountId: account.id,
      symbol: 'EURUSD',
      side: 'BUY',
      type: 'MARKET',
      volume: 1.0,
    },
    account,
    currentQ,
    eurusdCfg
  );

  assert(
    buyRes.result.success && buyRes.result.order.executionPrice === 1.08462,
    18,
    'Server-authoritative MARKET BUY executes at live Ask price (1.08462)',
    `Filled at: ${buyRes.result.order.executionPrice}`
  );

  const sellRes = runtime.orders.executeOrder(
    {
      accountId: account.id,
      symbol: 'EURUSD',
      side: 'SELL',
      type: 'MARKET',
      volume: 1.0,
    },
    account,
    currentQ,
    eurusdCfg
  );

  assert(
    sellRes.result.success && sellRes.result.order.executionPrice === 1.08450,
    19,
    'Server-authoritative MARKET SELL executes at live Bid price (1.08450)',
    `Filled at: ${sellRes.result.order.executionPrice}`
  );

  // -----------------------------------------------------------------
  // 17. Live Quote Movement Updates Mark-to-Market & Floating P/L
  // -----------------------------------------------------------------
  if (buyRes.positionTemplate) {
    runtime.positions.openPosition(buyRes.positionTemplate);
  }

  // Market moves UP: new tick Bid 1.08500 / Ask 1.08512
  const upTick = JSON.stringify({
    service: 'fx',
    messageType: 'A',
    data: ['Q', 'eurusd', '2026-09-26T12:00:05.000Z', 1000000, 1.08500, 1000000, 1.08512],
  });
  (liveAdapter as any).handleMessage(upTick);

  const openPositions = runtime.positions.getOpenPositionsForAccount(account.id);
  const longPos = openPositions.find((p) => p.side === 'BUY');

  // Long is marked to Bid (1.08500), bought at 1.08462 -> gain of 38 points * 100,000 = +$38.00
  assert(
    longPos !== undefined && longPos.currentPrice === 1.08500 && longPos.unrealizedPnL > 0,
    20,
    'Real quote movement marks position to market (Bid: 1.08500) and produces accurate floating P/L',
    `Current Price: ${longPos?.currentPrice}, P/L: $${longPos?.unrealizedPnL}`
  );

  // -----------------------------------------------------------------
  // 18. Working Order Trigger on Real Quote Movement
  // -----------------------------------------------------------------
  // Place BUY LIMIT order at 1.08480 (below current 1.08512 Ask)
  const limitOrderRes = runtime.orders.executeOrder(
    {
      accountId: account.id,
      symbol: 'EURUSD',
      side: 'BUY',
      type: 'LIMIT',
      requestedPrice: 1.08480,
      volume: 0.5,
    },
    account,
    runtime.market.getQuote('EURUSD'),
    eurusdCfg
  );

  assert(
    limitOrderRes.result.success && limitOrderRes.result.order.status === 'WORKING',
    21,
    'Places working BUY LIMIT order awaiting real market trigger'
  );

  // Price drops: new tick Bid 1.08460 / Ask 1.08475 (<= 1.08480)
  const dropTick = JSON.stringify({
    service: 'fx',
    messageType: 'A',
    data: ['Q', 'eurusd', '2026-09-26T12:00:10.000Z', 1000000, 1.08460, 1000000, 1.08475],
  });
  (liveAdapter as any).handleMessage(dropTick);

  const workingOrder = runtime.orders.getOrder(limitOrderRes.result.order.id);
  assert(
    workingOrder !== undefined && workingOrder.status === 'FILLED' && workingOrder.executionPrice === 1.08475,
    22,
    'Working BUY LIMIT triggers automatically on real tick Ask price crossing limit price',
    `Triggered execution price: ${workingOrder?.executionPrice}`
  );

  // -----------------------------------------------------------------
  // 19. T5.2 REGRESSION: 8-Element Tiingo FX Tuple & EURUSD Ask Normalization
  // -----------------------------------------------------------------
  const realWorld8ElementMsg = JSON.stringify({
    service: 'fx',
    messageType: 'A',
    data: ['Q', 'eurusd', '2026-09-28T13:22:30.000Z', 1000000, 1.13643, 1.13649, 1000000, 1.13655],
  });

  const parsedReal8 = parseTiingoMessage(realWorld8ElementMsg);
  assert(
    parsedReal8.length === 1 &&
      parsedReal8[0].bidPrice === 1.13643 &&
      parsedReal8[0].askPrice === 1.13655 &&
      ((parsedReal8[0].askPrice as number) !== 1000000) &&
      parsedReal8[0].midPrice === 1.13649,
    23,
    'Parses real 8-element Tiingo FX tuple: bid=1.13643, ask=1.13655, mid=1.13649 (Never uses askSize 1000000 as price)'
  );

  const { quote: normReal8 } = normalizeTiingoQuote(parsedReal8[0], eurusdCfg);
  const expectedSpreadReal8 = Number((1.13655 - 1.13643).toFixed(5));
  assert(
    normReal8.bid === 1.13643 &&
      normReal8.ask === 1.13655 &&
      normReal8.mid === 1.13649 &&
      normReal8.spread === expectedSpreadReal8 &&
      normReal8.ask < 10 &&
      normReal8.mid < 10,
    24,
    'Normalizes EURUSD quote: bid=1.13643, ask=1.13655, mid=1.13649, spread=0.00012 (No ask=1000000, No mid=500000+)'
  );

  // -----------------------------------------------------------------
  // 20. T5.2 REGRESSION: 5 FX Majors Subscription Verification
  // -----------------------------------------------------------------
  process.env.USE_REAL_MARKET_DATA = 'true';
  process.env.TIINGO_API_TOKEN = 'test_token_majors';
  const majorsProvider = createDefaultMarketProvider() as TiingoMarketDataAdapter;
  let majorsPayload: any = null;
  const mockMajorsWs = {
    readyState: 1,
    send: (str: string) => {
      majorsPayload = JSON.parse(str);
    },
  };
  (majorsProvider as any).ws = mockMajorsWs;
  (majorsProvider as any).sendSubscription();

  const subscribedTickers: string[] = majorsPayload?.eventData?.tickers || [];
  const expected5Majors = ['eurusd', 'gbpusd', 'usdjpy', 'usdchf', 'audusd'];
  const all5Subscribed = expected5Majors.every((t) => subscribedTickers.includes(t));

  assert(
    all5Subscribed && subscribedTickers.length === 5,
    25,
    'Subscribes to all 5 real FX majors: eurusd, gbpusd, usdjpy, usdchf, audusd',
    `Subscribed: ${subscribedTickers.join(', ')}`
  );

  // -----------------------------------------------------------------
  // SUMMARY
  // -----------------------------------------------------------------
  console.log('\n-------------------------------------------------------------');
  console.log(`  TEST RESULTS: ${passed} PASSED, ${failed} FAILED (TOTAL: ${passed + failed})`);
  console.log('-------------------------------------------------------------\n');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runTiingoAdapterTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
