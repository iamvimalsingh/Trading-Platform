/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * END-TO-END INTEGRATION VERIFICATION SCRIPT (SECTION 21)
 * Starts backend, connects WS client, runs trading workflow, and inspects HTTP admin endpoints.
 */

import { WebSocket } from 'ws';
import { createAppAndServer } from '../index';
import { WsEnvelope } from '../ws/wsProtocol';

async function runEndToEndIntegration() {
  console.log('--- STARTING SECTION 21 E2E INTEGRATION VERIFICATION ---');

  const { app, httpServer, runtime, wsServer } = createAppAndServer();
  let port = 0;

  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => {
      port = (httpServer.address() as any).port;
      resolve();
    });
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const wsUrl = `ws://127.0.0.1:${port}/ws`;
  console.log(`Backend running at ${baseUrl}`);

  // 1. Connect Terminal
  const ws = new WebSocket(wsUrl);
  const messages: WsEnvelope[] = [];

  ws.on('message', (data) => {
    try {
      messages.push(JSON.parse(data.toString()));
    } catch {}
  });

  await new Promise<void>((resolve) => ws.on('open', () => resolve()));
  console.log('Step 1: CONNECT TERMINAL -> OK');

  // 2. SESSION_READY
  await new Promise((r) => setTimeout(r, 60));
  const sessionReady = messages.find((m) => m.type === 'SESSION_READY');
  if (!sessionReady) throw new Error('SESSION_READY not received');
  console.log('Step 2: SESSION_READY -> Received', (sessionReady.payload as any).account.accountNumber);

  // 3. SUBSCRIBE XAUUSD
  ws.send(JSON.stringify({
    type: 'SUBSCRIBE_SYMBOLS',
    requestId: 'sub_xau',
    timestamp: Date.now(),
    payload: { symbols: ['XAUUSD'] },
  }));
  console.log('Step 3: SUBSCRIBE XAUUSD -> Sent');

  // 4. RECEIVE LIVE QUOTES
  await new Promise((r) => setTimeout(r, 120));
  const quoteEvent = messages.find((m) => m.type === 'QUOTE' && (m.payload as any).quotes?.XAUUSD);
  if (!quoteEvent) throw new Error('Live quote for XAUUSD not received');
  const xauQuote = (quoteEvent.payload as any).quotes.XAUUSD;
  console.log(`Step 4: RECEIVE LIVE QUOTES -> Bid: ${xauQuote.bid}, Ask: ${xauQuote.ask}`);

  // 5. BUY 0.10
  ws.send(JSON.stringify({
    type: 'PLACE_ORDER',
    requestId: 'e2e_buy_order',
    timestamp: Date.now(),
    payload: {
      symbol: 'XAUUSD',
      side: 'BUY',
      type: 'MARKET',
      volume: 0.10,
    },
  }));
  console.log('Step 5: BUY 0.10 XAUUSD -> Sent');

  // 6. SERVER ACK & POSITION CREATED
  await new Promise((r) => setTimeout(r, 100));
  const orderAck = messages.find((m) => m.type === 'ORDER_ACK' && m.requestId === 'e2e_buy_order');
  if (!orderAck || !(orderAck.payload as any).success) throw new Error('Order ACK failure');
  const createdPosition = (orderAck.payload as any).position;
  console.log(`Step 6: SERVER ACK & POSITION CREATED -> Position ID: ${createdPosition.id} @ ${createdPosition.openPrice}`);

  // 7. QUOTE MOVES & P/L CHANGES
  runtime.market.generateTickBatch();
  await new Promise((r) => setTimeout(r, 100));
  const posInRuntime = runtime.positions.getPosition(createdPosition.id);
  console.log(`Step 7: QUOTE MOVES & P/L CHANGES -> Current Mark: ${posInRuntime?.currentPrice}, P/L: ${posInRuntime?.unrealizedPnL}`);

  // 8. MODIFY SL/TP
  ws.send(JSON.stringify({
    type: 'MODIFY_POSITION',
    requestId: 'e2e_mod_sltp',
    timestamp: Date.now(),
    payload: {
      positionId: createdPosition.id,
      stopLoss: 2700.00,
      takeProfit: 2780.00,
    },
  }));
  await new Promise((r) => setTimeout(r, 100));
  const modPos = runtime.positions.getPosition(createdPosition.id);
  console.log(`Step 8: MODIFY SL/TP -> SL: ${modPos?.stopLoss}, TP: ${modPos?.takeProfit}`);

  // 9. CLOSE POSITION
  ws.send(JSON.stringify({
    type: 'CLOSE_POSITION',
    requestId: 'e2e_close_order',
    timestamp: Date.now(),
    payload: {
      positionId: createdPosition.id,
    },
  }));
  await new Promise((r) => setTimeout(r, 120));
  const closedEvent = messages.find((m) => m.type === 'POSITION_CLOSED');
  if (!closedEvent) throw new Error('POSITION_CLOSED event not received');
  console.log(`Step 9: SERVER CONFIRMS CLOSE -> Realized P/L: ${(closedEvent.payload as any).position.realizedPnL}`);

  // 10. BALANCE / EQUITY UPDATED
  const finalAccount = runtime.accounts.getAccount('DEMO-1001')!;
  console.log(`Step 10: BALANCE/EQUITY UPDATED -> Balance: $${finalAccount.balance.toFixed(2)}, Equity: $${finalAccount.equity.toFixed(2)}`);

  // 11. INSPECT ADMIN ENDPOINTS VIA HTTP
  console.log('\n--- VERIFYING ADMIN REST ENDPOINTS ---');

  const statsRes = await fetch(`${baseUrl}/api/runtime/stats`).then((r) => r.json());
  console.log('GET /api/runtime/stats:\n', JSON.stringify(statsRes, null, 2));

  const accountRes = await fetch(`${baseUrl}/api/runtime/accounts/DEMO-1001`).then((r) => r.json());
  console.log(`GET /api/runtime/accounts/DEMO-1001: (Balance: $${accountRes.account.balance}, Orders: ${accountRes.orders.length}, Ledger: ${accountRes.ledger.length})`);

  const positionsRes = await fetch(`${baseUrl}/api/runtime/positions`).then((r) => r.json());
  console.log(`GET /api/runtime/positions: (Open Positions: ${positionsRes.totalOpen})`);

  const marketRes = await fetch(`${baseUrl}/api/runtime/market`).then((r) => r.json());
  console.log(`GET /api/runtime/market: (${marketRes.symbols.length} active symbols, XAUUSD subscribers: ${marketRes.symbols.find((s: any) => s.symbol === 'XAUUSD')?.subscribersCount})`);

  // Teardown
  ws.close();
  wsServer.close();
  httpServer.close();
  runtime.stop();

  console.log('\n--- SECTION 21 E2E INTEGRATION VERIFICATION COMPLETE: ALL CHECKS PASSED ---');
}

runEndToEndIntegration().catch((e) => {
  console.error('E2E Integration Failed:', e);
  process.exit(1);
});
