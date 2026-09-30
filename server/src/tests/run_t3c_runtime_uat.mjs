// @ts-check
import WebSocket from 'ws';

async function runRealRuntimeT3CUAT() {
  console.log('Starting T3C Real Runtime UAT against http://127.0.0.1:3000 and ws://127.0.0.1:3000/ws\n');

  // Step 1: Health & Stats check
  const statsRes = await fetch('http://127.0.0.1:3000/api/runtime/stats');
  if (!statsRes.ok) throw new Error(`Stats endpoint failed: ${statsRes.status}`);
  const initialStats = await statsRes.json();
  console.log('✓ Step 1: Runtime stats verified:', initialStats);

  // Step 2: Connect WebSocket client
  const ws = new WebSocket('ws://127.0.0.1:3000/ws');
  /** @type {any[]} */
  const messages = [];

  ws.on('message', (data) => {
    try {
      messages.push(JSON.parse(data.toString()));
    } catch (e) {
      console.error('Failed to parse WS msg:', e);
    }
  });

  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
  console.log('✓ Step 2: Connected to authoritative WebSocket server');

  // Step 3: Session Init
  ws.send(JSON.stringify({
    type: 'SESSION_INIT',
    requestId: 'req_init_1',
    timestamp: Date.now(),
    payload: { preferredAccountId: 'DEMO-1001' },
  }));

  // Wait for SESSION_READY
  let sessionReadyMsg = null;
  for (let i = 0; i < 20; i++) {
    sessionReadyMsg = messages.find((m) => m.type === 'SESSION_READY');
    if (sessionReadyMsg) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  if (!sessionReadyMsg) throw new Error('SESSION_READY not received');
  console.log('✓ Step 3: Session initialized for account DEMO-1001');

  // Step 4: Subscribe to EURUSD quotes
  ws.send(JSON.stringify({
    type: 'SUBSCRIBE_SYMBOLS',
    requestId: 'req_sub_1',
    timestamp: Date.now(),
    payload: { symbols: ['EURUSD'] },
  }));

  let quoteMsg = null;
  for (let i = 0; i < 20; i++) {
    quoteMsg = messages.find((m) => m.type === 'QUOTE' && m.payload?.quotes?.EURUSD);
    if (quoteMsg) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  if (!quoteMsg) throw new Error('Live EURUSD quote not received');
  const liveQuote = quoteMsg.payload.quotes.EURUSD;
  console.log(`✓ Step 4: Subscribed & received live EURUSD quote: Bid=${liveQuote.bid}, Ask=${liveQuote.ask}`);

  // Step 5: Place MARKET BUY order
  ws.send(JSON.stringify({
    type: 'PLACE_ORDER',
    requestId: 'req_order_buy',
    timestamp: Date.now(),
    payload: {
      symbol: 'EURUSD',
      side: 'BUY',
      type: 'MARKET',
      volume: 0.10,
      clientOrderId: `uat_buy_${Date.now()}`,
    },
  }));

  let orderAckMsg = null;
  let execMsg = null;
  let posUpdateMsg = null;
  for (let i = 0; i < 25; i++) {
    if (!orderAckMsg) orderAckMsg = messages.find((m) => m.type === 'ORDER_ACK' && m.requestId === 'req_order_buy');
    if (!execMsg) execMsg = messages.find((m) => m.type === 'EXECUTION' && m.payload?.execution?.side === 'BUY');
    if (!posUpdateMsg) posUpdateMsg = messages.find((m) => m.type === 'POSITION_UPDATE' && m.payload?.position?.status === 'OPEN');
    if (orderAckMsg && execMsg && posUpdateMsg) break;
    await new Promise((r) => setTimeout(r, 50));
  }

  if (!orderAckMsg || !orderAckMsg.payload?.success) throw new Error('MARKET BUY failed to fill');
  if (!execMsg) throw new Error('EXECUTION broadcast not received');
  if (!posUpdateMsg) throw new Error('POSITION_UPDATE broadcast not received');

  const exec = execMsg.payload.execution;
  const pos = posUpdateMsg.payload.position;

  if (exec.type !== 'OPEN' || exec.executionPrice <= 0 || exec.volume !== 0.10) {
    throw new Error(`Invalid execution payload: ${JSON.stringify(exec)}`);
  }
  if (exec.positionId !== pos.id) {
    throw new Error(`Execution positionId (${exec.positionId}) does not match created position id (${pos.id})`);
  }
  console.log(`✓ Step 5: MARKET BUY filled: execId=${exec.id}, fillPrice=${exec.executionPrice}, positionId=${pos.id}`);

  // Step 6: Close Position
  ws.send(JSON.stringify({
    type: 'CLOSE_POSITION',
    requestId: 'req_close_pos',
    timestamp: Date.now(),
    payload: { positionId: pos.id },
  }));

  let closeExecMsg = null;
  let posClosedMsg = null;
  for (let i = 0; i < 25; i++) {
    if (!closeExecMsg) closeExecMsg = messages.find((m) => m.type === 'EXECUTION' && m.payload?.execution?.type === 'CLOSE');
    if (!posClosedMsg) posClosedMsg = messages.find((m) => m.type === 'POSITION_CLOSED' && m.payload?.position?.id === pos.id);
    if (closeExecMsg && posClosedMsg) break;
    await new Promise((r) => setTimeout(r, 50));
  }

  if (!closeExecMsg) throw new Error('Closing EXECUTION not received');
  if (!posClosedMsg) throw new Error('POSITION_CLOSED not received');
  console.log(`✓ Step 6: Position closed: closeExecId=${closeExecMsg.payload.execution.id}, realizedPnL=${closeExecMsg.payload.execution.realizedPnL}`);

  // Step 7: Verify final stats reflect executions
  const finalStatsRes = await fetch('http://127.0.0.1:3000/api/runtime/stats');
  const finalStats = await finalStatsRes.json();
  if (finalStats.totalExecutions < 2) {
    throw new Error(`Expected at least 2 executions recorded in runtime, got: ${finalStats.totalExecutions}`);
  }
  console.log(`✓ Step 7: Authoritative total executions in runtime: ${finalStats.totalExecutions}`);

  // Clean shutdown
  ws.close();
  console.log('\n=============================================================');
  console.log('  ALL T3C RUNTIME UAT CHECKS PASSED SUCCESSFULLY!');
  console.log('=============================================================\n');
}

runRealRuntimeT3CUAT().catch((err) => {
  console.error('\n✖ T3C RUNTIME UAT ERROR:', err);
  process.exit(1);
});
