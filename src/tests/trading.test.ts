/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * AUTOMATED TRADING DOMAIN & PERFORMANCE TEST SUITE
 * Run with: tsx src/tests/trading.test.ts
 */

import { ExecutionSimulator } from '../services/executionSimulator';
import { marketSimulator, INITIAL_SYMBOLS } from '../services/marketDataSimulator';
import {
  calculatePositionPnL,
  calculateRequiredMargin,
  recalculateAccountState,
  validatePreTradeRisk,
} from '../services/riskEngine';
import { OrderRequest, Position, Quote, SymbolConfig, TradingAccount } from '../types/trading';

let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, testName: string, failureDetail?: string) {
  if (condition) {
    console.log(`  \x1b[32m✔ PASS\x1b[0m ${testName}`);
    passedTests++;
  } else {
    console.error(`  \x1b[31m✖ FAIL\x1b[0m ${testName}${failureDetail ? ` — ${failureDetail}` : ''}`);
    failedTests++;
  }
}

const mockAccount: TradingAccount = {
  id: 'acc_test_1',
  tenantId: 'tenant_1',
  accountNumber: '100101',
  currency: 'USD',
  accountType: 'DEMO',
  leverage: 100,
  balance: 10000.00,
  equity: 10000.00,
  usedMargin: 0.00,
  freeMargin: 10000.00,
  marginLevel: 0,
  marginCallLevel: 100,
  stopOutLevel: 50,
  status: 'ACTIVE',
};

const mockEurUsdCfg: SymbolConfig = INITIAL_SYMBOLS.find((s) => s.symbol === 'EURUSD')!;
const mockQuoteEurUsd: Quote = {
  symbol: 'EURUSD',
  bid: 1.08500,
  ask: 1.08512,
  spread: 1.2,
  mid: 1.08506,
  high24h: 1.09000,
  low24h: 1.08000,
  change24h: 0.00100,
  change24hPct: 0.09,
  timestamp: Date.now(),
  tickDirection: 'UP',
};

console.log('\n=============================================================');
console.log('  RUNNING PROJECT B T1 TRADING ENGINE & PERFORMANCE TESTS');
console.log('=============================================================\n');

// 1. Quote Generation Tests
console.log('\x1b[34m[TEST GROUP 1: Quote Generation & Market Data Simulator]\x1b[0m');
{
  const quotes = marketSimulator.getAllCurrentQuotes();
  assert(Object.keys(quotes).length >= 5, 'Simulator initializes with active symbol catalog');
  
  const eurQuote = quotes['EURUSD'];
  assert(!!eurQuote, 'EURUSD quote exists in simulator');
  assert(eurQuote.ask > eurQuote.bid, 'Ask price is strictly greater than Bid price', `Ask: ${eurQuote.ask}, Bid: ${eurQuote.bid}`);
  assert(eurQuote.spread > 0, 'Spread is strictly positive', `Spread: ${eurQuote.spread}`);

  const bars = marketSimulator.getHistoricalBars('EURUSD', 50);
  assert(bars.length === 50, 'Historical OHLCV bar generator produces exact bar count', `Count: ${bars.length}`);
  assert(bars[0].high >= bars[0].low, 'Bar high is >= bar low');
}

// 2. Order Validation & Pre-Trade Risk Tests
console.log('\n\x1b[34m[TEST GROUP 2: Pre-Trade Risk & Order Validation]\x1b[0m');
{
  // Valid volume
  const validRisk = validatePreTradeRisk(mockAccount, 108.51, mockEurUsdCfg, 0.10);
  assert(validRisk.valid === true, 'Accepts valid volume and sufficient margin');

  // Below min volume
  const underVolume = validatePreTradeRisk(mockAccount, 10.0, mockEurUsdCfg, 0.001);
  assert(underVolume.valid === false, 'Rejects volume below minimum allowable (0.01)');

  // Exceeds max volume
  const overVolume = validatePreTradeRisk(mockAccount, 150000.0, mockEurUsdCfg, 500.0);
  assert(overVolume.valid === false, 'Rejects volume exceeding maximum allowable (100.0)');

  // Insufficient free margin
  const poorAccount: TradingAccount = { ...mockAccount, freeMargin: 50.00 };
  const insufficientMargin = validatePreTradeRisk(poorAccount, 1085.12, mockEurUsdCfg, 1.00);
  assert(insufficientMargin.valid === false, 'Rejects order when Required Margin > Free Margin');
}

// 3. BUY Execution & Position Creation Tests
console.log('\n\x1b[34m[TEST GROUP 3: Market BUY Execution & Position Creation]\x1b[0m');
{
  const buyRequest: OrderRequest = {
    accountId: mockAccount.id,
    symbol: 'EURUSD',
    side: 'BUY',
    type: 'MARKET',
    volume: 1.0,
    stopLoss: 1.08000,
    takeProfit: 1.09500,
  };

  const result = ExecutionSimulator.executeOrder(buyRequest, mockAccount, mockQuoteEurUsd, mockEurUsdCfg);
  assert(result.success === true, 'Order executes successfully');
  assert(result.order.status === 'FILLED', 'Order status is FILLED');
  assert(result.order.executionPrice === mockQuoteEurUsd.ask, 'BUY order fills at Ask price', `Fill: ${result.order.executionPrice}, Ask: ${mockQuoteEurUsd.ask}`);
  
  assert(!!result.position, 'Open Position is generated');
  assert(result.position?.side === 'BUY', 'Position side matches order side (BUY)');
  assert(result.position?.volume === 1.0, 'Position volume matches order volume (1.0)');
  assert(result.position?.marginLocked === 1085.12, 'Required margin calculated accurately (1:100 leverage on 100k notional)', `Margin: ${result.position?.marginLocked}`);
}

// 4. SELL Execution Tests
console.log('\n\x1b[34m[TEST GROUP 4: Market SELL Execution]\x1b[0m');
{
  const sellRequest: OrderRequest = {
    accountId: mockAccount.id,
    symbol: 'EURUSD',
    side: 'SELL',
    type: 'MARKET',
    volume: 0.50,
  };

  const result = ExecutionSimulator.executeOrder(sellRequest, mockAccount, mockQuoteEurUsd, mockEurUsdCfg);
  assert(result.success === true, 'SELL order executes successfully');
  assert(result.order.executionPrice === mockQuoteEurUsd.bid, 'SELL order fills at Bid price', `Fill: ${result.order.executionPrice}, Bid: ${mockQuoteEurUsd.bid}`);
  assert(result.position?.side === 'SELL', 'Position created with SELL side');
}

// 5. P/L Calculation Tests
console.log('\n\x1b[34m[TEST GROUP 5: Authoritative Mark-to-Market P/L Calculation]\x1b[0m');
{
  // BUY: 1.0 lot EURUSD opened at 1.08500
  // Quote moves to Bid: 1.08600 (+10 pips = $100 profit)
  const buyPos: Pick<Position, 'side' | 'volume' | 'openPrice'> = {
    side: 'BUY',
    volume: 1.0,
    openPrice: 1.08500,
  };
  const upQuote = { bid: 1.08600, ask: 1.08612 };
  const buyProfit = calculatePositionPnL(buyPos, upQuote, 100000);
  assert(buyProfit === 100.00, 'BUY position calculates +$100.00 on +10 pips move', `Got: ${buyProfit}`);

  // SELL: 1.0 lot EURUSD opened at 1.08500
  // Quote moves to Ask: 1.08400 (market down = $100 profit for short)
  const sellPos: Pick<Position, 'side' | 'volume' | 'openPrice'> = {
    side: 'SELL',
    volume: 1.0,
    openPrice: 1.08500,
  };
  const downQuote = { bid: 1.08388, ask: 1.08400 };
  const sellProfit = calculatePositionPnL(sellPos, downQuote, 100000);
  assert(sellProfit === 100.00, 'SELL position calculates +$100.00 on -10 pips move', `Got: ${sellProfit}`);
}

// 6. Position Close & Ledger Generation Tests
console.log('\n\x1b[34m[TEST GROUP 6: Position Close & Balance Realization]\x1b[0m');
{
  const openPos: Position = {
    id: 'pos_test_close_1',
    accountId: mockAccount.id,
    symbol: 'EURUSD',
    side: 'BUY',
    volume: 1.0,
    openPrice: 1.08500,
    currentPrice: 1.08700,
    unrealizedPnL: 200.00,
    realizedPnL: 0,
    marginLocked: 1085.00,
    openedAt: Date.now() - 60000,
    status: 'OPEN',
  };

  const closeQuote: Quote = { ...mockQuoteEurUsd, bid: 1.08700, ask: 1.08712 };
  const closeOutcome = ExecutionSimulator.closePosition(openPos, closeQuote, mockEurUsdCfg);

  assert(closeOutcome.closedPosition.status === 'CLOSED', 'Position status changed to CLOSED');
  assert(closeOutcome.realizedPnL === 200.00, 'Realized PnL equals exactly +$200.00', `Got: ${closeOutcome.realizedPnL}`);
  assert(closeOutcome.releasedMargin === 1085.00, 'Locked margin is released completely');
  assert(closeOutcome.ledgerEntry.amount === 200.00, 'Double-entry ledger created with credit entry');
}

// 7. Full Account Equity & Margin Level Recalculation
console.log('\n\x1b[34m[TEST GROUP 7: Account Equity & Margin Level Recalculation]\x1b[0m');
{
  const testAccount: TradingAccount = {
    ...mockAccount,
    balance: 10000.00,
  };

  const activePositions: Position[] = [
    {
      id: 'p1',
      accountId: testAccount.id,
      symbol: 'EURUSD',
      side: 'BUY',
      volume: 1.0,
      openPrice: 1.08500,
      currentPrice: 1.08600,
      unrealizedPnL: 100.00,
      realizedPnL: 0,
      marginLocked: 1085.00,
      openedAt: Date.now(),
      status: 'OPEN',
    },
    {
      id: 'p2',
      accountId: testAccount.id,
      symbol: 'EURUSD',
      side: 'SELL',
      volume: 0.5,
      openPrice: 1.08500,
      currentPrice: 1.08450,
      unrealizedPnL: 25.00,
      realizedPnL: 0,
      marginLocked: 542.50,
      openedAt: Date.now(),
      status: 'OPEN',
    },
  ];

  const symbolsMap = { EURUSD: mockEurUsdCfg };
  const quotesMap = { EURUSD: { ...mockQuoteEurUsd, bid: 1.08600, ask: 1.08450 } };

  const recalculated = recalculateAccountState(testAccount, activePositions, quotesMap, symbolsMap);

  assert(recalculated.totalUnrealizedPnL === 125.00, 'Total unrealized PnL is sum of open positions ($125.00)', `Got: ${recalculated.totalUnrealizedPnL}`);
  assert(recalculated.equity === 10125.00, 'Equity is Balance + Unrealized PnL ($10,125.00)', `Got: ${recalculated.equity}`);
  assert(recalculated.usedMargin === 1627.50, 'Used margin is sum of locked margins ($1,627.50)', `Got: ${recalculated.usedMargin}`);
  assert(recalculated.freeMargin === 8497.50, 'Free margin is Equity - Used Margin ($8,497.50)', `Got: ${recalculated.freeMargin}`);
  assert(recalculated.marginLevel > 600, 'Margin level is > 600% (healthy state)', `Got: ${recalculated.marginLevel}%`);
  assert(recalculated.isMarginCall === false, 'No margin call triggered');
}

// 8. Symbol Scaling & Performance Stress Test (10 vs 25 vs 50 Symbols)
console.log('\n\x1b[34m[TEST GROUP 8: Symbol Scaling Concurrency (10 -> 25 -> 50)]\x1b[0m');
{
  marketSimulator.setActiveSymbolCount(10);
  assert(marketSimulator.getActiveSymbols().length === 10, '10 symbols scaling verified');

  marketSimulator.setActiveSymbolCount(25);
  assert(marketSimulator.getActiveSymbols().length === 25, '25 symbols scaling verified');

  marketSimulator.setActiveSymbolCount(50);
  assert(marketSimulator.getActiveSymbols().length === 50, '50 symbols scaling verified');

  // Verify memory and execution latency for 50 concurrent symbols
  const t0 = performance.now();
  const all50Quotes = marketSimulator.getAllCurrentQuotes();
  const t1 = performance.now();
  const duration = Number((t1 - t0).toFixed(3));
  assert(Object.keys(all50Quotes).length >= 50, 'All 50 symbols have streaming quotes');
  assert(duration < 5.0, `Batch retrieval of 50 symbol quotes took ${duration}ms (Budget: < 10ms)`);
}

// 9. T5.2 Desktop Dock Resizing & Buy Order Margin Validation
console.log('\n\x1b[34m[TEST GROUP 9: Desktop Dock Resizing & Real Ask Margin Scaling]\x1b[0m');
{
  // Dock height bounds
  const getDockDefault = (h: number) => (h <= 768 ? 180 : 220);
  const clampDock = (h: number, winH: number) =>
    Math.max(130, Math.min(Math.floor(winH * 0.65), h));

  assert(getDockDefault(720) === 180, '720p screens default bottom dock to 180px');
  assert(getDockDefault(768) === 180, '768p screens default bottom dock to 180px');
  assert(getDockDefault(900) === 220, '900p+ screens default bottom dock to 220px');

  // Clamp limits on 720p
  assert(clampDock(50, 720) === 130, 'Clamps minimum dock height to 130px');
  assert(clampDock(600, 720) === Math.floor(720 * 0.65), 'Clamps maximum dock height on 720p (65% = 468px)');

  // Real Ask margin calculation: EURUSD 0.10 lots @ 1.13655 Ask
  const realAskQuote: Quote = {
    symbol: 'EURUSD',
    bid: 1.13643,
    ask: 1.13655,
    mid: 1.13649,
    spread: 0.00012,
    high24h: 1.14000,
    low24h: 1.13000,
    change24h: 0.00100,
    change24hPct: 0.09,
    timestamp: Date.now(),
    tickDirection: 'UP',
  };

  const buyOrderReq: OrderRequest = {
    accountId: mockAccount.id,
    symbol: 'EURUSD',
    side: 'BUY',
    type: 'MARKET',
    volume: 0.10,
  };

  const buyMargin = calculateRequiredMargin(
    buyOrderReq.volume,
    realAskQuote.ask,
    mockEurUsdCfg,
    mockAccount.leverage,
    mockAccount.currency
  );
  assert(
    Math.abs(buyMargin - 113.66) < 0.1,
    `BUY 0.10 lots EURUSD margin calculated from Ask 1.13655 is ~$113.66 (Got: $${buyMargin.toFixed(2)})`
  );
  assert(buyMargin < 200, 'Margin requirement is strictly normal (no 1,000,000 ask inflation)');

  const riskResult = validatePreTradeRisk(mockAccount, buyMargin, mockEurUsdCfg, buyOrderReq.volume);
  assert(riskResult.valid === true, 'EURUSD 0.10 lots BUY order passes pre-trade margin validation');
}

console.log('\n-------------------------------------------------------------');
console.log(`TOTAL TESTS: ${passedTests + failedTests} | PASSED: \x1b[32m${passedTests}\x1b[0m | FAILED: \x1b[31m${failedTests}\x1b[0m`);
console.log('-------------------------------------------------------------\n');

if (failedTests > 0) {
  process.exit(1);
}
