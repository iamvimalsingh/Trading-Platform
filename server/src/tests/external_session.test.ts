/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * STEP 1 — EXTERNAL ACCOUNT SESSION & SSO TESTS
 * Validates Mode A (Standalone DEMO) and Mode B (External Authenticated Launch)
 * including cryptographic token verification, expiration, spoofing defense,
 * and authoritative account resolution.
 * 
 * Run with: tsx server/src/tests/external_session.test.ts
 */

import fs from 'fs';
import path from 'path';
import { WebSocket } from 'ws';
import { createAppAndServer } from '../index';
import { DatabaseClient } from '../db/DatabaseClient';
import { SessionTokenService } from '../auth/SessionTokenService';
import { WsEnvelope } from '../ws/wsProtocol';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testNum: number, name: string, detail?: string) {
  if (condition) {
    console.log(`  \x1b[32m✔ PASS [STEP1-${testNum.toString().padStart(2, '0')}]\x1b[0m ${name}`);
    passed++;
  } else {
    console.error(`  \x1b[31m✖ FAIL [STEP1-${testNum.toString().padStart(2, '0')}]\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

async function runSessionFoundationTests() {
  process.env.USE_REAL_MARKET_DATA = 'false';
  const testSecret = 'test_crm_shared_secret_key_8849204';
  process.env.CRM_LAUNCH_SECRET = testSecret;

  const testDbDir = path.resolve(process.cwd(), 'data', 'test_external_session_db');
  if (fs.existsSync(testDbDir)) {
    fs.rmSync(testDbDir, { recursive: true, force: true });
  }
  process.env.DATABASE_STORAGE_PATH = testDbDir;
  DatabaseClient.resetInstance();

  console.log('\n=============================================================');
  console.log('  RUNNING STEP 1 EXTERNAL ACCOUNT SESSION FOUNDATION TESTS');
  console.log('=============================================================\n');

  const { httpServer, runtime, wsServer } = createAppAndServer();
  let serverPort = 0;

  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => {
      const address = httpServer.address() as any;
      serverPort = address.port;
      resolve();
    });
  });

  const wsBaseUrl = `ws://127.0.0.1:${serverPort}/ws`;

  // Helper to open socket and collect incoming frames
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

    const waitForMessage = (type: string, requestId?: string, timeoutMs: number = 10000): Promise<WsEnvelope | undefined> => {
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
      ws.close();
    };

    return { ws, messages, waitForMessage, sendEnvelope, close };
  };

  // -------------------------------------------------------------
  // TEST 1: Direct DEMO launch works (Mode A)
  // -------------------------------------------------------------
  const clientDemo = await connectHelper();
  clientDemo.sendEnvelope('SESSION_INIT', { mode: 'DEMO' }, 'req_demo_init');
  const demoReadyMsg = await clientDemo.waitForMessage('SESSION_READY');

  const demoAccount = (demoReadyMsg?.payload as any)?.account;
  assert(
    !!demoAccount && demoAccount.id === 'acc_demo_1001' && demoAccount.balance === 10000.00,
    1,
    'Direct DEMO launch resolves DEMO-1001 with $10,000 balance',
    `Account: ${demoAccount?.accountNumber}`
  );
  clientDemo.close();

  // -------------------------------------------------------------
  // TEST 2: External session without credentials is rejected
  // -------------------------------------------------------------
  const clientNoCred = await connectHelper();
  clientNoCred.sendEnvelope('SESSION_INIT', { mode: 'EXTERNAL' }, 'req_no_cred');
  const errorNoCredMsg = await clientNoCred.waitForMessage('ERROR');

  assert(
    !!errorNoCredMsg && (errorNoCredMsg.payload as any)?.code === 'MISSING_CREDENTIAL',
    2,
    'External session mode without token is rejected with MISSING_CREDENTIAL',
    `Code: ${(errorNoCredMsg?.payload as any)?.code}`
  );
  clientNoCred.close();

  // -------------------------------------------------------------
  // TEST 3: Invalid token signature is rejected
  // -------------------------------------------------------------
  const validClaims = {
    iss: 'crm-backend',
    sub: 'client_98231',
    aud: 'trading-terminal',
    accountId: 'acc_crm_57775',
    accountNumber: '57775',
    tenantId: 'broker_live',
    platform: 'MT5' as const,
    currency: 'USD',
    accountType: 'LIVE' as const,
    leverage: 200,
    initialBalance: 35000.00,
  };

  const validToken = SessionTokenService.createLaunchToken(validClaims, 300, testSecret);
  const tamperedToken = validToken.slice(0, -6) + 'xxxxxx'; // corrupt signature

  const clientTampered = await connectHelper();
  clientTampered.sendEnvelope('SESSION_INIT', { mode: 'EXTERNAL', token: tamperedToken }, 'req_tampered');
  const errorTamperedMsg = await clientTampered.waitForMessage('ERROR');

  assert(
    !!errorTamperedMsg && (errorTamperedMsg.payload as any)?.code === 'UNAUTHORIZED',
    3,
    'Tampered or forged launch token is rejected with UNAUTHORIZED',
    `Code: ${(errorTamperedMsg?.payload as any)?.code}`
  );
  clientTampered.close();

  // -------------------------------------------------------------
  // TEST 4: Expired launch token is rejected with SESSION_EXPIRED
  // -------------------------------------------------------------
  // Create token with -10s expiration
  const expiredToken = SessionTokenService.createLaunchToken(validClaims, -10, testSecret);

  const clientExpired = await connectHelper();
  clientExpired.sendEnvelope('SESSION_INIT', { mode: 'EXTERNAL', token: expiredToken }, 'req_expired');
  const errorExpiredMsg = await clientExpired.waitForMessage('ERROR');

  assert(
    !!errorExpiredMsg && (errorExpiredMsg.payload as any)?.code === 'SESSION_EXPIRED',
    4,
    'Expired launch token is rejected with SESSION_EXPIRED',
    `Code: ${(errorExpiredMsg?.payload as any)?.code}`
  );
  clientExpired.close();

  // -------------------------------------------------------------
  // TEST 5: Valid token with CRM account 57775 resolves authoritatively (Mode B)
  // -------------------------------------------------------------
  const clientValid = await connectHelper();
  clientValid.sendEnvelope('SESSION_INIT', { mode: 'EXTERNAL', token: validToken }, 'req_valid_57775');
  const validReadyMsg = await clientValid.waitForMessage('SESSION_READY', 'req_valid_57775');

  const externalAccount = (validReadyMsg?.payload as any)?.account;
  assert(
    !!externalAccount &&
      externalAccount.accountNumber === '57775' &&
      externalAccount.platform === 'MT5' &&
      externalAccount.sessionMode === 'EXTERNAL' &&
      externalAccount.balance === 35000.00,
    5,
    'Valid CRM token resolves external MT5 account 57775 authoritatively',
    `Account: ${externalAccount?.accountNumber} | Platform: ${externalAccount?.platform} | Balance: $${externalAccount?.balance}`
  );
  clientValid.close();

  // -------------------------------------------------------------
  // TEST 6: Client attempting to request another account is rejected (Spoofing defense)
  // -------------------------------------------------------------
  const clientSpoof = await connectHelper();
  clientSpoof.sendEnvelope(
    'SESSION_INIT',
    {
      mode: 'EXTERNAL',
      token: validToken, // Token authorizes 57775
      preferredAccountId: '99999', // Attacker asks for 99999
    },
    'req_spoof'
  );
  const errorSpoofMsg = await clientSpoof.waitForMessage('ERROR', 'req_spoof');

  assert(
    !!errorSpoofMsg && (errorSpoofMsg.payload as any)?.code === 'UNAUTHORIZED',
    6,
    'Client attempting to claim a different account than token grants is rejected',
    `Error: ${(errorSpoofMsg?.payload as any)?.message}`
  );
  clientSpoof.close();

  // -------------------------------------------------------------
  // TEST 7: Direct selection of non-demo account without token is rejected
  // -------------------------------------------------------------
  const clientDirectHijack = await connectHelper();
  clientDirectHijack.sendEnvelope(
    'SESSION_INIT',
    {
      mode: 'DEMO',
      preferredAccountId: '57775', // Attempting to hijack 57775 in demo mode
    },
    'req_hijack'
  );
  const errorHijackMsg = await clientDirectHijack.waitForMessage('ERROR', 'req_hijack');

  assert(
    !!errorHijackMsg && (errorHijackMsg.payload as any)?.code === 'UNAUTHORIZED',
    7,
    'Direct selection of non-demo account without token is rejected',
    `Error: ${(errorHijackMsg?.payload as any)?.message}`
  );
  clientDirectHijack.close();

  // -------------------------------------------------------------
  // TEST 8: External authentication failure NEVER silently falls back to DEMO
  // -------------------------------------------------------------
  const clientNoFallback = await connectHelper();
  clientNoFallback.sendEnvelope('SESSION_INIT', { mode: 'EXTERNAL', token: 'invalid_token_xyz' }, 'req_nofallback');
  const errNoFallback = await clientNoFallback.waitForMessage('ERROR', 'req_nofallback');
  const readyNoFallback = await clientNoFallback.waitForMessage('SESSION_READY', 'req_nofallback', 150);

  // Attempt to place an order without valid authentication
  clientNoFallback.sendEnvelope('PLACE_ORDER', {
    symbol: 'EURUSD',
    side: 'BUY',
    type: 'MARKET',
    volume: 0.10,
  }, 'order_unauth');
  const orderReject = await clientNoFallback.waitForMessage('ERROR', 'order_unauth', 200);

  assert(
    !!errNoFallback && !readyNoFallback && !!orderReject && (orderReject.payload as any)?.code === 'UNAUTHORIZED',
    8,
    'Failed external authentication leaves session unauthenticated with zero demo fallback',
    'Session remained unauthenticated; unauthorized order rejected'
  );
  clientNoFallback.close();

  // -------------------------------------------------------------
  // TEST 9: Query Parameter Handshake (?token=...) works automatically
  // -------------------------------------------------------------
  const queryParamToken = SessionTokenService.createLaunchToken(
    {
      ...validClaims,
      accountId: 'acc_crm_88990',
      accountNumber: '88990',
      initialBalance: 50000.00,
    },
    300,
    testSecret
  );

  const clientQueryParam = await connectHelper(`token=${queryParamToken}`);
  const queryReadyMsg = await clientQueryParam.waitForMessage('SESSION_READY');
  const queryAccount = (queryReadyMsg?.payload as any)?.account;

  assert(
    !!queryAccount && queryAccount.accountNumber === '88990' && queryAccount.balance === 50000.00,
    9,
    'Handshake query parameter (?token=...) initializes external session seamlessly',
    `Account: ${queryAccount?.accountNumber} | Balance: $${queryAccount?.balance}`
  );
  clientQueryParam.close();

  // Teardown HTTP & WS servers
  wsServer.close();
  runtime.stop();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));

  console.log('\n=============================================================');
  console.log(`  STEP 1 SESSION FOUNDATION TESTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('=============================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runSessionFoundationTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
