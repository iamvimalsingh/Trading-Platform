/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * T3A SERVER-AUTHORITATIVE WORKING ORDERS TEST SUITE
 * Tests LIMIT, STOP, CANCEL, REPLACE, Triggers, Idempotency, and Lifecycle.
 * Run with: tsx server/src/tests/working_orders.test.ts
 */

import fs from 'fs';
import path from 'path';
import { WebSocket } from 'ws';
import { createAppAndServer } from '../index';
import { DatabaseClient } from '../db/DatabaseClient';
import { Quote } from '../types/trading';
import { WsEnvelope } from '../ws/wsProtocol';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testNum: number, name: string, detail?: string) {
  if (condition) {
    console.log(`  \x1b[32m✔ PASS [T3A-${testNum.toString().padStart(2, '0')}]\x1b[0m ${name}`);
    passed++;
  } else {
    console.error(`  \x1b[31m✖ FAIL [T3A-${testNum.toString().padStart(2, '0')}]\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

async function runWorkingOrdersTests() {
  process.env.USE_REAL_MARKET_DATA = 'false';

  const testDbDir = path.resolve(process.cwd(), 'data', 'test_working_orders_db');
  if (fs.existsSync(testDbDir)) {
    fs.rmSync(testDbDir, { recursive: true, force: true });
  }
  process.env.DATABASE_STORAGE_PATH = testDbDir;
  DatabaseClient.resetInstance();
  console.log('\n=============================================================');
  console.log('  RUNNING T3A SERVER-AUTHORITATIVE WORKING ORDERS TEST SUITE');
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

  await runtime.persistence.init();

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

  // -------------------------------------------------------------
  // Test 1: Place BUY LIMIT order below market Ask
  // -------------------------------------------------------------
  const eurQuote = runtime.market.getQuote('EURUSD')!;
  const limitPrice = Number((eurQuote.ask - 0.0050).toFixed(5)); // 50 pips below market

  clientWs.send(JSON.stringify({
    type: 'PLACE_ORDER',
    requestId: 'req_limit_1',
    timestamp: Date.now(),
    payload: {
      symbol: 'EURUSD',
      side: 'BUY',
      type: 'LIMIT',
      volume: 0.50,
      requestedPrice: limitPrice,
      stopLoss: limitPrice - 0.0030,
      takeProfit: limitPrice + 0.0060,
      clientOrderId: 'cli_limit_buy_1',
    },
  }));

  let ackLimit1: any;
  for (let i = 0; i < 30; i++) {
    ackLimit1 = messagesReceived.find((m) => m.type === 'ORDER_ACK' && m.requestId === 'req_limit_1');
    if (ackLimit1) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  const order1 = (ackLimit1?.payload as any)?.order;

  assert(
    !!order1 && order1.status === 'WORKING' && order1.requestedPrice === limitPrice,
    1,
    'Server places BUY LIMIT order in WORKING state below market Ask',
    `Status: ${order1?.status}, Price: ${order1?.requestedPrice}`
  );

  // -------------------------------------------------------------
  // Test 2: Working Order registry tracks the order
  // -------------------------------------------------------------
  const workingOrders = runtime.orders.getWorkingOrdersForAccount(demoAccount.id);
  assert(
    workingOrders.some((o) => o.id === order1.id),
    2,
    'Working order registry maintains active working order by symbol/account'
  );

  // -------------------------------------------------------------
  // Test 3: Idempotency: Duplicate clientOrderId does not duplicate working order
  // -------------------------------------------------------------
  const prevCount = runtime.orders.getWorkingOrderCount();
  clientWs.send(JSON.stringify({
    type: 'PLACE_ORDER',
    requestId: 'req_limit_duplicate',
    timestamp: Date.now(),
    payload: {
      symbol: 'EURUSD',
      side: 'BUY',
      type: 'LIMIT',
      volume: 0.50,
      requestedPrice: limitPrice,
      clientOrderId: 'cli_limit_buy_1',
    },
  }));
  await new Promise((r) => setTimeout(r, 100));
  const newCount = runtime.orders.getWorkingOrderCount();
  assert(
    newCount === prevCount,
    3,
    'Duplicate clientOrderId idempotently returns existing order without creating duplicate'
  );

  // -------------------------------------------------------------
  // Test 4: Pre-trade risk validation rejects excessive volume on Limit order
  // -------------------------------------------------------------
  clientWs.send(JSON.stringify({
    type: 'PLACE_ORDER',
    requestId: 'req_limit_exceed_risk',
    timestamp: Date.now(),
    payload: {
      symbol: 'EURUSD',
      side: 'BUY',
      type: 'LIMIT',
      volume: 50.0, // Insufficient margin
      requestedPrice: limitPrice,
      clientOrderId: 'cli_limit_huge',
    },
  }));
  for (let i = 0; i < 20; i++) {
    if (messagesReceived.find((m) => m.type === 'ORDER_ACK' && m.requestId === 'req_limit_exceed_risk')) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  const ackRisk = messagesReceived.find((m) => m.type === 'ORDER_ACK' && m.requestId === 'req_limit_exceed_risk');
  const rejectedOrder = (ackRisk?.payload as any)?.order;
  assert(
    rejectedOrder?.status === 'REJECTED',
    4,
    'Pre-trade risk engine rejects working order with insufficient free margin'
  );

  // -------------------------------------------------------------
  // Test 5: REPLACE working order (Modify Limit Price & Volume)
  // -------------------------------------------------------------
  const newLimitPrice = Number((limitPrice + 0.0010).toFixed(5));
  clientWs.send(JSON.stringify({
    type: 'REPLACE_ORDER',
    requestId: 'req_replace_1',
    timestamp: Date.now(),
    payload: {
      orderId: order1.id,
      requestedPrice: newLimitPrice,
      volume: 0.80,
    },
  }));
  await new Promise((r) => setTimeout(r, 100));

  const originalAfterReplace = runtime.orders.getOrder(order1.id);
  assert(
    originalAfterReplace?.status === 'REPLACED',
    5,
    'Original working order transitions to REPLACED status upon replacement'
  );

  const updatedWorkingOrders = runtime.orders.getWorkingOrdersForAccount(demoAccount.id);
  const replacedWorkingOrder = updatedWorkingOrders.find(
    (o) => o.symbol === 'EURUSD' && o.requestedPrice === newLimitPrice && o.volume === 0.80
  );
  assert(
    !!replacedWorkingOrder && replacedWorkingOrder.status === 'WORKING',
    6,
    'New active working order is created with updated price and volume',
    `New Order ID: ${replacedWorkingOrder?.id}`
  );

  // -------------------------------------------------------------
  // Test 6: CANCEL working order
  // -------------------------------------------------------------
  clientWs.send(JSON.stringify({
    type: 'CANCEL_ORDER',
    requestId: 'req_cancel_1',
    timestamp: Date.now(),
    payload: {
      orderId: replacedWorkingOrder!.id,
    },
  }));
  await new Promise((r) => setTimeout(r, 100));

  const orderAfterCancel = runtime.orders.getOrder(replacedWorkingOrder!.id);
  assert(
    orderAfterCancel?.status === 'CANCELLED',
    7,
    'CANCEL_ORDER command transitions working order to CANCELLED status'
  );

  const workingAfterCancel = runtime.orders.getWorkingOrdersForAccount(demoAccount.id);
  assert(
    !workingAfterCancel.some((o) => o.id === replacedWorkingOrder!.id),
    8,
    'Cancelled order is removed from active working orders set'
  );

  // -------------------------------------------------------------
  // Test 7: Reject invalid cancellation of already cancelled order
  // -------------------------------------------------------------
  clientWs.send(JSON.stringify({
    type: 'CANCEL_ORDER',
    requestId: 'req_cancel_invalid',
    timestamp: Date.now(),
    payload: {
      orderId: replacedWorkingOrder!.id,
    },
  }));
  for (let i = 0; i < 20; i++) {
    if (messagesReceived.find((m) => m.type === 'ERROR' && m.requestId === 'req_cancel_invalid')) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  const cancelError = messagesReceived.find((m) => m.type === 'ERROR' && m.requestId === 'req_cancel_invalid');
  assert(
    !!cancelError,
    9,
    'Reject cancelling already cancelled order with deterministic error message'
  );

  // -------------------------------------------------------------
  // Test 8: BUY LIMIT Trigger Execution on Market Quote Movement
  // -------------------------------------------------------------
  // Place fresh BUY LIMIT at 1.08000
  const triggerLimitPrice = 1.08000;
  const placeTriggerRes = runtime.orders.executeOrder(
    {
      accountId: demoAccount.id,
      symbol: 'EURUSD',
      side: 'BUY',
      type: 'LIMIT',
      volume: 0.20,
      requestedPrice: triggerLimitPrice,
      stopLoss: 1.07500,
      takeProfit: 1.09000,
      clientOrderId: 'cli_trigger_limit_1',
    },
    demoAccount,
    eurQuote,
    eurCfg
  );
  const triggerOrder = placeTriggerRes.result.order;
  assert(triggerOrder.status === 'WORKING', 10, 'Fresh BUY LIMIT placed successfully');

  // Simulate market moving down so Ask <= 1.08000
  const simulatedTickDown: Quote = {
    ...eurQuote,
    bid: 1.07980,
    ask: 1.07990, // Ask <= 1.08000 -> TRIGGERS BUY LIMIT
  };

  const triggeredResults = runtime.orders.checkWorkingOrderTriggers('EURUSD', simulatedTickDown, eurCfg);
  const triggeredBuyLimit = triggeredResults.find((t) => t.triggeredOrder.id === triggerOrder.id);

  assert(
    !!triggeredBuyLimit && triggeredBuyLimit.triggeredOrder.status === 'FILLED',
    11,
    'Server-authoritative BUY LIMIT triggers when Ask <= limit price and fills at Ask',
    `Fill: ${triggeredBuyLimit?.triggeredOrder.executionPrice}`
  );

  assert(
    triggeredBuyLimit?.positionTemplate?.openPrice === 1.07990,
    12,
    'Position template materialized with exact trigger Ask price'
  );

  // -------------------------------------------------------------
  // Test 9: SELL STOP Trigger Execution on Market Quote Movement
  // -------------------------------------------------------------
  // Place SELL STOP at 1.07500 (below market)
  const stopPrice = 1.07500;
  const placeStopRes = runtime.orders.executeOrder(
    {
      accountId: demoAccount.id,
      symbol: 'EURUSD',
      side: 'SELL',
      type: 'STOP',
      volume: 0.30,
      requestedPrice: stopPrice,
      clientOrderId: 'cli_trigger_stop_1',
    },
    demoAccount,
    simulatedTickDown,
    eurCfg
  );
  const stopOrder = placeStopRes.result.order;
  assert(stopOrder.status === 'WORKING', 13, 'SELL STOP placed in WORKING state below market');

  // Simulate market dropping to Bid <= 1.07500
  const simulatedDrop: Quote = {
    ...simulatedTickDown,
    bid: 1.07480, // Bid <= 1.07500 -> TRIGGERS SELL STOP
    ask: 1.07490,
  };

  const triggeredStopResults = runtime.orders.checkWorkingOrderTriggers('EURUSD', simulatedDrop, eurCfg);
  const triggeredSellStop = triggeredStopResults.find((t) => t.triggeredOrder.id === stopOrder.id);

  assert(
    !!triggeredSellStop && triggeredSellStop.triggeredOrder.status === 'FILLED',
    14,
    'Server-authoritative SELL STOP triggers when Bid <= stop price and fills at Bid',
    `Fill: ${triggeredSellStop?.triggeredOrder.executionPrice}`
  );

  // -------------------------------------------------------------
  // Test 10: BUY STOP Trigger Execution (when Ask >= stop price)
  // -------------------------------------------------------------
  const buyStopPrice = 1.09000;
  const buyStopRes = runtime.orders.executeOrder(
    {
      accountId: demoAccount.id,
      symbol: 'EURUSD',
      side: 'BUY',
      type: 'STOP',
      volume: 0.25,
      requestedPrice: buyStopPrice,
      clientOrderId: 'cli_trigger_buy_stop',
    },
    demoAccount,
    simulatedDrop,
    eurCfg
  );
  const buyStopOrder = buyStopRes.result.order;
  assert(buyStopOrder.status === 'WORKING', 15, 'BUY STOP placed in WORKING state above market');

  // Simulate market rally to Ask >= 1.09000
  const simulatedRally: Quote = {
    ...simulatedDrop,
    bid: 1.09010,
    ask: 1.09020, // Ask >= 1.09000 -> TRIGGERS BUY STOP
  };

  const triggeredBuyStopResults = runtime.orders.checkWorkingOrderTriggers('EURUSD', simulatedRally, eurCfg);
  const triggeredBuyStop = triggeredBuyStopResults.find((t) => t.triggeredOrder.id === buyStopOrder.id);

  assert(
    !!triggeredBuyStop && triggeredBuyStop.triggeredOrder.status === 'FILLED' && triggeredBuyStop.triggeredOrder.executionPrice === 1.09020,
    16,
    'BUY STOP triggers when Ask >= stop price and fills at Ask price'
  );

  // -------------------------------------------------------------
  // Test 11: SELL LIMIT Trigger Execution (when Bid >= limit price)
  // -------------------------------------------------------------
  const sellLimitPrice = 1.09500;
  const sellLimitRes = runtime.orders.executeOrder(
    {
      accountId: demoAccount.id,
      symbol: 'EURUSD',
      side: 'SELL',
      type: 'LIMIT',
      volume: 0.40,
      requestedPrice: sellLimitPrice,
      clientOrderId: 'cli_trigger_sell_limit',
    },
    demoAccount,
    simulatedRally,
    eurCfg
  );
  const sellLimitOrder = sellLimitRes.result.order;
  assert(sellLimitOrder.status === 'WORKING', 17, 'SELL LIMIT placed in WORKING state above market');

  const simulatedHighTick: Quote = {
    ...simulatedRally,
    bid: 1.09510, // Bid >= 1.09500 -> TRIGGERS SELL LIMIT
    ask: 1.09520,
  };

  const triggeredSellLimitResults = runtime.orders.checkWorkingOrderTriggers('EURUSD', simulatedHighTick, eurCfg);
  const triggeredSellLimit = triggeredSellLimitResults.find((t) => t.triggeredOrder.id === sellLimitOrder.id);

  assert(
    !!triggeredSellLimit && triggeredSellLimit.triggeredOrder.status === 'FILLED' && triggeredSellLimit.triggeredOrder.executionPrice === 1.09510,
    18,
    'SELL LIMIT triggers when Bid >= limit price and fills at Bid price'
  );

  // -------------------------------------------------------------
  // Test 12: Filled order cannot be cancelled or replaced
  // -------------------------------------------------------------
  const cancelFilledRes = runtime.orders.cancelWorkingOrder(triggeredSellLimit!.triggeredOrder.id, demoAccount.id);
  assert(
    cancelFilledRes.success === false,
    19,
    'OrderEngine rejects cancellation of already FILLED order'
  );

  const replaceFilledRes = runtime.orders.replaceWorkingOrder(
    { orderId: triggeredSellLimit!.triggeredOrder.id, requestedPrice: 1.10 },
    demoAccount.id,
    demoAccount,
    simulatedHighTick,
    eurCfg
  );
  assert(
    replaceFilledRes.success === false,
    20,
    'OrderEngine rejects replacement of already FILLED order'
  );

  // Teardown
  clientWs.close();
  wsServer.close();
  httpServer.close();
  runtime.stop();

  console.log('\n-------------------------------------------------------------');
  console.log(`TOTAL TESTS: ${passed + failed} | PASSED: \x1b[32m${passed}\x1b[0m | FAILED: \x1b[31m${failed}\x1b[0m`);
  console.log('-------------------------------------------------------------\n');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runWorkingOrdersTests().catch((err) => {
  console.error('Fatal working orders test error:', err);
  process.exit(1);
});
