/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * WEBTRADER ACCESS GATE & CLEAN SESSION ARCHITECTURE TEST SUITE
 * Tests all 13 access control and session lifecycle invariants.
 */

import assert from 'node:assert/strict';
import { TradingRuntime } from '../../server/src/runtime/TradingRuntime';
import { SessionTokenService } from '../../server/src/auth/SessionTokenService';
import { DatabaseClient } from '../../server/src/db/DatabaseClient';
import {
  extractLaunchToken,
  getInitialAccount,
  getSavedSessionMode,
  saveSessionMode,
  saveTradingAccountCredentials,
  getSavedTradingAccountCredentials,
  clearLaunchToken,
  setLaunchToken,
} from '../services/tradingSocket';
import { useTradingStore } from '../store/useTradingStore';

// Mock in-memory storage for Node test environment
const mockSessionStorage: Record<string, string> = {};
const mockLocalStorage: Record<string, string> = {};

(globalThis as any).sessionStorage = {
  getItem: (key: string) => mockSessionStorage[key] || null,
  setItem: (key: string, val: string) => { mockSessionStorage[key] = String(val); },
  removeItem: (key: string) => { delete mockSessionStorage[key]; },
  clear: () => { for (const k of Object.keys(mockSessionStorage)) delete mockSessionStorage[k]; },
};

(globalThis as any).localStorage = {
  getItem: (key: string) => mockLocalStorage[key] || null,
  setItem: (key: string, val: string) => { mockLocalStorage[key] = String(val); },
  removeItem: (key: string) => { delete mockLocalStorage[key]; },
  clear: () => { for (const k of Object.keys(mockLocalStorage)) delete mockLocalStorage[k]; },
};

async function runAccessGateTests() {
  console.log('=============================================================');
  console.log('  RUNNING WEBTRADER ACCESS GATE & SESSION LIFECYCLE TESTS');
  console.log('=============================================================\n');

  let passed = 0;
  let failed = 0;

  function test(name: string, condition: boolean, detail?: string) {
    if (condition) {
      console.log(`  \x1b[32m✔ PASS\x1b[0m [GATE-${String(passed + 1).padStart(2, '0')}] ${name}`);
      passed++;
    } else {
      console.error(`  \x1b[31m✖ FAIL\x1b[0m [GATE-${String(passed + failed + 1).padStart(2, '0')}] ${name}${detail ? ` (${detail})` : ''}`);
      failed++;
    }
  }

  const runtime = new TradingRuntime();
  runtime.start();
  await runtime.persistence.init();

  const secret = 'crm_test_secret_gate_999';
  process.env.CRM_LAUNCH_SECRET = secret;

  // Setup test accounts in persistence
  await runtime.persistence.accounts.updateAccount({
    id: 'acc_live_101',
    accountNumber: '101010',
    tenantId: 'broker_live',
    clientId: 'user_101',
    platform: 'MT5',
    currency: 'USD',
    accountType: 'LIVE',
    sessionMode: 'TRADING_ACCOUNT',
    leverage: 200,
    balance: 5000,
    equity: 5000,
    usedMargin: 0,
    freeMargin: 5000,
    marginLevel: 0,
    marginCallLevel: 100,
    stopOutLevel: 50,
    status: 'ACTIVE',
    tradingEnabled: true,
  });
  await runtime.persistence.accounts.setTradingPassword('101010', 'Password123!');

  await runtime.persistence.accounts.updateAccount({
    id: 'acc_disabled_102',
    accountNumber: '102020',
    tenantId: 'broker_live',
    clientId: 'user_102',
    platform: 'MT5',
    currency: 'USD',
    accountType: 'LIVE',
    sessionMode: 'TRADING_ACCOUNT',
    leverage: 100,
    balance: 1000,
    equity: 1000,
    usedMargin: 0,
    freeMargin: 1000,
    marginLevel: 0,
    marginCallLevel: 100,
    stopOutLevel: 50,
    status: 'DISABLED',
    tradingEnabled: false,
  });
  await runtime.persistence.accounts.setTradingPassword('102020', 'Password123!');

  await runtime.persistence.accounts.updateAccount({
    id: 'acc_readonly_103',
    accountNumber: '103030',
    tenantId: 'broker_live',
    clientId: 'user_103',
    platform: 'MT5',
    currency: 'USD',
    accountType: 'LIVE',
    sessionMode: 'TRADING_ACCOUNT',
    leverage: 100,
    balance: 2500,
    equity: 2500,
    usedMargin: 0,
    freeMargin: 2500,
    marginLevel: 0,
    marginCallLevel: 100,
    stopOutLevel: 50,
    status: 'READ_ONLY',
    tradingEnabled: false,
  });
  await runtime.persistence.accounts.setTradingPassword('103030', 'Password123!');

  // TEST 1: Direct URL with no token -> LOGIN_GATE
  clearLaunchToken();
  saveSessionMode(null);
  const directInit = getInitialAccount();
  test('Direct URL with no token yields initialMode = LOGIN_GATE and isExternal = false',
    directInit.initialMode === 'LOGIN_GATE' && directInit.isExternal === false
  );

  // TEST 2: User clicks LOGIN WITH DEMO -> DEMO-1001 loads with $10,000 balance
  useTradingStore.getState().loginWithDemo();
  const demoState = useTradingStore.getState();
  test('LOGIN WITH DEMO sets sessionAuthState = DEMO and loads DEMO-1001 with $10,000 balance',
    demoState.sessionAuthState === 'DEMO' &&
    demoState.account.accountNumber === 'DEMO-1001' &&
    demoState.account.balance === 10000 &&
    getSavedSessionMode() === 'DEMO'
  );

  // TEST 3: Direct URL with valid Trading Account login -> SESSION_READY and correct account loaded
  const session1 = runtime.clients.register('conn_t1', 'unauthenticated', { send: () => {} } as any);
  const authRes = await runtime.initializeSession(session1.connectionId, {
    mode: 'TRADING_ACCOUNT',
    loginId: '101010',
    password: 'Password123!',
  });
  test('Valid Trading Account login resolves server-side SESSION_READY with correct account state',
    authRes.success === true &&
    authRes.readyPayload?.account.accountNumber === '101010' &&
    authRes.readyPayload?.account.balance === 5000 &&
    authRes.readyPayload?.account.leverage === 200
  );

  // TEST 4: Invalid Trading Account credentials -> rejected server-side, no demo fallback
  const session2 = runtime.clients.register('conn_t2', 'unauthenticated', { send: () => {} } as any);
  const invalidRes = await runtime.initializeSession(session2.connectionId, {
    mode: 'TRADING_ACCOUNT',
    loginId: '101010',
    password: 'WrongPassword!',
  });
  test('Invalid Trading Account password rejected with INVALID_CREDENTIALS and no silent DEMO fallback',
    invalidRes.success === false &&
    invalidRes.errorCode === 'INVALID_CREDENTIALS' &&
    invalidRes.error === 'Invalid login ID or account password'
  );

  // TEST 5: Valid CRM SSO -> resolves external account and bypasses login gate
  await runtime.persistence.accounts.updateAccount({
    id: 'acc_crm_99',
    accountNumber: '778899',
    tenantId: 'broker_live',
    clientId: 'client_live_99',
    platform: 'MT5',
    currency: 'USD',
    accountType: 'LIVE',
    sessionMode: 'EXTERNAL',
    leverage: 100,
    balance: 7500,
    equity: 7500,
    usedMargin: 0,
    freeMargin: 7500,
    marginLevel: 0,
    marginCallLevel: 100,
    stopOutLevel: 50,
    status: 'ACTIVE',
    tradingEnabled: true,
  });

  const validToken = SessionTokenService.createLaunchToken({
    iss: 'crm-backend',
    aud: 'trading-terminal',
    tenantId: 'broker_live',
    sub: 'client_live_99',
    accountId: 'acc_crm_99',
    accountNumber: '778899',
    platform: 'MT5',
    currency: 'USD',
    leverage: 100,
    balance: 7500,
  }, 300, secret);

  const session3 = runtime.clients.register('conn_t3', 'unauthenticated', { send: () => {} } as any);
  const ssoRes = await runtime.initializeSession(session3.connectionId, {
    mode: 'EXTERNAL',
    token: validToken,
  });
  test('Valid CRM SSO resolves SESSION_READY for mapped account 778899',
    ssoRes.success === true &&
    ssoRes.readyPayload?.account.accountNumber === '778899' &&
    ssoRes.readyPayload?.account.sessionMode === 'EXTERNAL'
  );

  // TEST 6: Expired CRM SSO -> rejected with SESSION_EXPIRED
  const expiredToken = SessionTokenService.createLaunchToken({
    iss: 'crm-backend',
    aud: 'trading-terminal',
    tenantId: 'broker_live',
    sub: 'client_live_99',
    accountId: 'acc_crm_99',
    accountNumber: '778899',
    platform: 'MT5',
    currency: 'USD',
    leverage: 100,
    balance: 7500,
  }, -10, secret);

  const session4 = runtime.clients.register('conn_t4', 'unauthenticated', { send: () => {} } as any);
  const expiredRes = await runtime.initializeSession(session4.connectionId, {
    mode: 'EXTERNAL',
    token: expiredToken,
  });
  test('Expired CRM SSO token fails with SESSION_EXPIRED',
    expiredRes.success === false &&
    expiredRes.errorCode === 'SESSION_EXPIRED'
  );

  // TEST 7: Stale CRM token cleanup
  clearLaunchToken();
  test('clearLaunchToken clears memory and storage tokens returning null on direct extract',
    extractLaunchToken() === null
  );

  // TEST 8: CRM logout -> direct WebTrader visit returns to LOGIN_GATE
  clearLaunchToken();
  saveSessionMode(null);
  useTradingStore.getState().logout();
  const logoutState = useTradingStore.getState();
  test('Logout action resets store to sessionAuthState = LOGIN_GATE',
    logoutState.sessionAuthState === 'LOGIN_GATE' &&
    logoutState.sessionAuthError === null &&
    getSavedSessionMode() === null
  );

  // TEST 9: Refresh after session expiration -> returns LOGIN_GATE
  clearLaunchToken();
  saveSessionMode(null);
  const refreshAfterExpiry = getInitialAccount();
  test('Refresh after CRM session expiration returns initialMode = LOGIN_GATE (never stuck on EXPIRED)',
    refreshAfterExpiry.initialMode === 'LOGIN_GATE' &&
    refreshAfterExpiry.isExternal === false
  );

  // TEST 10: Refresh after valid Trading Account login preserves session mode if credentials stored
  saveSessionMode('TRADING_ACCOUNT');
  saveTradingAccountCredentials('101010', 'Password123!');
  const refreshTradingAccount = getInitialAccount();
  test('Refresh with stored Trading Account session mode preserves TRADING_ACCOUNT mode',
    refreshTradingAccount.initialMode === 'TRADING_ACCOUNT' &&
    refreshTradingAccount.account.accountNumber === '101010'
  );

  // TEST 11: Account status DISABLED -> login rejected
  const session5 = runtime.clients.register('conn_t5', 'unauthenticated', { send: () => {} } as any);
  const disabledRes = await runtime.initializeSession(session5.connectionId, {
    mode: 'TRADING_ACCOUNT',
    loginId: '102020',
    password: 'Password123!',
  });
  test('Disabled trading account rejected with ACCOUNT_DISABLED',
    disabledRes.success === false &&
    disabledRes.errorCode === 'ACCOUNT_DISABLED'
  );

  // TEST 12: Account status READ_ONLY -> login accepted with tradingEnabled = false
  const session6 = runtime.clients.register('conn_t6', 'unauthenticated', { send: () => {} } as any);
  const readOnlyRes = await runtime.initializeSession(session6.connectionId, {
    mode: 'TRADING_ACCOUNT',
    loginId: '103030',
    password: 'Password123!',
  });
  test('READ_ONLY trading account login accepted with tradingEnabled = false for RiskEngine enforcement',
    readOnlyRes.success === true &&
    readOnlyRes.readyPayload?.account.tradingEnabled === false
  );

  // TEST 13: Canonical DEMO-1001 engine execution remains unchanged
  const session7 = runtime.clients.register('conn_t7', 'unauthenticated', { send: () => {} } as any);
  const demoInitRes = await runtime.initializeSession(session7.connectionId, { mode: 'DEMO' });
  test('DEMO-1001 initialization resolves canonical demo account with $10,000 balance and active trading',
    demoInitRes.success === true &&
    demoInitRes.readyPayload?.account.accountNumber === 'DEMO-1001' &&
    demoInitRes.readyPayload?.account.balance === 10000 &&
    demoInitRes.readyPayload?.account.tradingEnabled === true
  );

  console.log('\n=============================================================');
  console.log(`  ACCESS GATE TESTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('=============================================================\n');

  await DatabaseClient.getInstance().close();
  runtime.stop();

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runAccessGateTests().catch((err) => {
  console.error('Access Gate Test Runner Failed:', err);
  process.exit(1);
});
