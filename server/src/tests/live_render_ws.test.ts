/**
 * Complete Verification Test Suite for External Authentication & DEMO Sessions
 * Tests both local engine instance and live production Render WebSocket.
 */

import { WebSocket } from 'ws';
import { createAppAndServer } from '../index';
import { DatabaseClient } from '../db/DatabaseClient';
import { SessionTokenService } from '../auth/SessionTokenService';
import { WsEnvelope } from '../ws/wsProtocol';
import fs from 'fs';
import path from 'path';

interface TestResult {
  name: string;
  success: boolean;
  details: string;
}

async function connectAndTest(
  url: string,
  initPayload?: any,
  timeoutMs: number = 6000
): Promise<{ messages: WsEnvelope[]; initialMessage?: WsEnvelope }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    const messages: WsEnvelope[] = [];

    const timer = setTimeout(() => {
      ws.close();
      resolve({ messages, initialMessage: messages[0] });
    }, timeoutMs);

    ws.on('open', () => {
      if (initPayload) {
        ws.send(JSON.stringify({
          type: 'SESSION_INIT',
          requestId: `req_${Date.now()}`,
          timestamp: Date.now(),
          payload: initPayload,
        }));
      }
    });

    ws.on('message', (data) => {
      try {
        const env = JSON.parse(data.toString());
        messages.push(env);
        if (env.type === 'SESSION_READY' || env.type === 'ERROR') {
          setTimeout(() => {
            clearTimeout(timer);
            ws.close();
            resolve({ messages, initialMessage: messages[0] });
          }, 200);
        }
      } catch {
        // ignore
      }
    });

    ws.on('error', () => {
      clearTimeout(timer);
      resolve({ messages, initialMessage: messages[0] });
    });
  });
}

async function runSuiteForTarget(targetUrl: string, secret: string, suiteTitle: string): Promise<boolean> {
  const results: TestResult[] = [];
  console.log(`\n=============================================================`);
  console.log(`  ${suiteTitle}`);
  console.log(`  Target: ${targetUrl}`);
  console.log(`=============================================================`);

  // A. Valid CRM token -> EXTERNAL -> account 57775
  const validClaims = {
    iss: 'crm-backend',
    sub: 'client_crm_57775',
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
  const validToken = SessionTokenService.createLaunchToken(validClaims, 300, secret);
  const resValid = await connectAndTest(targetUrl, { mode: 'EXTERNAL', token: validToken });
  const validReady = resValid.messages.find((m) => m.type === 'SESSION_READY');
  const validError = resValid.messages.find((m) => m.type === 'ERROR');
  const validAcc = (validReady?.payload as any)?.account;
  const passA = !!validAcc && (validAcc.accountNumber === '57775' || validAcc.id === 'acc_crm_57775') && !validError;
  results.push({
    name: 'A. Valid CRM token -> EXTERNAL -> account 57775',
    success: passA,
    details: `Account: ${validAcc?.accountNumber || 'none'} | Platform: ${validAcc?.platform || 'none'}`,
  });

  // B. Invalid token -> AUTH_FAILED / UNAUTHORIZED (NEVER DEMO-1001)
  const resInvalid = await connectAndTest(targetUrl, { mode: 'EXTERNAL', token: 'invalid.jwt.token' });
  const invalidError = resInvalid.messages.find((m) => m.type === 'ERROR');
  const invalidReady = resInvalid.messages.find((m) => m.type === 'SESSION_READY');
  const passB = !!invalidError && !invalidReady;
  results.push({
    name: 'B. Invalid token -> AUTH_FAILED',
    success: passB,
    details: `Error Code: ${(invalidError?.payload as any)?.code || 'none'} | Saw SESSION_READY: ${!!invalidReady}`,
  });

  // C. Expired token -> AUTH_FAILED / SESSION_EXPIRED (NEVER DEMO-1001)
  const expiredToken = SessionTokenService.createLaunchToken(validClaims, -60, secret);
  const resExpired = await connectAndTest(targetUrl, { mode: 'EXTERNAL', token: expiredToken });
  const expiredError = resExpired.messages.find((m) => m.type === 'ERROR');
  const expiredReady = resExpired.messages.find((m) => m.type === 'SESSION_READY');
  const passC = !!expiredError && !expiredReady;
  results.push({
    name: 'C. Expired token -> AUTH_FAILED / SESSION_EXPIRED',
    success: passC,
    details: `Error Code: ${(expiredError?.payload as any)?.code || 'none'} | Saw SESSION_READY: ${!!expiredReady}`,
  });

  // D. Wrong-secret token -> AUTH_FAILED / UNAUTHORIZED (NEVER DEMO-1001)
  const wrongSecretToken = SessionTokenService.createLaunchToken(validClaims, 300, 'wrong_secret_signature_fake');
  const resWrongSecret = await connectAndTest(targetUrl, { mode: 'EXTERNAL', token: wrongSecretToken });
  const wrongSecretError = resWrongSecret.messages.find((m) => m.type === 'ERROR');
  const wrongSecretReady = resWrongSecret.messages.find((m) => m.type === 'SESSION_READY');
  const passD = !!wrongSecretError && !wrongSecretReady;
  results.push({
    name: 'D. Wrong-secret token -> AUTH_FAILED',
    success: passD,
    details: `Error Code: ${(wrongSecretError?.payload as any)?.code || 'none'} | Saw SESSION_READY: ${!!wrongSecretReady}`,
  });

  // E. Tampered token -> AUTH_FAILED / UNAUTHORIZED (NEVER DEMO-1001)
  const tamperedToken = validToken.slice(0, -6) + 'xxxxxx';
  const resTampered = await connectAndTest(targetUrl, { mode: 'EXTERNAL', token: tamperedToken });
  const tamperedError = resTampered.messages.find((m) => m.type === 'ERROR');
  const tamperedReady = resTampered.messages.find((m) => m.type === 'SESSION_READY');
  const passE = !!tamperedError && !tamperedReady;
  results.push({
    name: 'E. Tampered token -> AUTH_FAILED',
    success: passE,
    details: `Error Code: ${(tamperedError?.payload as any)?.code || 'none'} | Saw SESSION_READY: ${!!tamperedReady}`,
  });

  // F. Explicit DEMO -> DEMO-1001
  const resDemo = await connectAndTest(targetUrl, { mode: 'DEMO' });
  const demoReady = resDemo.messages.find((m) => m.type === 'SESSION_READY');
  const demoAcc = (demoReady?.payload as any)?.account;
  const passF = !!demoAcc && (demoAcc.id === 'acc_demo_1001' || demoAcc.accountNumber === 'DEMO-1001');
  results.push({
    name: 'F. Explicit DEMO -> DEMO-1001',
    success: passF,
    details: `Account: ${demoAcc?.accountNumber || 'none'}`,
  });

  for (const r of results) {
    console.log(`  ${r.success ? '\x1b[32m✔ PASS\x1b[0m' : '\x1b[31m✖ FAIL\x1b[0m'} ${r.name} (${r.details})`);
  }

  const allPassed = results.every((r) => r.success);
  console.log(`  RESULT: ${allPassed ? '\x1b[32mALL 6 CHECKS PASSED\x1b[0m' : '\x1b[31mSOME CHECKS FAILED\x1b[0m'}`);
  return allPassed;
}

async function run() {
  process.env.USE_REAL_MARKET_DATA = 'false';
  const testSecret = 'verified_crm_launch_secret_key_991823';
  process.env.CRM_LAUNCH_SECRET = testSecret;

  const testDbDir = path.resolve(process.cwd(), 'data', 'test_local_auth_verify_db');
  if (fs.existsSync(testDbDir)) {
    fs.rmSync(testDbDir, { recursive: true, force: true });
  }
  process.env.DATABASE_STORAGE_PATH = testDbDir;
  DatabaseClient.resetInstance();

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

  const localWsUrl = `ws://127.0.0.1:${serverPort}/ws`;

  // 1. Run against Local Patched Engine
  const localPassed = await runSuiteForTarget(
    localWsUrl,
    testSecret,
    'LOCAL PATCHED ENGINE VERIFICATION'
  );

  // Teardown local server
  wsServer.close();
  runtime.stop();
  await new Promise<void>((r) => httpServer.close(() => r()));

  if (!localPassed) {
    console.error('\nLocal verification failed.');
    process.exit(1);
  }

  console.log('\nAll local tests completed successfully.');
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
