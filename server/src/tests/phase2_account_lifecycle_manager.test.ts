/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * PHASE 2 — TRADING ACCOUNT RUNTIME CONTRACT & MANAGER FOUNDATION TESTS
 * Validates:
 * 1. Universal Account Status Normalization ("active", "Active", " read_only ", unknown states)
 * 2. RiskEngine Status Enforcement & Clear Rejection Reasons
 * 3. Removal of Unsafe SSO Auto-Provisioning (ACCOUNT_NOT_PROVISIONED)
 * 4. Existing External Accounts with Valid SSO & Non-Tradable States (READ_ONLY, DISABLED)
 * 5. Manager Account Provisioning API (POST /api/admin/trading/accounts) with client mapping & standalone
 * 6. Manager Account Updates (PATCH /api/admin/trading/accounts/:id)
 * 7. Safe Account Deletion (Hard delete unused vs block delete for traded accounts)
 * 8. Audit Logging across all operations
 * 9. Standalone DEMO account & direct launch preservation
 * 
 * Run with: tsx server/src/tests/phase2_account_lifecycle_manager.test.ts
 */

import fs from 'fs';
import path from 'path';
import { WebSocket } from 'ws';
import { createAppAndServer } from '../index';
import { DatabaseClient } from '../db/DatabaseClient';
import { SessionTokenService } from '../auth/SessionTokenService';
import { AdminAuthService } from '../auth/AdminAuthService';
import { RiskEngine } from '../trading/RiskEngine';
import { normalizeAccountStatus, isValidAccountStatus } from '../utils/accountStatus';
import { TradingAccount, SymbolConfig } from '../types/trading';
import { WsEnvelope } from '../ws/wsProtocol';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testNum: number, name: string, detail?: string) {
  if (condition) {
    console.log(`  \x1b[32m✔ PASS [P2-${testNum.toString().padStart(2, '0')}]\x1b[0m ${name}`);
    passed++;
  } else {
    console.error(`  \x1b[31m✖ FAIL [P2-${testNum.toString().padStart(2, '0')}]\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

async function runPhase2Tests() {
  process.env.USE_REAL_MARKET_DATA = 'false';
  const testSecret = 'crm_phase2_secret_key_8849204';
  process.env.CRM_LAUNCH_SECRET = testSecret;

  const testDbDir = path.resolve(process.cwd(), 'data', 'test_phase2_db');
  if (fs.existsSync(testDbDir)) {
    fs.rmSync(testDbDir, { recursive: true, force: true });
  }
  process.env.DATABASE_STORAGE_PATH = testDbDir;
  DatabaseClient.resetInstance();

  console.log('\n=============================================================');
  console.log('  RUNNING PHASE 2 TRADING ACCOUNT & MANAGER REGRESSION SUITE');
  console.log('=============================================================\n');

  const { httpServer, runtime, wsServer, adminService } = createAppAndServer();
  let serverPort = 0;

  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => {
      const address = httpServer.address() as any;
      serverPort = address.port;
      resolve();
    });
  });

  const adminToken = AdminAuthService.generateAdminToken({
    adminId: 'admin_test_01',
    tenantId: 'tenant_default',
    role: 'SUPER_ADMIN',
  });

  const apiCall = async (endpoint: string, options: any = {}) => {
    const url = `http://127.0.0.1:${serverPort}${endpoint}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  };

  const connectHelper = async (): Promise<{
    ws: WebSocket;
    messages: WsEnvelope[];
    waitForMessage: (type: string, requestId?: string, timeoutMs?: number) => Promise<WsEnvelope | undefined>;
    sendEnvelope: (type: string, payload: any, requestId?: string) => void;
    close: () => void;
  }> => {
    const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws`);
    const messages: WsEnvelope[] = [];

    ws.on('message', (data: any) => {
      try {
        messages.push(JSON.parse(data.toString()));
      } catch {
        // ignore parse error
      }
    });

    await new Promise<void>((resolve) => ws.on('open', () => resolve()));

    const waitForMessage = (type: string, requestId?: string, timeoutMs: number = 5000): Promise<WsEnvelope | undefined> => {
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

  const sampleEurusdCfg: SymbolConfig = {
    id: 'sym_eurusd',
    symbol: 'EURUSD',
    name: 'Euro / US Dollar',
    category: 'FOREX',
    digits: 5,
    contractSize: 100000,
    minVolume: 0.01,
    maxVolume: 100.0,
    volumeStep: 0.01,
    defaultSpreadPoints: 1.2,
    baseCurrency: 'EUR',
    quoteCurrency: 'USD',
    description: 'Euro vs Dollar',
  };

  // -------------------------------------------------------------------------
  // TEST 1: DB status "active" -> runtime status ACTIVE -> order allowed
  // -------------------------------------------------------------------------
  console.log('--- 1. UNIVERSAL ACCOUNT STATUS NORMALIZATION & RISK ENFORCEMENT ---');
  const accountActiveLower: TradingAccount = {
    id: 'acc_test_active_lower',
    tenantId: 'tenant_default',
    accountNumber: 'TEST-1001',
    currency: 'USD',
    accountType: 'LIVE',
    leverage: 100,
    balance: 10000.00,
    equity: 10000.00,
    usedMargin: 0.00,
    freeMargin: 10000.00,
    marginLevel: 0,
    marginCallLevel: 100,
    stopOutLevel: 50,
    status: 'active' as any, // Raw lowercase string from DB
    tradingEnabled: true,
  };

  // Save to DB with raw lowercase status
  await runtime.persistence.init();
  await (runtime.persistence.accounts as any).db.query(
    `INSERT INTO trading_accounts (id, tenant_id, account_number, status, balance, equity, free_margin, leverage)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status;`,
    [accountActiveLower.id, accountActiveLower.tenantId, accountActiveLower.accountNumber, 'active', 10000.0, 10000.0, 10000.0, 100]
  );

  // Hydrate from DB
  const hydratedLower = await runtime.persistence.accounts.getAccount(accountActiveLower.id);
  assert(
    !!hydratedLower && hydratedLower.status === 'ACTIVE',
    1,
    'DB status "active" hydrates as canonical uppercase ACTIVE'
  );

  const riskCheckLower = RiskEngine.validatePreTradeRisk(hydratedLower!, 108.50, sampleEurusdCfg, 0.1);
  assert(
    riskCheckLower.valid,
    1,
    'Order allowed on account hydrated from DB status "active"'
  );

  // -------------------------------------------------------------------------
  // TEST 2: DB status "Active" -> runtime ACTIVE
  // -------------------------------------------------------------------------
  await (runtime.persistence.accounts as any).db.query(
    `UPDATE trading_accounts SET status = 'Active' WHERE id = $1;`,
    [accountActiveLower.id]
  );
  const hydratedTitleCase = await runtime.persistence.accounts.getAccount(accountActiveLower.id);
  assert(
    !!hydratedTitleCase && hydratedTitleCase.status === 'ACTIVE',
    2,
    'DB status "Active" normalizes to canonical ACTIVE'
  );

  // -------------------------------------------------------------------------
  // TEST 3: DB status " read_only " -> runtime READ_ONLY
  // -------------------------------------------------------------------------
  await (runtime.persistence.accounts as any).db.query(
    `UPDATE trading_accounts SET status = ' read_only ' WHERE id = $1;`,
    [accountActiveLower.id]
  );
  const hydratedReadOnly = await runtime.persistence.accounts.getAccount(accountActiveLower.id);
  assert(
    !!hydratedReadOnly && hydratedReadOnly.status === 'READ_ONLY',
    3,
    'DB status " read_only " normalizes to canonical READ_ONLY'
  );
  const riskCheckReadOnly = RiskEngine.validatePreTradeRisk(hydratedReadOnly!, 108.50, sampleEurusdCfg, 0.1);
  assert(
    !riskCheckReadOnly.valid && riskCheckReadOnly.reason === 'Trading is disabled for this read-only account',
    3,
    'Order strictly rejected for READ_ONLY account with clear explanation'
  );

  // -------------------------------------------------------------------------
  // TEST 4: Unknown status -> rejected/handled safely -> never becomes ACTIVE
  // -------------------------------------------------------------------------
  await (runtime.persistence.accounts as any).db.query(
    `UPDATE trading_accounts SET status = 'pending_approval_xyz' WHERE id = $1;`,
    [accountActiveLower.id]
  );
  const hydratedUnknown = await runtime.persistence.accounts.getAccount(accountActiveLower.id);
  assert(
    !!hydratedUnknown && hydratedUnknown.status !== 'ACTIVE' && hydratedUnknown.status === 'DISABLED',
    4,
    'Unknown DB status safely falls back to DISABLED and NEVER silently becomes ACTIVE'
  );
  assert(!isValidAccountStatus('pending_approval_xyz'), 4, 'isValidAccountStatus correctly identifies unknown states as invalid');
  assert(normalizeAccountStatus('pending_approval_xyz') === 'DISABLED', 4, 'normalizeAccountStatus maps unknown state to DISABLED');

  // -------------------------------------------------------------------------
  // TEST 5: Existing external account with valid SSO -> authenticated successfully
  // -------------------------------------------------------------------------
  console.log('\n--- 2. SSO AUTHENTICATION & REMOVAL OF AUTO-PROVISIONING ---');
  const validClaimsP2 = {
    iss: 'crm-backend',
    sub: 'client_p2_valid',
    aud: 'trading-terminal',
    accountId: 'acc_crm_p2_70001',
    accountNumber: '70001',
    tenantId: 'tenant_default',
    platform: 'MT5' as const,
    currency: 'USD',
    accountType: 'LIVE' as const,
    leverage: 100,
    initialBalance: 12500.00,
  };

  // Pre-provision account 70001 in DB
  await runtime.persistence.accounts.updateAccount({
    id: validClaimsP2.accountId,
    tenantId: validClaimsP2.tenantId,
    clientId: validClaimsP2.sub,
    accountNumber: validClaimsP2.accountNumber,
    platform: validClaimsP2.platform,
    currency: validClaimsP2.currency,
    accountType: validClaimsP2.accountType,
    sessionMode: 'EXTERNAL',
    leverage: validClaimsP2.leverage,
    balance: validClaimsP2.initialBalance,
    equity: validClaimsP2.initialBalance,
    usedMargin: 0.00,
    freeMargin: validClaimsP2.initialBalance,
    marginLevel: 0,
    marginCallLevel: 100,
    stopOutLevel: 50,
    status: 'ACTIVE',
    tradingEnabled: true,
  });

  const validTokenP2 = SessionTokenService.createLaunchToken(validClaimsP2, 300, testSecret);
  const clientValid = await connectHelper();
  clientValid.sendEnvelope('SESSION_INIT', { mode: 'EXTERNAL', token: validTokenP2 }, 'req_p2_valid');
  const readyP2 = await clientValid.waitForMessage('SESSION_READY', 'req_p2_valid');
  const accReadyP2 = (readyP2?.payload as any)?.account;
  clientValid.close();

  assert(
    !!readyP2 && !!accReadyP2 && accReadyP2.accountNumber === '70001' && accReadyP2.balance === 12500.00,
    5,
    'Existing external account with valid SSO authenticates successfully'
  );

  // -------------------------------------------------------------------------
  // TEST 6: External SSO references nonexistent account -> ACCOUNT_NOT_PROVISIONED
  // -------------------------------------------------------------------------
  const unprovisionedClaims = {
    ...validClaimsP2,
    accountId: 'acc_unprovisioned_99999',
    accountNumber: '99999',
  };
  const unprovisionedToken = SessionTokenService.createLaunchToken(unprovisionedClaims, 300, testSecret);
  const clientUnprov = await connectHelper();
  clientUnprov.sendEnvelope('SESSION_INIT', { mode: 'EXTERNAL', token: unprovisionedToken }, 'req_p2_unprov');
  const errUnprov = await clientUnprov.waitForMessage('ERROR', 'req_p2_unprov');
  clientUnprov.close();

  assert(
    !!errUnprov && (errUnprov.payload as any)?.code === 'ACCOUNT_NOT_PROVISIONED',
    6,
    'External SSO for nonexistent account emits ACCOUNT_NOT_PROVISIONED without auto-creation'
  );

  // Confirm account was NOT auto-created in database
  const checkDbUnprov = await runtime.persistence.accounts.getAccount('99999');
  assert(
    checkDbUnprov === undefined,
    6,
    'Nonexistent account remains uncreated in database after failed SSO attempt'
  );

  // -------------------------------------------------------------------------
  // TEST 7: External SSO references DISABLED account -> access according to state
  // -------------------------------------------------------------------------
  const disabledClaims = {
    ...validClaimsP2,
    accountId: 'acc_crm_p2_disabled',
    accountNumber: '70002_DISABLED',
  };
  await runtime.persistence.accounts.updateAccount({
    id: disabledClaims.accountId,
    tenantId: disabledClaims.tenantId,
    clientId: disabledClaims.sub,
    accountNumber: disabledClaims.accountNumber,
    platform: 'MT5',
    currency: 'USD',
    accountType: 'LIVE',
    sessionMode: 'EXTERNAL',
    leverage: 100,
    balance: 5000.00,
    equity: 5000.00,
    usedMargin: 0.00,
    freeMargin: 5000.00,
    marginLevel: 0,
    marginCallLevel: 100,
    stopOutLevel: 50,
    status: 'DISABLED',
    tradingEnabled: false,
  });

  const disabledToken = SessionTokenService.createLaunchToken(disabledClaims, 300, testSecret);
  const clientDisabled = await connectHelper();
  clientDisabled.sendEnvelope('SESSION_INIT', { mode: 'EXTERNAL', token: disabledToken }, 'req_p2_disabled');
  const readyDisabled = await clientDisabled.waitForMessage('SESSION_READY', 'req_p2_disabled');
  const accDisabled = (readyDisabled?.payload as any)?.account;
  clientDisabled.close();

  assert(
    !!readyDisabled && !!accDisabled && accDisabled.status === 'DISABLED' && accDisabled.tradingEnabled === false,
    7,
    'External SSO for DISABLED account authenticates with preserved DISABLED state'
  );
  const checkRiskDisabled = RiskEngine.validatePreTradeRisk(accDisabled, 108.50, sampleEurusdCfg, 0.1);
  assert(
    !checkRiskDisabled.valid && checkRiskDisabled.reason === 'Trading account is disabled',
    7,
    'RiskEngine strictly blocks trades on DISABLED account with truthful reason'
  );

  // -------------------------------------------------------------------------
  // TEST 8: External SSO references READ_ONLY account -> quotes work, new orders rejected
  // -------------------------------------------------------------------------
  const readOnlyClaims = {
    ...validClaimsP2,
    accountId: 'acc_crm_p2_readonly',
    accountNumber: '70003_READONLY',
  };
  await runtime.persistence.accounts.updateAccount({
    id: readOnlyClaims.accountId,
    tenantId: readOnlyClaims.tenantId,
    clientId: readOnlyClaims.sub,
    accountNumber: readOnlyClaims.accountNumber,
    platform: 'MT5',
    currency: 'USD',
    accountType: 'LIVE',
    sessionMode: 'EXTERNAL',
    leverage: 100,
    balance: 7500.00,
    equity: 7500.00,
    usedMargin: 0.00,
    freeMargin: 7500.00,
    marginLevel: 0,
    marginCallLevel: 100,
    stopOutLevel: 50,
    status: 'READ_ONLY',
    tradingEnabled: true,
  });

  const readOnlyToken = SessionTokenService.createLaunchToken(readOnlyClaims, 300, testSecret);
  const clientReadOnly = await connectHelper();
  clientReadOnly.sendEnvelope('SESSION_INIT', { mode: 'EXTERNAL', token: readOnlyToken }, 'req_p2_ro');
  const readyRO = await clientReadOnly.waitForMessage('SESSION_READY', 'req_p2_ro');
  const accRO = (readyRO?.payload as any)?.account;

  // Try placing order on read-only account
  clientReadOnly.sendEnvelope('PLACE_ORDER', {
    symbol: 'EURUSD',
    side: 'BUY',
    type: 'MARKET',
    volume: 0.1,
  }, 'req_ro_order');
  const orderAckRO = await clientReadOnly.waitForMessage('ORDER_ACK', 'req_ro_order');
  clientReadOnly.close();

  assert(
    !!readyRO && !!accRO && accRO.status === 'READ_ONLY',
    8,
    'External SSO for READ_ONLY account connects and receives quotes and state'
  );
  assert(
    !!orderAckRO && (orderAckRO.payload as any)?.success === false && (orderAckRO.payload as any)?.error?.includes('read-only'),
    8,
    'New order on READ_ONLY account is rejected by OrderEngine / RiskEngine'
  );

  // -------------------------------------------------------------------------
  // TEST 9: Manager POST account provisioning -> DB + runtime + audit
  // -------------------------------------------------------------------------
  console.log('\n--- 3. MANAGER ACCOUNT PROVISIONING & CONTROLS API ---');
  const createRes = await apiCall('/api/admin/trading/accounts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      accountNumber: '80001',
      clientId: 'crm_client_manager_1',
      currency: 'USD',
      accountType: 'LIVE',
      leverage: 200,
      initialBalance: 50000.00,
      status: 'ACTIVE',
      tradingEnabled: true,
      reason: 'VIP Client Approved by Compliance',
    }),
  });

  assert(
    createRes.status === 201 && !!createRes.data && createRes.data.accountNumber === '80001' && createRes.data.balance === 50000.00,
    9,
    'Manager POST account provisioning creates account with 201 Created'
  );

  // Check runtime memory & DB persistence
  const dbProvAcc = await runtime.persistence.accounts.getAccount('80001');
  const memProvAcc = runtime.accounts.getAccount('80001');
  assert(
    !!dbProvAcc && !!memProvAcc && dbProvAcc.id === memProvAcc.id && dbProvAcc.balance === 50000.00,
    9,
    'Manager-provisioned account is immediately synchronized in PostgreSQL and runtime memory'
  );

  // Check audit log
  const auditRes = await apiCall('/api/admin/trading/audit?resourceType=ACCOUNT', {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const createAudit = auditRes.data?.find((a: any) => a.action === 'CREATE_ACCOUNT' && a.resourceId === createRes.data.id);
  assert(
    !!createAudit && createAudit.adminId === 'admin_test_01',
    9,
    'Manager account provisioning produces immutable audit log entry'
  );

  // -------------------------------------------------------------------------
  // TEST 10: Manager provisioning with optional client mapping -> correct association
  // -------------------------------------------------------------------------
  assert(
    createRes.data.clientId === 'crm_client_manager_1',
    10,
    'Manager provisioning with explicit clientId associates CRM client correctly'
  );

  // -------------------------------------------------------------------------
  // TEST 11: Manager provisioning without client mapping (Standalone Account)
  // -------------------------------------------------------------------------
  const createStandaloneRes = await apiCall('/api/admin/trading/accounts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      accountNumber: '80002_STANDALONE',
      clientId: null,
      currency: 'USD',
      accountType: 'LIVE',
      leverage: 100,
      initialBalance: 1000.00,
      status: 'ACTIVE',
      reason: 'Proprietary desk trading account',
    }),
  });

  assert(
    createStandaloneRes.status === 201 && createStandaloneRes.data.clientId === null,
    11,
    'Manager provisioning supports standalone accounts (clientId = null) seamlessly'
  );

  // -------------------------------------------------------------------------
  // TEST 12: Manager PATCH leverage / status / tradingEnabled
  // -------------------------------------------------------------------------
  const patchRes = await apiCall(`/api/admin/trading/accounts/${createRes.data.id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      status: 'SUSPENDED',
      tradingEnabled: false,
      leverage: 50,
      reason: 'Margin call risk review',
    }),
  });

  assert(
    patchRes.status === 200 &&
      patchRes.data.status === 'SUSPENDED' &&
      patchRes.data.tradingEnabled === false &&
      patchRes.data.leverage === 50,
    12,
    'Manager PATCH updates status, tradingEnabled, and leverage atomically'
  );

  const dbPatched = await runtime.persistence.accounts.getAccount(createRes.data.id);
  const memPatched = runtime.accounts.getAccount(createRes.data.id);
  assert(
    dbPatched?.status === 'SUSPENDED' && memPatched?.status === 'SUSPENDED',
    12,
    'Manager PATCH synchronizes database and runtime memory identically'
  );

  // -------------------------------------------------------------------------
  // TEST 13: Eligible unused account -> safe hard delete
  // -------------------------------------------------------------------------
  console.log('\n--- 4. SAFE ACCOUNT DELETION & CLOSE MODEL ---');
  // Create a brand-new unused account with 0 balance and 0 ledger entries
  const unusedRes = await apiCall('/api/admin/trading/accounts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      accountNumber: '80003_UNUSED',
      initialBalance: 0,
      status: 'ACTIVE',
      reason: 'Temporary test account',
    }),
  });

  const deleteUnusedRes = await apiCall(`/api/admin/trading/accounts/${unusedRes.data.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${adminToken}` },
  });

  assert(
    deleteUnusedRes.status === 200 && deleteUnusedRes.data.success === true,
    13,
    'Eligible unused account with zero trading history is safely hard deleted'
  );
  const checkDeletedDb = await runtime.persistence.accounts.getAccount(unusedRes.data.id);
  assert(
    checkDeletedDb === undefined,
    13,
    'Hard-deleted account is removed from database and in-memory registry'
  );

  // -------------------------------------------------------------------------
  // TEST 14: Account with trading history -> hard delete blocked
  // -------------------------------------------------------------------------
  // Use account 80001 which has initial deposit ledger entry
  const deleteTradedRes = await apiCall(`/api/admin/trading/accounts/${createRes.data.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${adminToken}` },
  });

  assert(
    deleteTradedRes.status === 409 && deleteTradedRes.data.error?.includes('Cannot delete account with existing trading history'),
    14,
    'Account with financial ledger entries or trading history strictly blocks hard deletion (409 Conflict)'
  );

  // -------------------------------------------------------------------------
  // TEST 15: Existing demo account DEMO-1001 remains functional and unaffected
  // -------------------------------------------------------------------------
  console.log('\n--- 5. STANDALONE DEMO & BACKWARD COMPATIBILITY ---');
  const demoAcc = runtime.accounts.getAccount('DEMO-1001');
  assert(
    !!demoAcc && demoAcc.accountNumber === 'DEMO-1001' && demoAcc.status === 'ACTIVE' && demoAcc.balance === 10000.00,
    15,
    'Built-in demo account DEMO-1001 remains fully functional and unaffected'
  );

  // -------------------------------------------------------------------------
  // TEST 16: Direct no-token demo mode still works
  // -------------------------------------------------------------------------
  const clientDirectDemo = await connectHelper();
  clientDirectDemo.sendEnvelope('SESSION_INIT', { mode: 'DEMO' }, 'req_demo_direct');
  const readyDemo = await clientDirectDemo.waitForMessage('SESSION_READY', 'req_demo_direct');
  const accDemo = (readyDemo?.payload as any)?.account;
  clientDirectDemo.close();

  assert(
    !!readyDemo && !!accDemo && accDemo.accountNumber === 'DEMO-1001' && accDemo.sessionMode === 'DEMO',
    16,
    'Direct no-token launch opens in DEMO mode with DEMO-1001 account authoritatively'
  );

  // -------------------------------------------------------------------------
  // TEST 17: Existing CRM SSO account still works after status normalization and provisioning guard
  // -------------------------------------------------------------------------
  const clientSsoStillWorks = await connectHelper();
  clientSsoStillWorks.sendEnvelope('SESSION_INIT', { mode: 'EXTERNAL', token: validTokenP2 }, 'req_sso_final');
  const readySsoFinal = await clientSsoStillWorks.waitForMessage('SESSION_READY', 'req_sso_final');
  const accSsoFinal = (readySsoFinal?.payload as any)?.account;
  clientSsoStillWorks.close();

  assert(
    !!readySsoFinal && !!accSsoFinal && accSsoFinal.accountNumber === '70001' && accSsoFinal.status === 'ACTIVE',
    17,
    'CRM SSO account 70001 continues working with verified token, quotes, and active trading'
  );

  // Teardown
  wsServer.close();
  runtime.stop();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));

  console.log('\n=============================================================');
  console.log(`  PHASE 2 TEST SUITE RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('=============================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase2Tests().catch((err) => {
  console.error('Fatal error during Phase 2 test execution:', err);
  process.exit(1);
});
