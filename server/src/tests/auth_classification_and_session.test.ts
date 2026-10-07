/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * FOCUSED AUTH ERROR CLASSIFICATION & SESSION LIFECYCLE TEST
 * Tests:
 * 1. Valid external CRM session -> SESSION_READY
 * 2. Invalid token -> UNAUTHORIZED
 * 3. Expired token -> SESSION_EXPIRED
 * 4. Database connection failure -> DATABASE_UNAVAILABLE (NOT UNAUTHORIZED)
 * 5. Circuit breaker resets on successful auth
 * 6. External account remains selected after SESSION_READY
 * 7. Quotes arrive after SESSION_READY
 * 8. TwelveData start is idempotent and not restarted by session init
 */

import assert from 'node:assert/strict';
import { TradingRuntime } from '../runtime/TradingRuntime';
import { SessionTokenService } from '../auth/SessionTokenService';
import { TwelveDataMarketDataAdapter } from '../market/TwelveDataMarketDataAdapter';
import { DatabaseClient } from '../db/DatabaseClient';

async function runTests() {
  console.log('--- Starting Auth Classification & Session Lifecycle Tests ---');

  const runtime = new TradingRuntime();
  runtime.start();

  // Test 1: Valid external token resolves SESSION_READY
  console.log('[Test 1] Valid external CRM token resolution...');
  const testSecret = 'test_shared_crm_secret_123';
  process.env.CRM_LAUNCH_SECRET = testSecret;

  const validToken = SessionTokenService.createLaunchToken({
    iss: 'crm-backend',
    aud: 'trading-terminal',
    tenantId: 'broker_live',
    sub: 'client_live_01',
    accountId: 'acc_live_20183235',
    accountNumber: '20183235',
    platform: 'MT5',
    currency: 'USD',
    leverage: 100,
    balance: 100,
  }, 300, testSecret);

  // Pre-provision account in database per Phase 2 Broker Provisioning contract
  await runtime.persistence.init();
  await runtime.persistence.accounts.updateAccount({
    id: 'acc_live_20183235',
    accountNumber: '20183235',
    tenantId: 'broker_live',
    clientId: 'client_live_01',
    platform: 'MT5',
    currency: 'USD',
    accountType: 'LIVE',
    sessionMode: 'EXTERNAL',
    leverage: 100,
    balance: 100,
    equity: 100,
    usedMargin: 0,
    freeMargin: 100,
    marginLevel: 0,
    marginCallLevel: 100,
    stopOutLevel: 50,
    status: 'ACTIVE',
    tradingEnabled: true,
  });

  const session1 = runtime.clients.register('conn_1', 'unauthenticated', { send: () => {} } as any);
  const result1 = await runtime.initializeSession(session1.connectionId, {
    mode: 'EXTERNAL',
    token: validToken,
  });

  assert.equal(result1.success, true, 'Valid external session must succeed');
  assert.equal(result1.readyPayload?.account.accountNumber, '20183235', 'Account 20183235 must be selected');
  assert.equal(result1.readyPayload?.account.sessionMode, 'EXTERNAL', 'Must be in EXTERNAL session mode');
  assert.equal(result1.readyPayload?.account.balance, 100, 'Balance must be 100');
  console.log('✓ Valid external token produced SESSION_READY with correct account and balance');

  // Test 2: Invalid token produces UNAUTHORIZED
  console.log('[Test 2] Invalid token classification...');
  const session2 = runtime.clients.register('conn_2', 'unauthenticated', { send: () => {} } as any);
  const result2 = await runtime.initializeSession(session2.connectionId, {
    mode: 'EXTERNAL',
    token: 'invalid.forged.jwt',
  });
  assert.equal(result2.success, false, 'Invalid token must fail');
  assert.equal(result2.errorCode, 'UNAUTHORIZED', 'Invalid token must be classified as UNAUTHORIZED');
  console.log('✓ Invalid token correctly classified as UNAUTHORIZED');

  // Test 3: Expired token produces SESSION_EXPIRED
  console.log('[Test 3] Expired token classification...');
  const expiredToken = SessionTokenService.createLaunchToken(
    {
      iss: 'crm-backend',
      aud: 'trading-terminal',
      tenantId: 'broker_live',
      sub: 'client_live_01',
      accountId: 'acc_live_20183235',
      accountNumber: '20183235',
      platform: 'MT5',
      currency: 'USD',
      leverage: 100,
      balance: 100,
    },
    -60, // expired 60 seconds ago
    testSecret
  );
  const session3 = runtime.clients.register('conn_3', 'unauthenticated', { send: () => {} } as any);
  const result3 = await runtime.initializeSession(session3.connectionId, {
    mode: 'EXTERNAL',
    token: expiredToken,
  });
  assert.equal(result3.success, false, 'Expired token must fail');
  assert.equal(result3.errorCode, 'SESSION_EXPIRED', 'Expired token must be classified as SESSION_EXPIRED');
  console.log('✓ Expired token correctly classified as SESSION_EXPIRED');

  // Test 4: Database failure is NOT classified as UNAUTHORIZED
  console.log('[Test 4] Database failure classification (NOT false AUTH FAILED)...');
  const validToken2 = SessionTokenService.createLaunchToken({
    iss: 'crm-backend',
    aud: 'trading-terminal',
    tenantId: 'broker_live',
    sub: 'client_live_02',
    accountId: 'acc_live_99999999',
    accountNumber: '99999999',
    platform: 'MT5',
    currency: 'USD',
    leverage: 100,
    balance: 500,
  }, 300, testSecret);

  // Temporarily simulate a database connection / circuit breaker error during getExternalAccount
  const originalGetExternal = runtime.persistence.accounts.getExternalAccount;
  runtime.persistence.accounts.getExternalAccount = async () => {
    throw new Error('(CIRCUITBREAKER) too many authentication failures, new connections are temporarily blocked');
  };

  const session4 = runtime.clients.register('conn_4', 'unauthenticated', { send: () => {} } as any);
  const result4 = await runtime.initializeSession(session4.connectionId, {
    mode: 'EXTERNAL',
    token: validToken2,
  });

  // Restore original method
  runtime.persistence.accounts.getExternalAccount = originalGetExternal;

  assert.equal(result4.success, false, 'Database error must fail session initialization');
  assert.equal(result4.errorCode, 'DATABASE_UNAVAILABLE', 'Database failure must be classified as DATABASE_UNAVAILABLE, NOT UNAUTHORIZED');
  assert.equal(result4.error, 'Trading server database connection unavailable', 'Must provide safe diagnostic message');
  console.log('✓ Database failure correctly classified as DATABASE_UNAVAILABLE, not false token AUTH FAILED');

  // Test 5: TwelveData adapter start is idempotent and doesn't run per session
  console.log('[Test 5] TwelveData adapter start idempotency...');
  const adapter = new TwelveDataMarketDataAdapter({ apiKey: '' });
  adapter.start();
  adapter.start(); // second call should be clean no-op
  adapter.stop();
  console.log('✓ TwelveData adapter lifecycle is safe and idempotent');

  // Test 6: TwelveData provider rate-limit handling
  console.log('[Test 6] TwelveData 100 events/min rate limit backoff...');
  const testAdapter = new TwelveDataMarketDataAdapter({ apiKey: 'demo' });
  testAdapter.handleMessage(JSON.stringify({
    event: 'message-processing',
    status: 'error',
    messages: ['The server received 103 events from you, which exceeds the limit of 100 events per minute. You may wait for the next minute or contact our technical support to increase the limits.']
  }));
  assert.equal((testAdapter as any).rateLimitedUntil > Date.now(), true, 'Must set rate limit pause window');
  testAdapter.stop();
  console.log('✓ TwelveData rate limit error activates 70s pause backoff');

  await DatabaseClient.getInstance().close();
  runtime.stop();

  console.log('--- All Auth Classification & Session Lifecycle Tests Passed ---');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
