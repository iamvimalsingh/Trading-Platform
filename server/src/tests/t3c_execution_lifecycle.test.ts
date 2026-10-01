/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * T3C SERVER-AUTHORITATIVE EXECUTION LIFECYCLE & REALISM FOUNDATION TEST SUITE
 * Verifies:
 * 1. MARKET BUY execution uses Ask.
 * 2. MARKET SELL execution uses Bid.
 * 3. LIMIT BUY execution uses actual trigger Ask, not requested price.
 * 4. LIMIT SELL execution uses actual trigger Bid, not requested price.
 * 5. STOP BUY execution uses actual trigger Ask.
 * 6. STOP SELL execution uses actual trigger Bid.
 * 7. Every successful order creates exactly one execution.
 * 8. Execution ID is unique.
 * 9. Execution timestamp is present and authoritative.
 * 10. Execution volume equals filled volume.
 * 11. Open execution creates exactly one position.
 * 12. Close creates a distinct closing execution.
 * 13. Realized P/L is correct.
 * 14. Unrealized BUY P/L regression.
 * 15. Unrealized SELL P/L regression.
 * 16. Zero-fee execution does not alter existing behavior.
 * 17. Execution/account/ledger mutation is not duplicated.
 * 18. Cancelled order creates no execution.
 * 19. Rejected order creates no execution.
 * 20. Replaced order creates no execution until replacement actually fills.
 * 21. Duplicate trigger cannot create duplicate execution.
 * 22. Existing T3A working-order behavior remains intact.
 * 23. Existing T3B risk behavior remains intact.
 */

import { WebSocket } from 'ws';
import { createAppAndServer } from '../index';
import { Execution, Quote, SymbolConfig, TradingAccount } from '../types/trading';
import { ExecutionResolver } from '../trading/ExecutionResolver';
import { WsEnvelope } from '../ws/wsProtocol';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testNum: number, name: string, detail?: string) {
  if (condition) {
    console.log(`  \x1b[32m✔ PASS [T3C-${testNum.toString().padStart(2, '0')}]\x1b[0m ${name}`);
    passed++;
  } else {
    console.error(`  \x1b[31m✖ FAIL [T3C-${testNum.toString().padStart(2, '0')}]\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

async function runT3CTests() {
  process.env.USE_REAL_MARKET_DATA = 'false';
  console.log('\n=============================================================');
  console.log('  RUNNING T3C EXECUTION LIFECYCLE & REALISM FOUNDATION SUITE');
  console.log('=============================================================\n');

  const { app, httpServer, runtime, wsServer } = createAppAndServer();
  let serverPort = 0;

  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => {
      const address = httpServer.address() as any;
      serverPort = address.port;
      resolve();
    });
  });

  const wsUrl = `ws://127.0.0.1:${serverPort}/ws`;
  const clientWs = new WebSocket(wsUrl);
  const messagesReceived: WsEnvelope[] = [];

  clientWs.on('message', (data) => {
    try {
      messagesReceived.push(JSON.parse(data.toString()));
    } catch {
      // ignore
    }
  });

  await new Promise<void>((resolve) => {
    clientWs.on('open', () => resolve());
  });
  await new Promise((r) => setTimeout(r, 60));

  const demoAccount = runtime.accounts.getAccount('DEMO-1001')!;
  const eurCfg = runtime.market.getSymbolConfig('EURUSD')!;
  const eurQuote = runtime.market.getQuote('EURUSD')!;

  // -------------------------------------------------------------
  // Test 1: MARKET BUY execution uses authoritative Ask
  // -------------------------------------------------------------
  const marketBuyRes = runtime.orders.executeOrder(
    {
      accountId: demoAccount.id,
      symbol: 'EURUSD',
      side: 'BUY',
      type: 'MARKET',
      volume: 0.50,
      clientOrderId: 'cli_t3c_mkt_buy',
    },
    demoAccount,
    eurQuote,
    eurCfg
  );
  assert(
    marketBuyRes.result.execution?.executionPrice === eurQuote.ask &&
    marketBuyRes.result.execution?.side === 'BUY' &&
    marketBuyRes.result.execution?.type === 'OPEN',
    1,
    'MARKET BUY execution authoritatively uses Ask price',
    `Price: ${marketBuyRes.result.execution?.executionPrice}, Ask: ${eurQuote.ask}`
  );

  // -------------------------------------------------------------
  // Test 2: MARKET SELL execution uses authoritative Bid
  // -------------------------------------------------------------
  const marketSellRes = runtime.orders.executeOrder(
    {
      accountId: demoAccount.id,
      symbol: 'EURUSD',
      side: 'SELL',
      type: 'MARKET',
      volume: 0.50,
      clientOrderId: 'cli_t3c_mkt_sell',
    },
    demoAccount,
    eurQuote,
    eurCfg
  );
  assert(
    marketSellRes.result.execution?.executionPrice === eurQuote.bid &&
    marketSellRes.result.execution?.side === 'SELL' &&
    marketSellRes.result.execution?.type === 'OPEN',
    2,
    'MARKET SELL execution authoritatively uses Bid price',
    `Price: ${marketSellRes.result.execution?.executionPrice}, Bid: ${eurQuote.bid}`
  );

  // -------------------------------------------------------------
  // Test 3: LIMIT BUY execution uses actual trigger Ask, not requested price
  // -------------------------------------------------------------
  const buyLimitRequested = Number((eurQuote.ask - 0.0040).toFixed(5));
  const buyLimitOrderRes = runtime.orders.executeOrder(
    {
      accountId: demoAccount.id,
      symbol: 'EURUSD',
      side: 'BUY',
      type: 'LIMIT',
      volume: 0.30,
      requestedPrice: buyLimitRequested,
      clientOrderId: 'cli_t3c_limit_buy',
    },
    demoAccount,
    eurQuote,
    eurCfg
  );
  // Trigger at an Ask below requested price (e.g. gap down)
  const actualTriggerAsk = Number((buyLimitRequested - 0.00030).toFixed(5));
  const triggerTickBuyLimit: Quote = {
    ...eurQuote,
    bid: actualTriggerAsk - 0.00010,
    ask: actualTriggerAsk,
  };
  const buyLimitTriggers = runtime.orders.checkWorkingOrderTriggers(
    'EURUSD',
    triggerTickBuyLimit,
    eurCfg,
    (id) => runtime.accounts.getAccount(id)
  );
  const buyLimitTriggered = buyLimitTriggers.find((t) => t.triggeredOrder.id === buyLimitOrderRes.result.order.id);
  assert(
    buyLimitTriggered?.execution?.executionPrice === actualTriggerAsk &&
    buyLimitTriggered?.execution?.executionPrice !== buyLimitRequested,
    3,
    'LIMIT BUY execution uses actual trigger Ask price, not requested price',
    `Execution: ${buyLimitTriggered?.execution?.executionPrice}, Requested: ${buyLimitRequested}`
  );

  // -------------------------------------------------------------
  // Test 4: LIMIT SELL execution uses actual trigger Bid, not requested price
  // -------------------------------------------------------------
  const sellLimitRequested = Number((eurQuote.bid + 0.0040).toFixed(5));
  const sellLimitOrderRes = runtime.orders.executeOrder(
    {
      accountId: demoAccount.id,
      symbol: 'EURUSD',
      side: 'SELL',
      type: 'LIMIT',
      volume: 0.30,
      requestedPrice: sellLimitRequested,
      clientOrderId: 'cli_t3c_limit_sell',
    },
    demoAccount,
    eurQuote,
    eurCfg
  );
  // Trigger at Bid higher than requested price
  const actualTriggerBid = Number((sellLimitRequested + 0.00020).toFixed(5));
  const triggerTickSellLimit: Quote = {
    ...eurQuote,
    bid: actualTriggerBid,
    ask: actualTriggerBid + 0.00010,
  };
  const sellLimitTriggers = runtime.orders.checkWorkingOrderTriggers(
    'EURUSD',
    triggerTickSellLimit,
    eurCfg,
    (id) => runtime.accounts.getAccount(id)
  );
  const sellLimitTriggered = sellLimitTriggers.find((t) => t.triggeredOrder.id === sellLimitOrderRes.result.order.id);
  assert(
    sellLimitTriggered?.execution?.executionPrice === actualTriggerBid &&
    sellLimitTriggered?.execution?.executionPrice !== sellLimitRequested,
    4,
    'LIMIT SELL execution uses actual trigger Bid price, not requested price',
    `Execution: ${sellLimitTriggered?.execution?.executionPrice}, Requested: ${sellLimitRequested}`
  );

  // -------------------------------------------------------------
  // Test 5: STOP BUY execution uses actual trigger Ask
  // -------------------------------------------------------------
  const buyStopRequested = Number((eurQuote.ask + 0.0050).toFixed(5));
  const buyStopOrderRes = runtime.orders.executeOrder(
    {
      accountId: demoAccount.id,
      symbol: 'EURUSD',
      side: 'BUY',
      type: 'STOP',
      volume: 0.25,
      requestedPrice: buyStopRequested,
      clientOrderId: 'cli_t3c_stop_buy',
    },
    demoAccount,
    eurQuote,
    eurCfg
  );
  const actualStopAsk = Number((buyStopRequested + 0.00040).toFixed(5));
  const triggerTickBuyStop: Quote = {
    ...eurQuote,
    bid: actualStopAsk - 0.00010,
    ask: actualStopAsk,
  };
  const buyStopTriggers = runtime.orders.checkWorkingOrderTriggers(
    'EURUSD',
    triggerTickBuyStop,
    eurCfg,
    (id) => runtime.accounts.getAccount(id)
  );
  const buyStopTriggered = buyStopTriggers.find((t) => t.triggeredOrder.id === buyStopOrderRes.result.order.id);
  assert(
    buyStopTriggered?.execution?.executionPrice === actualStopAsk,
    5,
    'STOP BUY execution uses actual trigger Ask price'
  );

  // -------------------------------------------------------------
  // Test 6: STOP SELL execution uses actual trigger Bid
  // -------------------------------------------------------------
  const sellStopRequested = Number((eurQuote.bid - 0.0050).toFixed(5));
  const sellStopOrderRes = runtime.orders.executeOrder(
    {
      accountId: demoAccount.id,
      symbol: 'EURUSD',
      side: 'SELL',
      type: 'STOP',
      volume: 0.25,
      requestedPrice: sellStopRequested,
      clientOrderId: 'cli_t3c_stop_sell',
    },
    demoAccount,
    eurQuote,
    eurCfg
  );
  const actualStopBid = Number((sellStopRequested - 0.00030).toFixed(5));
  const triggerTickSellStop: Quote = {
    ...eurQuote,
    bid: actualStopBid,
    ask: actualStopBid + 0.00010,
  };
  const sellStopTriggers = runtime.orders.checkWorkingOrderTriggers(
    'EURUSD',
    triggerTickSellStop,
    eurCfg,
    (id) => runtime.accounts.getAccount(id)
  );
  const sellStopTriggered = sellStopTriggers.find((t) => t.triggeredOrder.id === sellStopOrderRes.result.order.id);
  assert(
    sellStopTriggered?.execution?.executionPrice === actualStopBid,
    6,
    'STOP SELL execution uses actual trigger Bid price'
  );

  // -------------------------------------------------------------
  // Test 7: Every successful order creates exactly one execution
  // -------------------------------------------------------------
  runtime.clients.register('test_conn', demoAccount.id, clientWs);
  const initialExecCount = runtime.executions.getExecutionCount();
  const testOrderPlacement = await runtime.placeOrder('test_conn', {
    symbol: 'EURUSD',
    side: 'BUY',
    type: 'MARKET',
    volume: 0.10,
    clientOrderId: 'cli_single_exec_test',
  });
  const newExecCount = runtime.executions.getExecutionCount();
  assert(
    testOrderPlacement.success && newExecCount === initialExecCount + 1,
    7,
    'Every successful order creates exactly one execution record'
  );

  // -------------------------------------------------------------
  // Test 8: Execution ID is unique
  // -------------------------------------------------------------
  const exec1 = runtime.executions.recordExecution({
    id: runtime.executions.generateExecutionId(),
    accountId: demoAccount.id,
    symbol: 'EURUSD',
    side: 'BUY',
    type: 'OPEN',
    volume: 0.10,
    executionPrice: 1.08500,
    commission: 0,
    timestamp: Date.now(),
  });
  const exec2 = runtime.executions.recordExecution({
    id: runtime.executions.generateExecutionId(),
    accountId: demoAccount.id,
    symbol: 'EURUSD',
    side: 'BUY',
    type: 'OPEN',
    volume: 0.10,
    executionPrice: 1.08500,
    commission: 0,
    timestamp: Date.now(),
  });
  assert(
    exec1.id !== exec2.id && exec1.id.startsWith('exec_') && exec2.id.startsWith('exec_'),
    8,
    'Execution IDs are strictly unique and prefixed with exec_'
  );

  // -------------------------------------------------------------
  // Test 9: Execution timestamp is present and authoritative
  // -------------------------------------------------------------
  const now = Date.now();
  assert(
    typeof testOrderPlacement.execution?.timestamp === 'number' &&
    Math.abs(testOrderPlacement.execution.timestamp - now) < 2000,
    9,
    'Execution timestamp is present and authoritatively set to fill time'
  );

  // -------------------------------------------------------------
  // Test 10: Execution volume equals filled volume
  // -------------------------------------------------------------
  assert(
    testOrderPlacement.execution?.volume === 0.10 &&
    testOrderPlacement.order.volume === 0.10,
    10,
    'Execution volume equals filled volume exactly'
  );

  // -------------------------------------------------------------
  // Test 11: Open execution creates exactly one position
  // -------------------------------------------------------------
  const positionsForExec = runtime.positions.getAllOpenPositions().filter(
    (p) => p.id === testOrderPlacement.position?.id
  );
  assert(
    positionsForExec.length === 1 &&
    testOrderPlacement.execution?.positionId === testOrderPlacement.position?.id,
    11,
    'Open execution creates exactly one linked position'
  );

  // -------------------------------------------------------------
  // Test 12: Close creates a distinct closing execution
  // -------------------------------------------------------------
  const posToClose = testOrderPlacement.position!;
  const closeRes = runtime.positions.closePosition(posToClose.id, eurQuote, eurCfg, 'MANUAL');
  assert(
    closeRes.success &&
    !!closeRes.outcome?.execution &&
    closeRes.outcome.execution.type === 'CLOSE' &&
    closeRes.outcome.execution.positionId === posToClose.id &&
    closeRes.outcome.execution.id !== testOrderPlacement.execution?.id,
    12,
    'Position close creates a distinct closing execution record'
  );

  // -------------------------------------------------------------
  // Test 13: Realized P/L is correct
  // -------------------------------------------------------------
  const expectedPnL = Number(
    ((closeRes.outcome!.closedPosition.currentPrice - posToClose.openPrice) * posToClose.volume * eurCfg.contractSize).toFixed(2)
  );
  assert(
    closeRes.outcome?.realizedPnL === expectedPnL &&
    closeRes.outcome?.execution.realizedPnL === expectedPnL,
    13,
    'Closing execution captures authoritative realized P/L accurately'
  );

  // -------------------------------------------------------------
  // Test 14: Unrealized BUY P/L regression
  // -------------------------------------------------------------
  // BUY at 1.08000, Quote Bid moves to 1.08100 (+10 pips) -> PnL on 1.0 lot should be +$100.00
  const buyPnL = runtime.positions.openPosition({
    accountId: demoAccount.id,
    symbol: 'EURUSD',
    side: 'BUY',
    volume: 1.0,
    openPrice: 1.08000,
    currentPrice: 1.08000,
    unrealizedPnL: 0,
    realizedPnL: 0,
    marginLocked: 1080.00,
    openedAt: Date.now(),
    status: 'OPEN',
  });
  const higherQuote: Quote = { ...eurQuote, bid: 1.08100, ask: 1.08112 };
  const { updatedPositions: buyUpdated } = runtime.positions.updateMarkPriceAndCheckTriggers('EURUSD', higherQuote, eurCfg);
  const updatedBuy = buyUpdated.find((p) => p.id === buyPnL.id);
  assert(
    updatedBuy?.unrealizedPnL === 100.00,
    14,
    'Unrealized BUY P/L accurately responds to current Bid price (+10 pips = +$100.00)'
  );

  // -------------------------------------------------------------
  // Test 15: Unrealized SELL P/L regression
  // -------------------------------------------------------------
  // SELL at 1.08500, Quote Ask moves to 1.08400 (+10 pips profit) -> PnL on 1.0 lot should be +$100.00
  const sellPnL = runtime.positions.openPosition({
    accountId: demoAccount.id,
    symbol: 'EURUSD',
    side: 'SELL',
    volume: 1.0,
    openPrice: 1.08500,
    currentPrice: 1.08500,
    unrealizedPnL: 0,
    realizedPnL: 0,
    marginLocked: 1085.00,
    openedAt: Date.now(),
    status: 'OPEN',
  });
  const lowerQuote: Quote = { ...eurQuote, bid: 1.08388, ask: 1.08400 };
  const { updatedPositions: sellUpdated } = runtime.positions.updateMarkPriceAndCheckTriggers('EURUSD', lowerQuote, eurCfg);
  const updatedSell = sellUpdated.find((p) => p.id === sellPnL.id);
  assert(
    updatedSell?.unrealizedPnL === 100.00,
    15,
    'Unrealized SELL P/L accurately responds to current Ask price (+10 pips = +$100.00)'
  );

  // -------------------------------------------------------------
  // Test 16: Zero-fee execution does not alter existing behavior
  // -------------------------------------------------------------
  assert(
    marketBuyRes.result.execution?.commission === 0 &&
    marketBuyRes.result.execution?.fee === 0 &&
    closeRes.outcome?.execution.commission === 0,
    16,
    'Simulator fee and commission defaults to zero without altering financial balances'
  );

  // -------------------------------------------------------------
  // Test 17: Execution/account/ledger mutation is not duplicated
  // -------------------------------------------------------------
  const ledgerCountBefore = runtime.accounts.getLedger(demoAccount.id).length;
  // Closing sellPnL via runtime:
  runtime.closePosition('test_conn', sellPnL.id);
  const ledgerCountAfter = runtime.accounts.getLedger(demoAccount.id).length;
  assert(
    ledgerCountAfter === ledgerCountBefore + 1,
    17,
    'Exactly one double-entry ledger mutation occurs per closed execution'
  );

  // -------------------------------------------------------------
  // Test 18: Cancelled order creates no execution
  // -------------------------------------------------------------
  const orderToCancelRes = runtime.orders.executeOrder(
    {
      accountId: demoAccount.id,
      symbol: 'EURUSD',
      side: 'BUY',
      type: 'LIMIT',
      volume: 0.10,
      requestedPrice: 1.05000,
      clientOrderId: 'cli_t3c_cancel',
    },
    demoAccount,
    eurQuote,
    eurCfg
  );
  const execsBeforeCancel = runtime.executions.getExecutionsForOrder(orderToCancelRes.result.order.id);
  runtime.orders.cancelWorkingOrder(orderToCancelRes.result.order.id, demoAccount.id);
  const execsAfterCancel = runtime.executions.getExecutionsForOrder(orderToCancelRes.result.order.id);
  assert(
    execsBeforeCancel.length === 0 && execsAfterCancel.length === 0,
    18,
    'Cancelled order creates no execution record'
  );

  // -------------------------------------------------------------
  // Test 19: Rejected order creates no execution
  // -------------------------------------------------------------
  const rejectedRes = runtime.orders.executeOrder(
    {
      accountId: demoAccount.id,
      symbol: 'EURUSD',
      side: 'BUY',
      type: 'MARKET',
      volume: 500.0, // Exceeds max volume
      clientOrderId: 'cli_t3c_rejected',
    },
    demoAccount,
    eurQuote,
    eurCfg
  );
  assert(
    rejectedRes.result.order.status === 'REJECTED' &&
    !rejectedRes.result.execution,
    19,
    'Rejected order creates no execution record'
  );

  // -------------------------------------------------------------
  // Test 20: Replaced order creates no execution until replacement fills
  // -------------------------------------------------------------
  const orderToReplaceRes = runtime.orders.executeOrder(
    {
      accountId: demoAccount.id,
      symbol: 'EURUSD',
      side: 'BUY',
      type: 'LIMIT',
      volume: 0.10,
      requestedPrice: 1.05000,
      clientOrderId: 'cli_t3c_replace_pending',
    },
    demoAccount,
    eurQuote,
    eurCfg
  );
  const replaceRes = runtime.orders.replaceWorkingOrder(
    {
      orderId: orderToReplaceRes.result.order.id,
      requestedPrice: 1.05500,
      volume: 0.20,
    },
    demoAccount.id,
    demoAccount,
    eurQuote,
    eurCfg
  );
  assert(
    replaceRes.success &&
    !replaceRes.execution &&
    replaceRes.newOrder?.status === 'WORKING',
    20,
    'Replaced order creates no execution while new order is in WORKING state'
  );

  // -------------------------------------------------------------
  // Test 21: Duplicate trigger cannot create duplicate execution
  // -------------------------------------------------------------
  const duplicateStopRes = runtime.orders.executeOrder(
    {
      accountId: demoAccount.id,
      symbol: 'EURUSD',
      side: 'BUY',
      type: 'STOP',
      volume: 0.15,
      requestedPrice: 1.09000,
      clientOrderId: 'cli_t3c_dup_stop',
    },
    demoAccount,
    eurQuote,
    eurCfg
  );
  const triggerDupTick: Quote = { ...eurQuote, bid: 1.09010, ask: 1.09020 };
  const firstTriggerOutcomes = runtime.orders.checkWorkingOrderTriggers('EURUSD', triggerDupTick, eurCfg);
  const secondTriggerOutcomes = runtime.orders.checkWorkingOrderTriggers('EURUSD', triggerDupTick, eurCfg);
  const firstExec = firstTriggerOutcomes.find((t) => t.triggeredOrder.id === duplicateStopRes.result.order.id);
  const secondExec = secondTriggerOutcomes.find((t) => t.triggeredOrder.id === duplicateStopRes.result.order.id);
  assert(
    !!firstExec?.execution && !secondExec,
    21,
    'Subsequent trigger tick produces no duplicate execution for completed order'
  );

  // -------------------------------------------------------------
  // Test 22: Existing T3A working-order behavior remains intact
  // -------------------------------------------------------------
  const workingOrdersAccount = runtime.orders.getWorkingOrdersForAccount(demoAccount.id);
  assert(
    Array.isArray(workingOrdersAccount) &&
    workingOrdersAccount.every((o) => o.status === 'WORKING'),
    22,
    'Existing T3A working orders indexing and retrieval invariant preserved'
  );

  // -------------------------------------------------------------
  // Test 23: Existing T3B risk behavior remains intact
  // -------------------------------------------------------------
  const riskCheckSufficient = runtime.orders.executeOrder(
    {
      accountId: demoAccount.id,
      symbol: 'EURUSD',
      side: 'BUY',
      type: 'LIMIT',
      volume: 0.05,
      requestedPrice: 1.06000,
    },
    demoAccount,
    eurQuote,
    eurCfg
  );
  assert(
    riskCheckSufficient.result.order.status === 'WORKING',
    23,
    'Existing T3B pre-trade risk and trigger-time validation contract intact'
  );

  // Teardown
  clientWs.close();
  wsServer.close();
  httpServer.close();
  runtime.stop();

  console.log('\n-------------------------------------------------------------');
  console.log(`TOTAL T3C TESTS: ${passed + failed} | PASSED: \x1b[32m${passed}\x1b[0m | FAILED: \x1b[31m${failed}\x1b[0m`);
  console.log('-------------------------------------------------------------\n');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runT3CTests().catch((err) => {
  console.error('Fatal T3C test error:', err);
  process.exit(1);
});
