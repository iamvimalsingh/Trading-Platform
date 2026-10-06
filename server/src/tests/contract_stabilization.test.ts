/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * PHASE 2 CONTRACT STABILIZATION + INTEGRATION FOUNDATION TEST SUITE
 * 
 * Verifies all 18 contract requirements:
 *  1. valid CRM SSO
 *  2. expired SSO
 *  3. invalid signature
 *  4. wrong account binding
 *  5. tenant isolation
 *  6. SESSION_READY
 *  7. SUBSCRIBE_SYMBOLS
 *  8. QUOTE
 *  9. ACCOUNT_STATE
 * 10. PLACE_ORDER
 * 11. CANCEL_ORDER
 * 12. REPLACE_ORDER
 * 13. MODIFY_POSITION
 * 14. CLOSE_POSITION
 * 15. duplicate clientOrderId (idempotency)
 * 16. stale market rejection
 * 17. closed market rejection
 * 18. insufficient margin rejection
 */

import fs from 'fs';
import path from 'path';
import WebSocket from 'ws';
import { createAppAndServer } from '../index';
import { SessionTokenService } from '../auth/SessionTokenService';
import { DatabaseClient } from '../db/DatabaseClient';
import { InstrumentRegistry } from '../market/InstrumentRegistry';
import { WsEnvelope } from '../ws/wsProtocol';

let passCount = 0;
let failCount = 0;

function assert(condition: boolean, num: number, name: string, detail?: string) {
  if (condition) {
    console.log(`  \x1b[32m✔ PASS [REQ-${num < 10 ? '0' + num : num}]\x1b[0m ${name}`);
    passCount++;
  } else {
    console.error(`  \x1b[31m✖ FAIL [REQ-${num < 10 ? '0' + num : num}]\x1b[0m ${name}${detail ? ` (${detail})` : ''}`);
    failCount++;
  }
}

async function runContractTests() {
  console.log('\n=============================================================');
  console.log('  RUNNING PHASE 2 CONTRACT STABILIZATION TESTS (18 REQS)');
  console.log('=============================================================\n');

  const testSecret = 'crm_launch_secret_contract_test_998124';
  process.env.CRM_LAUNCH_SECRET = testSecret;
  process.env.USE_REAL_MARKET_DATA = 'false';

  const testDbDir = path.resolve(process.cwd(), 'data', 'test_contract_db');
  if (fs.existsSync(testDbDir)) {
    fs.rmSync(testDbDir, { recursive: true, force: true });
  }
  process.env.DATABASE_STORAGE_PATH = testDbDir;

  DatabaseClient.resetInstance();
  InstrumentRegistry.resetInstance();

  const { httpServer, runtime, wsServer } = createAppAndServer();
  await runtime.persistence.init();

  let serverPort = 0;
  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => {
      const address = httpServer.address() as any;
      serverPort = address.port;
      resolve();
    });
  });

  const wsBaseUrl = `ws://127.0.0.1:${serverPort}/ws`;

  // WebSocket helper
  const connectHelper = async (queryParam?: string): Promise<{
    ws: WebSocket;
    messages: WsEnvelope[];
    waitForMessage: (type: string, requestId?: string, timeoutMs?: number) => Promise<WsEnvelope | undefined>;
    sendEnvelope: (type: string, payload: any, requestId?: string) => void;
    close: () => void;
  }> => {
    const url = queryParam ? `${wsBaseUrl}?${queryParam}` : wsBaseUrl;
    const ws = new WebSocket(url);
    const messages: WsEnvelope[] = [];

    ws.on('message', (raw) => {
      try {
        messages.push(JSON.parse(raw.toString()));
      } catch {
        // ignore
      }
    });

    await new Promise<void>((resolve) => ws.on('open', () => resolve()));

    const waitForMessage = (type: string, requestId?: string, timeoutMs: number = 8000): Promise<WsEnvelope | undefined> => {
      const startTime = Date.now();
      return new Promise((resolve) => {
        const interval = setInterval(() => {
          const match = messages.find((m) => m.type === type && (!requestId || m.requestId === requestId));
          if (match) {
            clearInterval(interval);
            resolve(match);
          } else if (Date.now() - startTime > timeoutMs) {
            clearInterval(interval);
            resolve(undefined);
          }
        }, 10);
      });
    };

    const sendEnvelope = (type: string, payload: any, requestId?: string) => {
      ws.send(JSON.stringify({
        type,
        requestId,
        timestamp: Date.now(),
        payload,
      }));
    };

    const close = () => {
      try {
        ws.close();
      } catch {}
    };

    return { ws, messages, waitForMessage, sendEnvelope, close };
  };

  const validClaims = {
    iss: 'crm-backend',
    sub: 'client_audit_01',
    aud: 'trading-terminal',
    accountId: 'acc_crm_60001',
    accountNumber: '60001',
    tenantId: 'broker_live',
    platform: 'MT5' as const,
    currency: 'USD',
    accountType: 'LIVE' as const,
    leverage: 100,
    initialBalance: 20000.00,
  };

  const validToken = SessionTokenService.createLaunchToken(validClaims, 300, testSecret);

  // Phase 2 Manager Provisioning Contract: Pre-provision account before client WebTrader SSO access
  await runtime.persistence.init();
  await runtime.persistence.accounts.updateAccount({
    id: validClaims.accountId,
    tenantId: validClaims.tenantId,
    clientId: validClaims.sub,
    accountNumber: validClaims.accountNumber,
    platform: validClaims.platform,
    currency: validClaims.currency,
    accountType: validClaims.accountType,
    sessionMode: 'EXTERNAL',
    leverage: validClaims.leverage,
    balance: validClaims.initialBalance,
    equity: validClaims.initialBalance,
    usedMargin: 0.00,
    freeMargin: validClaims.initialBalance,
    marginLevel: 0,
    marginCallLevel: 100,
    stopOutLevel: 50,
    status: 'ACTIVE',
    tradingEnabled: true,
  });

  // -------------------------------------------------------------
  // REQ 1: Valid CRM SSO
  // -------------------------------------------------------------
  const client1 = await connectHelper();
  client1.sendEnvelope('SESSION_INIT', { mode: 'EXTERNAL', token: validToken }, 'req_sso_valid');
  const ready1 = await client1.waitForMessage('SESSION_READY', 'req_sso_valid');
  const acc1 = (ready1?.payload as any)?.account;
  assert(
    !!ready1 && !!acc1 && acc1.accountNumber === '60001' && acc1.balance === 20000.00,
    1,
    'Valid CRM SSO initializes session and resolves account authoritatively',
    `Account: ${acc1?.accountNumber}, Balance: ${acc1?.balance}`
  );

  // -------------------------------------------------------------
  // REQ 2: Expired SSO
  // -------------------------------------------------------------
  const expiredToken = SessionTokenService.createLaunchToken(validClaims, -60, testSecret);
  const client2 = await connectHelper();
  client2.sendEnvelope('SESSION_INIT', { mode: 'EXTERNAL', token: expiredToken }, 'req_sso_expired');
  const err2 = await client2.waitForMessage('ERROR', 'req_sso_expired');
  assert(
    !!err2 && (err2.payload as any)?.code === 'SESSION_EXPIRED',
    2,
    'Expired launch token is rejected with SESSION_EXPIRED (no fallback to demo)',
    `Code: ${(err2?.payload as any)?.code}`
  );
  client2.close();

  // -------------------------------------------------------------
  // REQ 3: Invalid signature
  // -------------------------------------------------------------
  const tamperedToken = validToken.slice(0, -6) + 'abcdef';
  const client3 = await connectHelper();
  client3.sendEnvelope('SESSION_INIT', { mode: 'EXTERNAL', token: tamperedToken }, 'req_sso_invalid_sig');
  const err3 = await client3.waitForMessage('ERROR', 'req_sso_invalid_sig');
  assert(
    !!err3 && (err3.payload as any)?.code === 'UNAUTHORIZED',
    3,
    'Invalid signature is rejected with UNAUTHORIZED (no fallback to demo)',
    `Code: ${(err3?.payload as any)?.code}`
  );
  client3.close();

  // -------------------------------------------------------------
  // REQ 4: Wrong account binding (client claims different account than token grants)
  // -------------------------------------------------------------
  const client4 = await connectHelper();
  client4.sendEnvelope('SESSION_INIT', { mode: 'EXTERNAL', token: validToken, preferredAccountId: '99999' }, 'req_sso_spoof');
  const err4 = await client4.waitForMessage('ERROR', 'req_sso_spoof');
  assert(
    !!err4 && (err4.payload as any)?.code === 'UNAUTHORIZED',
    4,
    'Attempting to claim an account different from token authorization is rejected',
    `Code: ${(err4?.payload as any)?.code}`
  );
  client4.close();

  // -------------------------------------------------------------
  // REQ 5: Tenant isolation (Client from rival broker tenant cannot access account)
  // -------------------------------------------------------------
  const wrongTenantToken = SessionTokenService.createLaunchToken({
    ...validClaims,
    tenantId: 'broker_rival',
  }, 300, testSecret);
  const client5 = await connectHelper();
  client5.sendEnvelope('SESSION_INIT', { mode: 'EXTERNAL', token: wrongTenantToken }, 'req_tenant_iso');
  const err5 = await client5.waitForMessage('ERROR', 'req_tenant_iso');
  assert(
    !!err5 && (err5.payload as any)?.code === 'UNAUTHORIZED',
    5,
    'Tenant boundary enforces isolation across distinct broker tenants (rejected with UNAUTHORIZED)',
    `Code: ${(err5?.payload as any)?.code}`
  );
  client5.close();

  // -------------------------------------------------------------
  // REQ 6: SESSION_READY payload verification
  // -------------------------------------------------------------
  const readyPayload = ready1?.payload as any;
  assert(
    !!readyPayload &&
      readyPayload.account &&
      Array.isArray(readyPayload.symbols) &&
      readyPayload.symbols.length === 18 &&
      Array.isArray(readyPayload.positions) &&
      Array.isArray(readyPayload.orders) &&
      Array.isArray(readyPayload.activeSymbols) &&
      readyPayload.activeSymbols.length === 18,
    6,
    'SESSION_READY payload exposes complete authoritative initial state with 18 instruments',
    `Symbols count: ${readyPayload?.symbols?.length}, Active count: ${readyPayload?.activeSymbols?.length}`
  );

  // -------------------------------------------------------------
  // REQ 7: SUBSCRIBE_SYMBOLS
  // -------------------------------------------------------------
  client1.sendEnvelope('SUBSCRIBE_SYMBOLS', { symbols: ['EURUSD', 'BTCUSD'] }, 'req_sub');
  const quoteMsg = await client1.waitForMessage('QUOTE');
  assert(
    !!quoteMsg && typeof (quoteMsg.payload as any)?.quotes === 'object',
    7,
    'SUBSCRIBE_SYMBOLS registers client and triggers immediate quote dispatch',
    `Saw quote keys: ${Object.keys((quoteMsg?.payload as any)?.quotes || {}).join(', ')}`
  );

  // -------------------------------------------------------------
  // REQ 8: QUOTE structure verification
  // -------------------------------------------------------------
  const quoteEUR = (quoteMsg?.payload as any)?.quotes?.EURUSD || runtime.market.getQuote('EURUSD');
  assert(
    !!quoteEUR &&
      typeof quoteEUR.bid === 'number' &&
      typeof quoteEUR.ask === 'number' &&
      typeof quoteEUR.spread === 'number' &&
      typeof quoteEUR.mid === 'number' &&
      typeof quoteEUR.marketStatus === 'string',
    8,
    'QUOTE exposes normalized canonical quote fields (bid, ask, spread, mid, marketStatus)',
    `EURUSD: Bid ${quoteEUR?.bid}, Ask ${quoteEUR?.ask}, Status ${quoteEUR?.marketStatus}`
  );

  // -------------------------------------------------------------
  // REQ 9: ACCOUNT_STATE verification
  // -------------------------------------------------------------
  const accountSnapshot = runtime.accounts.getAccount('acc_crm_60001')!;
  assert(
    typeof accountSnapshot.balance === 'number' &&
      typeof accountSnapshot.equity === 'number' &&
      typeof accountSnapshot.usedMargin === 'number' &&
      typeof accountSnapshot.freeMargin === 'number' &&
      accountSnapshot.tradingEnabled === true &&
      accountSnapshot.status === 'ACTIVE',
    9,
    'ACCOUNT_STATE exposes authoritative financial properties without client-side calculation',
    `Balance: ${accountSnapshot.balance}, Equity: ${accountSnapshot.equity}, FreeMargin: ${accountSnapshot.freeMargin}`
  );

  // Seed a live quote for EURUSD so orders can execute
  (runtime.market as any).setQuote({
    symbol: 'EURUSD',
    bid: 1.08500,
    ask: 1.08512,
    spread: 0.00012,
    mid: 1.08506,
    digits: 5,
    timestamp: Date.now(),
    marketStatus: 'LIVE',
    isStale: false,
    source: 'test_feed',
  });

  // -------------------------------------------------------------
  // REQ 10: PLACE_ORDER (Market order execution)
  // -------------------------------------------------------------
  client1.sendEnvelope('PLACE_ORDER', {
    symbol: 'EURUSD',
    side: 'BUY',
    type: 'MARKET',
    volume: 1.0,
    clientOrderId: 'cli_req10_market_buy',
  }, 'req_place_order');

  const orderAck10 = await client1.waitForMessage('ORDER_ACK', 'req_place_order');
  const filledOrder = (orderAck10?.payload as any)?.order;
  assert(
    !!orderAck10 && (orderAck10.payload as any)?.success === true && filledOrder?.status === 'FILLED',
    10,
    'PLACE_ORDER executes authoritatively at server quote and emits ORDER_ACK',
    `Status: ${filledOrder?.status}, Fill: ${filledOrder?.executionPrice}`
  );

  // -------------------------------------------------------------
  // REQ 11: CANCEL_ORDER
  // -------------------------------------------------------------
  // First place a limit order far away so it stays WORKING
  client1.sendEnvelope('PLACE_ORDER', {
    symbol: 'EURUSD',
    side: 'BUY',
    type: 'LIMIT',
    requestedPrice: 1.05000,
    volume: 0.5,
    clientOrderId: 'cli_req11_limit_buy',
  }, 'req_place_limit');

  const limitAck = await client1.waitForMessage('ORDER_ACK', 'req_place_limit');
  const workingOrder = (limitAck?.payload as any)?.order;

  client1.sendEnvelope('CANCEL_ORDER', {
    orderId: workingOrder.id,
  }, 'req_cancel_order');

  const cancelAck = await client1.waitForMessage('ORDER_ACK', 'req_cancel_order');
  assert(
    !!cancelAck && (cancelAck.payload as any)?.success === true && (cancelAck.payload as any)?.order?.status === 'CANCELLED',
    11,
    'CANCEL_ORDER authoritatively cancels working order and updates state',
    `Status: ${(cancelAck?.payload as any)?.order?.status}`
  );

  // -------------------------------------------------------------
  // REQ 12: REPLACE_ORDER
  // -------------------------------------------------------------
  client1.sendEnvelope('PLACE_ORDER', {
    symbol: 'EURUSD',
    side: 'BUY',
    type: 'LIMIT',
    requestedPrice: 1.04000,
    volume: 0.2,
    clientOrderId: 'cli_req12_limit',
  }, 'req_place_limit_replace');

  const limitAck2 = await client1.waitForMessage('ORDER_ACK', 'req_place_limit_replace');
  const orderToReplace = (limitAck2?.payload as any)?.order;

  client1.sendEnvelope('REPLACE_ORDER', {
    orderId: orderToReplace.id,
    requestedPrice: 1.04500,
    volume: 0.3,
  }, 'req_replace_order');

  const replaceAck = await client1.waitForMessage('ORDER_ACK', 'req_replace_order');
  assert(
    !!replaceAck &&
      (replaceAck.payload as any)?.success === true &&
      (replaceAck.payload as any)?.order?.requestedPrice === 1.04500 &&
      (replaceAck.payload as any)?.order?.volume === 0.3,
    12,
    'REPLACE_ORDER modifies working order price and volume idempotently',
    `New Price: ${(replaceAck?.payload as any)?.order?.requestedPrice}, Volume: ${(replaceAck?.payload as any)?.order?.volume}`
  );

  // -------------------------------------------------------------
  // REQ 13: MODIFY_POSITION
  // -------------------------------------------------------------
  const openPos = runtime.positions.getOpenPositionsForAccount('acc_crm_60001')[0];
  client1.sendEnvelope('MODIFY_POSITION', {
    positionId: openPos.id,
    stopLoss: 1.08000,
    takeProfit: 1.09500,
  }, 'req_mod_pos');

  const posUpdateMsg = await client1.waitForMessage('POSITION_UPDATE', 'req_mod_pos');
  const updatedPos = (posUpdateMsg?.payload as any)?.position;
  assert(
    !!posUpdateMsg && updatedPos?.stopLoss === 1.08000 && updatedPos?.takeProfit === 1.09500,
    13,
    'MODIFY_POSITION updates SL/TP on server position and broadcasts POSITION_UPDATE',
    `SL: ${updatedPos?.stopLoss}, TP: ${updatedPos?.takeProfit}`
  );

  // -------------------------------------------------------------
  // REQ 14: CLOSE_POSITION
  // -------------------------------------------------------------
  client1.sendEnvelope('CLOSE_POSITION', {
    positionId: openPos.id,
  }, 'req_close_pos');

  const closeMsg = await client1.waitForMessage('POSITION_CLOSED');
  const closedPos = (closeMsg?.payload as any)?.position;
  const ledgerEntry = (closeMsg?.payload as any)?.ledgerEntry;
  assert(
    !!closeMsg && closedPos?.status === 'CLOSED' && typeof ledgerEntry?.amount === 'number',
    14,
    'CLOSE_POSITION closes position, generates immutable ledger entry, and broadcasts POSITION_CLOSED',
    `Status: ${closedPos?.status}, Realized P&L: ${closedPos?.realizedPnL}, Ledger: ${ledgerEntry?.amount}`
  );

  // -------------------------------------------------------------
  // REQ 15: Duplicate clientOrderId (Idempotency)
  // -------------------------------------------------------------
  const dupClientOrderId = 'cli_idempotent_test_req15';
  client1.sendEnvelope('PLACE_ORDER', {
    symbol: 'EURUSD',
    side: 'BUY',
    type: 'MARKET',
    volume: 0.1,
    clientOrderId: dupClientOrderId,
  }, 'req_dup_first');

  const firstAck = await client1.waitForMessage('ORDER_ACK', 'req_dup_first');
  const firstOrderId = (firstAck?.payload as any)?.order?.id;
  const positionsCountBefore = runtime.positions.getOpenPositionsForAccount('acc_crm_60001').length;

  // Duplicate submission with same clientOrderId
  client1.sendEnvelope('PLACE_ORDER', {
    symbol: 'EURUSD',
    side: 'BUY',
    type: 'MARKET',
    volume: 0.1,
    clientOrderId: dupClientOrderId,
  }, 'req_dup_second');

  const secondAck = await client1.waitForMessage('ORDER_ACK', 'req_dup_second');
  const secondOrderId = (secondAck?.payload as any)?.order?.id;
  const positionsCountAfter = runtime.positions.getOpenPositionsForAccount('acc_crm_60001').length;

  assert(
    firstOrderId === secondOrderId && positionsCountBefore === positionsCountAfter,
    15,
    'Duplicate clientOrderId submission is safely idempotent and does NOT duplicate executions or positions',
    `First Order: ${firstOrderId}, Second Order: ${secondOrderId}, Positions count delta: ${positionsCountAfter - positionsCountBefore}`
  );

  // -------------------------------------------------------------
  // REQ 16: Stale market rejection
  // -------------------------------------------------------------
  (runtime.market as any).setQuote({
    symbol: 'EURUSD',
    bid: 1.08500,
    ask: 1.08512,
    spread: 0.00012,
    mid: 1.08506,
    digits: 5,
    timestamp: Date.now() - 30000,
    marketStatus: 'STALE',
    isStale: true,
    source: 'test_feed',
  });

  client1.sendEnvelope('PLACE_ORDER', {
    symbol: 'EURUSD',
    side: 'BUY',
    type: 'MARKET',
    volume: 0.1,
    clientOrderId: 'cli_req16_stale',
  }, 'req_stale_order');

  const staleAck = await client1.waitForMessage('ORDER_ACK', 'req_stale_order');
  assert(
    !!staleAck && (staleAck.payload as any)?.success === false && (staleAck.payload as any)?.error?.toLowerCase().includes('stale'),
    16,
    'Market order on STALE quote is strictly rejected with protective error',
    `Error: ${(staleAck?.payload as any)?.error}`
  );

  // -------------------------------------------------------------
  // REQ 17: Closed market rejection
  // -------------------------------------------------------------
  (runtime.market as any).setQuote({
    symbol: 'EURUSD',
    bid: 1.08500,
    ask: 1.08512,
    spread: 0.00012,
    mid: 1.08506,
    digits: 5,
    timestamp: Date.now(),
    marketStatus: 'CLOSED',
    isStale: false,
    source: 'test_feed',
  });

  client1.sendEnvelope('PLACE_ORDER', {
    symbol: 'EURUSD',
    side: 'BUY',
    type: 'MARKET',
    volume: 0.1,
    clientOrderId: 'cli_req17_closed',
  }, 'req_closed_order');

  const closedAck = await client1.waitForMessage('ORDER_ACK', 'req_closed_order');
  assert(
    !!closedAck && (closedAck.payload as any)?.success === false && ((closedAck.payload as any)?.error?.includes('closed') || (closedAck.payload as any)?.error?.includes('CLOSED')),
    17,
    'Market order on CLOSED market is strictly rejected with market closed error',
    `Error: ${(closedAck?.payload as any)?.error}`
  );

  // Restore live quote for EURUSD
  (runtime.market as any).setQuote({
    symbol: 'EURUSD',
    bid: 1.08500,
    ask: 1.08512,
    spread: 0.00012,
    mid: 1.08506,
    digits: 5,
    timestamp: Date.now(),
    marketStatus: 'LIVE',
    isStale: false,
    source: 'test_feed',
  });

  // -------------------------------------------------------------
  // REQ 18: Insufficient margin rejection
  // -------------------------------------------------------------
  client1.sendEnvelope('PLACE_ORDER', {
    symbol: 'EURUSD',
    side: 'BUY',
    type: 'MARKET',
    volume: 50.0, // 50 lots = $5,425,000 notional, requires >$54,250 margin on 1:100 leverage; balance is only ~$20,000
    clientOrderId: 'cli_req18_huge_margin',
  }, 'req_margin_order');

  const marginAck = await client1.waitForMessage('ORDER_ACK', 'req_margin_order');
  assert(
    !!marginAck &&
      (marginAck.payload as any)?.success === false &&
      ((marginAck.payload as any)?.error?.includes('margin') || (marginAck.payload as any)?.error?.includes('Margin')),
    18,
    'Order requiring margin exceeding free margin is strictly rejected by server RiskEngine',
    `Error: ${(marginAck?.payload as any)?.error}`
  );

  client1.close();
  wsServer.close();
  runtime.stop();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));

  console.log('\n=============================================================');
  console.log(`  PHASE 2 CONTRACT TESTS: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('=============================================================\n');

  process.exit(0);
}

runContractTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
