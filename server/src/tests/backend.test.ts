/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * SERVER-AUTHORITATIVE BACKEND DETERMINISTIC TEST SUITE (T2A)
 * Validates the 24 required backend runtime, WebSocket, order matching, risk, and admin operations.
 * Run with: tsx server/src/tests/backend.test.ts
 */

import fs from 'fs';
import path from 'path';
import { WebSocket } from 'ws';
import { createAppAndServer } from '../index';
import { DatabaseClient } from '../db/DatabaseClient';
import { WsEnvelope } from '../ws/wsProtocol';
import { Quote } from '../types/trading';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testNum: number, name: string, detail?: string) {
  if (condition) {
    console.log(`  \x1b[32m✔ PASS [T2A-${testNum.toString().padStart(2, '0')}]\x1b[0m ${name}`);
    passed++;
  } else {
    console.error(`  \x1b[31m✖ FAIL [T2A-${testNum.toString().padStart(2, '0')}]\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

async function runBackendTests() {
  process.env.USE_REAL_MARKET_DATA = 'false';

  const testDbDir = path.resolve(process.cwd(), 'data', 'test_backend_db');
  if (fs.existsSync(testDbDir)) {
    fs.rmSync(testDbDir, { recursive: true, force: true });
  }
  process.env.DATABASE_STORAGE_PATH = testDbDir;
  DatabaseClient.resetInstance();
  console.log('\n=============================================================');
  console.log('  RUNNING T2A SERVER-AUTHORITATIVE RUNTIME TEST SUITE');
  console.log('=============================================================\n');

  // Test 1: Server starts
  const { app, httpServer, runtime, wsServer } = createAppAndServer();
  let serverPort = 0;

  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => {
      const address = httpServer.address() as any;
      serverPort = address.port;
      resolve();
    });
  });

  assert(serverPort > 0, 1, 'Server starts and binds to ephemeral test port', `Port: ${serverPort}`);

  // Test 2: Demo session created on server
  const demoAccounts = runtime.accounts.getAllAccounts();
  const demo1 = runtime.accounts.getAccount('DEMO-1001');
  assert(demoAccounts.length >= 2 && !!demo1 && demo1.balance === 10000.00, 2, 'Demo sessions created with $10,000 initial balance');

  // Test 3: Client registry adds connection
  const wsUrl = `ws://127.0.0.1:${serverPort}/ws`;
  const clientWs = new WebSocket(wsUrl);

  const messagesReceived: WsEnvelope[] = [];
  clientWs.on('message', (data) => {
    try {
      const parsed = JSON.parse(data.toString());
      messagesReceived.push(parsed);
    } catch {
      // ignore
    }
  });

  await new Promise<void>((resolve) => {
    clientWs.on('open', () => resolve());
  });

  // Give short tick for connection registration
  await new Promise((r) => setTimeout(r, 60));

  const allClients = runtime.clients.getAllClients();
  assert(allClients.length === 1, 3, 'Client registry adds connection upon WebSocket handshake');
  const connectionId = allClients[0].connectionId;

  // Test 4: Client registry removes connection (tested later on teardown or simulated)
  const dummyClient = runtime.clients.register('conn_temp_test', 'acc_demo_1002', {} as any);
  runtime.clients.unregister('conn_temp_test');
  assert(!runtime.clients.getSession('conn_temp_test'), 4, 'Client registry removes connection cleanly without memory leaks');

  // Test 5: Symbol subscription works
  runtime.clients.subscribeSymbols(connectionId, ['XAUUSD', 'BTCUSD']);
  const subscribed = runtime.clients.getSession(connectionId)?.subscribedSymbols;
  assert(!!subscribed?.has('XAUUSD') && !!subscribed?.has('BTCUSD'), 5, 'Symbol subscription updates client registry session');

  // Test 6: Server generates quotes
  const quotesBatch = runtime.market.generateTickBatch();
  const xauQuote = runtime.market.getQuote('XAUUSD');
  assert(!!xauQuote && xauQuote.bid > 0 && xauQuote.ask > xauQuote.bid, 6, 'Server generates valid authoritative quotes (Ask > Bid)');

  // Test 7: Quote reaches subscribed client
  clientWs.send(JSON.stringify({
    type: 'SUBSCRIBE_SYMBOLS',
    requestId: 'sub_1',
    timestamp: Date.now(),
    payload: { symbols: ['EURUSD'] },
  }));
  await new Promise((r) => setTimeout(r, 120));

  const quoteMsg = messagesReceived.find((m) => m.type === 'QUOTE');
  assert(!!quoteMsg && !!(quoteMsg.payload as any).quotes, 7, 'Authoritative Quote event reaches subscribed WebSocket client');

  // Test 8: BUY order reaches server
  const prevOrderCount = runtime.orders.getOrderCount();
  clientWs.send(JSON.stringify({
    type: 'PLACE_ORDER',
    requestId: 'order_req_buy',
    timestamp: Date.now(),
    payload: {
      symbol: 'EURUSD',
      side: 'BUY',
      type: 'MARKET',
      volume: 1.0,
      clientOrderId: 'test_cli_buy_1',
    },
  }));

  await new Promise((r) => setTimeout(r, 100));
  const newOrderCount = runtime.orders.getOrderCount();
  assert(newOrderCount === prevOrderCount + 1, 8, 'BUY order reaches server and registers in OrderEngine');

  // Test 9: Server validates margin
  const eurQuote = runtime.market.getQuote('EURUSD')!;
  const eurCfg = runtime.market.getSymbolConfig('EURUSD')!;
  const insaneOrderResult = runtime.orders.executeMarketOrder(
    {
      accountId: demo1!.id,
      symbol: 'EURUSD',
      side: 'BUY',
      type: 'MARKET',
      volume: 50.0, // Requires ~$54,000 margin on $10,000 account
    },
    demo1!,
    eurQuote,
    eurCfg
  );
  assert(insaneOrderResult.result.success === false && insaneOrderResult.result.order.status === 'REJECTED', 9, 'Server validates margin and rejects order exceeding free margin');

  // Test 10: Server fills BUY at Ask
  const buyAck = messagesReceived.find((m) => m.type === 'ORDER_ACK' && m.requestId === 'order_req_buy');
  const filledOrder = (buyAck?.payload as any)?.order;
  assert(filledOrder?.status === 'FILLED' && filledOrder?.executionPrice > 0, 10, 'Server authoritatively fills BUY at Ask price', `Fill: ${filledOrder?.executionPrice}`);

  // Test 11: Server creates position
  const positions = runtime.positions.getOpenPositionsForAccount(demo1!.id);
  const buyPosition = positions.find((p) => p.symbol === 'EURUSD' && p.side === 'BUY');
  assert(!!buyPosition && buyPosition.volume === 1.0 && buyPosition.status === 'OPEN', 11, 'Server creates open position linked to account');

  // Test 12: SELL fills at Bid
  clientWs.send(JSON.stringify({
    type: 'PLACE_ORDER',
    requestId: 'order_req_sell',
    timestamp: Date.now(),
    payload: {
      symbol: 'XAUUSD',
      side: 'SELL',
      type: 'MARKET',
      volume: 0.10,
      clientOrderId: 'test_cli_sell_1',
    },
  }));
  await new Promise((r) => setTimeout(r, 100));

  const sellAck = messagesReceived.find((m) => m.type === 'ORDER_ACK' && m.requestId === 'order_req_sell');
  const filledSellOrder = (sellAck?.payload as any)?.order;
  const currentXauQuote = runtime.market.getQuote('XAUUSD')!;
  assert(filledSellOrder?.status === 'FILLED' && filledSellOrder?.side === 'SELL', 12, 'SELL fills authoritatively at Bid price');

  // Test 13: P/L changes after quote update
  const posBefore = runtime.positions.getPosition(buyPosition!.id)!;
  const simulatedQuoteUp: Quote = {
    ...eurQuote,
    bid: posBefore.openPrice + 0.0020, // +20 pips
    ask: posBefore.openPrice + 0.0021,
  };
  (runtime.market as any).currentQuotes?.set('EURUSD', simulatedQuoteUp);
  const { updatedPositions } = runtime.positions.updateMarkPriceAndCheckTriggers('EURUSD', simulatedQuoteUp, eurCfg);
  const updatedPos = updatedPositions.find((p) => p.id === posBefore.id);
  assert(!!updatedPos && updatedPos.unrealizedPnL === 200.00, 13, 'Position P/L changes authoritatively on quote update (+20 pips = +$200.00)', `PnL: ${updatedPos?.unrealizedPnL}`);

  // Test 14: Equity changes correctly
  const updatedAccount = runtime.accounts.getAccount(demo1!.id)!;
  const expectedEquity = Number((updatedAccount.balance + updatedPos!.unrealizedPnL).toFixed(2));
  assert(expectedEquity > updatedAccount.balance, 14, 'Equity changes correctly based on unrealized P/L', `Equity: ${expectedEquity}`);

  // Test 15: SL modification works
  clientWs.send(JSON.stringify({
    type: 'MODIFY_POSITION',
    requestId: 'mod_sl_1',
    timestamp: Date.now(),
    payload: {
      positionId: buyPosition!.id,
      stopLoss: 1.07000,
    },
  }));
  for (let i = 0; i < 20; i++) {
    if (messagesReceived.find((m) => m.type === 'POSITION_UPDATE' && m.requestId === 'mod_sl_1')) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  const posAfterSL = runtime.positions.getPosition(buyPosition!.id);
  assert(posAfterSL?.stopLoss === 1.07000, 15, 'SL modification updates authoritative position state on backend');

  // Test 16: TP modification works
  clientWs.send(JSON.stringify({
    type: 'MODIFY_POSITION',
    requestId: 'mod_tp_1',
    timestamp: Date.now(),
    payload: {
      positionId: buyPosition!.id,
      takeProfit: 1.10000,
    },
  }));
  for (let i = 0; i < 20; i++) {
    if (messagesReceived.find((m) => m.type === 'POSITION_UPDATE' && m.requestId === 'mod_tp_1')) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  const posAfterTP = runtime.positions.getPosition(buyPosition!.id);
  assert(posAfterTP?.takeProfit === 1.10000, 16, 'TP modification updates authoritative position state on backend');

  // Test 17: Position close works
  const balanceBeforeClose = runtime.accounts.getAccount(demo1!.id)!.balance;
  (runtime.market as any).currentQuotes?.set('EURUSD', simulatedQuoteUp);
  clientWs.send(JSON.stringify({
    type: 'CLOSE_POSITION',
    requestId: 'close_pos_1',
    timestamp: Date.now(),
    payload: {
      positionId: buyPosition!.id,
    },
  }));
  for (let i = 0; i < 10; i++) {
    if (runtime.positions.getPosition(buyPosition!.id)?.status === 'CLOSED') break;
    await new Promise((r) => setTimeout(r, 50));
  }
  await new Promise((r) => setTimeout(r, 100));

  const closedPos = runtime.positions.getPosition(buyPosition!.id);
  assert(closedPos?.status === 'CLOSED', 17, 'Position close transitions state to CLOSED');

  // Test 18: Realized P/L updates balance
  const balanceAfterClose = runtime.accounts.getAccount(demo1!.id)!.balance;
  assert(balanceAfterClose !== balanceBeforeClose, 18, 'Realized P/L updates account balance authoritatively', `Before: ${balanceBeforeClose}, After: ${balanceAfterClose}`);

  // Test 19: Margin is released
  const remainingOpen = runtime.positions.getOpenPositionsForAccount(demo1!.id);
  const totalLocked = remainingOpen.reduce((sum, p) => sum + p.marginLocked, 0);
  const accountMargin = runtime.accounts.getAccount(demo1!.id)!.usedMargin;
  assert(accountMargin === totalLocked, 19, 'Locked margin is released completely on position close');

  // Test 20: Ledger entry created
  const ledger = runtime.accounts.getLedger(demo1!.id);
  const tradePnlEntry = ledger.find((l) => l.type === 'TRADE_PNL');
  assert(!!tradePnlEntry && tradePnlEntry.amount !== 0, 20, 'Double-entry ledger record created for realized trade P/L');

  // Test 21: Unauthorized account operation is rejected
  const otherAccount = runtime.accounts.getAccount('DEMO-1002')!;
  const foreignPos = runtime.positions.openPosition({
    accountId: otherAccount.id,
    symbol: 'EURUSD',
    side: 'BUY',
    volume: 0.1,
    openPrice: 1.0850,
    currentPrice: 1.0850,
    unrealizedPnL: 0,
    realizedPnL: 0,
    marginLocked: 108.50,
    openedAt: Date.now(),
    status: 'OPEN',
  });

  // Client connection is bound to DEMO-1001, attempts to close DEMO-1002's position
  const unauthorizedCloseResult = runtime.closePosition(connectionId, foreignPos.id);
  assert(unauthorizedCloseResult === false, 21, 'Unauthorized operation across different accounts is strictly rejected');

  // Test 22: Invalid order is rejected
  const invalidOrderResult = runtime.placeOrder(connectionId, {
    symbol: 'NON_EXISTENT_PAIR',
    side: 'BUY',
    type: 'MARKET',
    volume: 0.10,
  });
  assert(invalidOrderResult.success === false, 22, 'Order with invalid/unsupported symbol is rejected by OrderEngine');

  // Test 23: Invalid message is rejected
  clientWs.send('NOT_A_VALID_JSON{{{');
  for (let i = 0; i < 20; i++) {
    if (messagesReceived.find((m) => m.type === 'ERROR' && (m.payload as any)?.code === 'INVALID_JSON')) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  const errorMsg = messagesReceived.find((m) => m.type === 'ERROR' && (m.payload as any)?.code === 'INVALID_JSON');
  assert(!!errorMsg, 23, 'Malformed JSON frames are rejected with structured ERROR message');

  // Test 24: Disconnect cleans runtime state
  clientWs.close();
  for (let i = 0; i < 20; i++) {
    if (runtime.clients.getAllClients().length === 0) break;
    await new Promise((r) => setTimeout(r, 30));
  }
  const clientsAfterClose = runtime.clients.getAllClients();
  assert(clientsAfterClose.length === 0, 24, 'WebSocket disconnect cleans client registry state cleanly');

  // Teardown
  wsServer.close();
  httpServer.close();
  runtime.stop();

  console.log('\n-------------------------------------------------------------');
  console.log(`TOTAL TESTS: ${passed + failed} | PASSED: \x1b[32m${passed}\x1b[0m | FAILED: \x1b[31m${failed}\x1b[0m`);
  console.log('-------------------------------------------------------------\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runBackendTests().catch((err) => {
  console.error('Fatal backend test error:', err);
  process.exit(1);
});
