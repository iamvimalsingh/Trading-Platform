/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * EXTERNAL CRM ACCOUNT BINDING TEST SUITE
 * Validates that an EXTERNAL / CRM launch:
 * 1. Resolves exactly ONE authoritative account identity.
 * 2. Does NOT initialize or render the stale DEMO account (DEMO-1001) as the active account.
 * 3. Binds initial store state directly to the CRM-selected account number (e.g. 557575, 58120, 91342).
 * 4. Ensures resetAccount() in external mode does NOT reset to demo balance or 1001.
 * 5. Handles arbitrary account numbers without hardcoding.
 */

import {
  extractLaunchToken,
  getInitialAccount,
  parseLaunchTokenClaims,
  setLaunchToken,
  tradingSocket,
} from '../services/tradingSocket';
import { useTradingStore } from '../store/useTradingStore';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testNum: number, name: string, detail?: string) {
  if (condition) {
    console.log(`  \x1b[32m✔ PASS [BIND-${testNum.toString().padStart(2, '0')}]\x1b[0m ${name}`);
    passed++;
  } else {
    console.error(`  \x1b[31m✖ FAIL [BIND-${testNum.toString().padStart(2, '0')}]\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

// Helper to construct a signed or raw JWT token string
function createMockJwt(payload: Record<string, any>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = 'mock_signature_bytes_for_client_claims';
  return `${header}.${body}.${signature}`;
}

async function runAccountBindingTests() {
  console.log('\n=============================================================');
  console.log('  RUNNING EXTERNAL CRM ACCOUNT BINDING VERIFICATION TESTS');
  console.log('=============================================================\n');

  // TEST 1: Parse claims from external launch token for arbitrary account 557575
  const token557575 = createMockJwt({
    sub: 'client_crm_user_01',
    accountId: 'acc_crm_557575',
    accountNumber: '557575',
    tenantId: 'tenant_broker_live',
    platform: 'MT5',
    currency: 'USD',
    accountType: 'LIVE',
    leverage: 200,
    balance: 50000.00,
    exp: Math.floor(Date.now() / 1000) + 300,
    iat: Math.floor(Date.now() / 1000),
  });

  const claims1 = parseLaunchTokenClaims(token557575);
  assert(
    !!claims1 && claims1.accountNumber === '557575' && claims1.platform === 'MT5' && claims1.balance === 50000.00,
    1,
    'Parse token claims successfully extracts CRM account 557575 and MT5 platform'
  );

  // TEST 2: Parse claims for a completely different account number 91342 (no hardcoding)
  const token91342 = createMockJwt({
    sub: 'client_crm_user_02',
    accountId: 'acc_crm_91342',
    accountNumber: '91342',
    tenantId: 'tenant_broker_live',
    platform: 'MT5',
    currency: 'EUR',
    accountType: 'LIVE',
    leverage: 100,
    balance: 12500.50,
    exp: Math.floor(Date.now() / 1000) + 300,
    iat: Math.floor(Date.now() / 1000),
  });

  const claims2 = parseLaunchTokenClaims(token91342);
  assert(
    !!claims2 && claims2.accountNumber === '91342' && claims2.currency === 'EUR' && claims2.balance === 12500.50,
    2,
    'Arbitrary account 91342 is extracted through identical code path (zero hardcoding)'
  );

  // TEST 3: getInitialAccount with external launch token produces authoritative external account
  setLaunchToken(token557575);
  const initialExt = getInitialAccount();

  assert(
    initialExt.isExternal === true,
    3,
    'getInitialAccount returns isExternal = true when CRM token is active'
  );

  assert(
    initialExt.account.accountNumber === '557575' && initialExt.account.sessionMode === 'EXTERNAL',
    4,
    'Initial account identity is 557575 with sessionMode = EXTERNAL'
  );

  assert(
    initialExt.account.accountNumber !== 'DEMO-1001' && initialExt.account.id !== 'acc_demo_1001',
    5,
    'Demo account DEMO-1001 is NOT the initial active account'
  );

  assert(
    initialExt.ledger.length === 0,
    6,
    'Initial ledger for external account has no stale demo deposit entries'
  );

  // TEST 4: useTradingStore reactive state synchronization
  useTradingStore.getState().setAccountState(initialExt.account);
  const currentStoreAccount = useTradingStore.getState().account;

  assert(
    currentStoreAccount.accountNumber === '557575' && currentStoreAccount.sessionMode === 'EXTERNAL',
    7,
    'Store state holds exactly ONE authoritative account: 557575 (MT5 EXTERNAL)'
  );

  // TEST 5: resetAccount in EXTERNAL mode protects external account from resetting to DEMO-1001
  useTradingStore.getState().resetAccount();
  const afterResetAccount = useTradingStore.getState().account;

  assert(
    afterResetAccount.accountNumber === '557575' && afterResetAccount.sessionMode === 'EXTERNAL',
    8,
    'resetAccount in external mode maintains external account binding (never reverts to DEMO-1001)'
  );

  // TEST 6: Switching external tokens updates store account cleanly
  setLaunchToken(token91342);
  const updatedExt = getInitialAccount();
  useTradingStore.getState().setAccountState(updatedExt.account);

  const switchedStoreAccount = useTradingStore.getState().account;
  assert(
    switchedStoreAccount.accountNumber === '91342' && switchedStoreAccount.currency === 'EUR',
    9,
    'Store dynamically switches to new external account 91342 without stale 1001 remnants'
  );

  // TEST 7: Authoritative sessionReady from socket sets exact authoritative server account
  useTradingStore.getState().initSessionFromSocket({
    connectionId: 'conn_test_authoritative',
    account: {
      id: 'acc_crm_557575',
      tenantId: 'tenant_broker_live',
      accountNumber: '557575',
      platform: 'MT5',
      currency: 'USD',
      accountType: 'LIVE',
      sessionMode: 'EXTERNAL',
      leverage: 200,
      balance: 50000.00,
      equity: 50000.00,
      usedMargin: 0.00,
      freeMargin: 50000.00,
      marginLevel: 0,
      marginCallLevel: 100,
      stopOutLevel: 50,
      status: 'ACTIVE',
    },
    symbols: [],
    positions: [],
    orders: [],
    executions: [],
    ledger: [],
    activeSymbols: [],
  });

  const socketReadyAccount = useTradingStore.getState().account;
  const socketReadyLedger = useTradingStore.getState().ledger;

  assert(
    socketReadyAccount.accountNumber === '557575' && socketReadyAccount.id === 'acc_crm_557575',
    10,
    'initSessionFromSocket authoritatively binds external account identity'
  );

  assert(
    socketReadyLedger.length === 0,
    11,
    'initSessionFromSocket preserves authoritative empty ledger (zero demo fallback)'
  );

  console.log('\n=============================================================');
  console.log(`  ACCOUNT BINDING TESTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('=============================================================\n');

  tradingSocket.disconnect();

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runAccountBindingTests();
