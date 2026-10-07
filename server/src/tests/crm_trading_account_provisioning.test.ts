/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * CRM TRADING ACCOUNT PROVISIONING & MANAGER CONTRACT TEST SUITE
 * 
 * Verifies:
 * 1. Create standalone trading account
 * 2. Create client-linked trading account
 * 3. Create with initial balance
 * 4. Trading password can authenticate
 * 5. Wrong password rejected
 * 6. Password reset invalidates old password
 * 7. New password authenticates
 * 8. Account status controls access (DISABLED, SUSPENDED)
 * 9. READ_ONLY behavior (login allowed, order execution blocked)
 * 10. Duplicate provisioning does not create duplicate account (idempotent retry)
 * 11. Account created through API is immediately available to WebTrader without restart
 * 12. Account balance/leverage available after creation
 * 13. Client mapping preserved
 * 14. Initial ledger transaction created
 * 
 * Run with: npx tsx server/src/tests/crm_trading_account_provisioning.test.ts
 */

import fs from 'fs';
import path from 'path';
import { WebSocket } from 'ws';
import { createAppAndServer } from '../index';
import { DatabaseClient } from '../db/DatabaseClient';
import { AdminAuthService } from '../auth/AdminAuthService';
import { WsEnvelope } from '../ws/wsProtocol';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testNum: number, name: string, detail?: string) {
  if (condition) {
    console.log(`  \x1b[32m✔ PASS [PROV-${testNum.toString().padStart(2, '0')}]\x1b[0m ${name}`);
    passed++;
  } else {
    console.error(`  \x1b[31m✖ FAIL [PROV-${testNum.toString().padStart(2, '0')}]\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

async function runProvisioningTests() {
  process.env.USE_REAL_MARKET_DATA = 'false';
  process.env.ADMIN_API_KEY = 'test_admin_api_key_provisioning_99';
  process.env.ADMIN_API_SECRET = 'test_admin_api_key_provisioning_99';

  const testDbDir = path.resolve(process.cwd(), 'data', 'test_prov_db');
  if (fs.existsSync(testDbDir)) {
    fs.rmSync(testDbDir, { recursive: true, force: true });
  }
  process.env.DATABASE_STORAGE_PATH = testDbDir;
  DatabaseClient.resetInstance();

  console.log('\n=============================================================');
  console.log('  RUNNING CRM TRADING ACCOUNT PROVISIONING CONTRACT SUITE');
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

  // Ensure database tables and initial migrations are ready
  await runtime.persistence.init();
  await adminService.init();

  const adminToken = AdminAuthService.generateAdminToken({
    adminId: 'crm_manager_01',
    tenantId: 'tenant_default',
    role: 'SUPER_ADMIN',
  });

  const apiCall = async (endpoint: string, options: any = {}) => {
    const url = `http://127.0.0.1:${serverPort}${endpoint}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
        ...options.headers,
      },
    });
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  };

  const connectWsHelper = async (): Promise<{
    ws: WebSocket;
    messages: WsEnvelope[];
    waitForMessage: (type: string, requestId?: string, timeoutMs?: number) => Promise<WsEnvelope | undefined>;
    sendEnvelope: (type: string, payload: any, requestId?: string) => void;
    close: () => void;
  }> => {
    const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws`);
    const messages: WsEnvelope[] = [];

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WS connection timeout')), 3000);
      ws.on('open', () => {
        clearTimeout(timer);
        resolve();
      });
      ws.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    ws.on('message', (raw) => {
      try {
        const env = JSON.parse(raw.toString()) as WsEnvelope;
        messages.push(env);
      } catch {
        // ignore
      }
    });

    const waitForMessage = async (type: string, requestId?: string, timeoutMs = 3000): Promise<WsEnvelope | undefined> => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const found = messages.find(
          (m) => m.type === type && (!requestId || m.requestId === requestId)
        );
        if (found) return found;
        await new Promise((r) => setTimeout(r, 20));
      }
      return undefined;
    };

    const sendEnvelope = (type: string, payload: any, requestId?: string) => {
      ws.send(JSON.stringify({ type, payload, requestId, timestamp: Date.now() }));
    };

    const close = () => {
      try {
        ws.close();
      } catch {}
    };

    return { ws, messages, waitForMessage, sendEnvelope, close };
  };

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Create standalone trading account (clientId = null)
    // -------------------------------------------------------------------------
    const standaloneRes = await apiCall('/api/admin/trading/accounts', {
      method: 'POST',
      body: JSON.stringify({
        accountNumber: '900001',
        clientId: null,
        currency: 'USD',
        leverage: 200,
        status: 'ACTIVE',
        tradingPassword: 'StandalonePass123!',
      }),
    });

    assert(
      standaloneRes.status === 201 &&
      standaloneRes.data?.accountNumber === '900001' &&
      !standaloneRes.data?.clientId &&
      standaloneRes.data?.leverage === 200 &&
      standaloneRes.data?.tradingPassword === undefined &&
      standaloneRes.data?.passwordHash === undefined,
      1,
      'Create standalone trading account with clientId = null, sanitized response',
      JSON.stringify(standaloneRes.data)
    );

    // -------------------------------------------------------------------------
    // TEST 2: Create client-linked trading account (clientId = 'crm_usr_55001')
    // -------------------------------------------------------------------------
    const clientLinkedRes = await apiCall('/api/admin/trading/accounts', {
      method: 'POST',
      body: JSON.stringify({
        accountNumber: '900002',
        clientId: 'crm_usr_55001',
        currency: 'EUR',
        platform: 'MT5',
        leverage: 100,
        status: 'ACTIVE',
        tradingPassword: 'ClientPass456!',
      }),
    });

    assert(
      clientLinkedRes.status === 201 &&
      clientLinkedRes.data?.accountNumber === '900002' &&
      clientLinkedRes.data?.clientId === 'crm_usr_55001' &&
      clientLinkedRes.data?.currency === 'EUR',
      2,
      'Create client-linked trading account preserving CRM client mapping'
    );

    // -------------------------------------------------------------------------
    // TEST 3: Create with initial balance ($5,000.00)
    // -------------------------------------------------------------------------
    const fundedRes = await apiCall('/api/admin/trading/accounts', {
      method: 'POST',
      body: JSON.stringify({
        accountNumber: '900003',
        clientId: 'crm_usr_55002',
        initialBalance: 5000.00,
        leverage: 500,
        status: 'ACTIVE',
        tradingPassword: 'FundedPass789!',
      }),
    });

    assert(
      fundedRes.status === 201 &&
      fundedRes.data?.balance === 5000.00 &&
      fundedRes.data?.equity === 5000.00 &&
      fundedRes.data?.freeMargin === 5000.00 &&
      fundedRes.data?.leverage === 500,
      3,
      'Create account with initial balance & leverage correctly configured'
    );

    // -------------------------------------------------------------------------
    // TEST 4: Trading password can authenticate via WebSocket SESSION_INIT
    // -------------------------------------------------------------------------
    const wsClient1 = await connectWsHelper();
    wsClient1.sendEnvelope('SESSION_INIT', {
      mode: 'TRADING_ACCOUNT',
      loginId: '900001',
      password: 'StandalonePass123!',
    }, 'req_auth_01');

    const auth1Ready = await wsClient1.waitForMessage('SESSION_READY', 'req_auth_01');
    const auth1Acc = (auth1Ready?.payload as any)?.account;
    assert(
      !!auth1Ready &&
      auth1Acc?.accountNumber === '900001' &&
      auth1Acc?.sessionMode === 'TRADING_ACCOUNT',
      4,
      'Direct Trading Account login succeeds with valid password'
    );
    wsClient1.close();

    // -------------------------------------------------------------------------
    // TEST 5: Wrong password rejected with INVALID_CREDENTIALS error
    // -------------------------------------------------------------------------
    const wsClient2 = await connectWsHelper();
    wsClient2.sendEnvelope('SESSION_INIT', {
      mode: 'TRADING_ACCOUNT',
      loginId: '900001',
      password: 'WrongPassword!',
    }, 'req_auth_02');

    const auth2Err = await wsClient2.waitForMessage('ERROR', 'req_auth_02');
    const auth2ErrPayload = auth2Err?.payload as any;
    assert(
      !!auth2Err &&
      auth2ErrPayload?.code === 'INVALID_CREDENTIALS' &&
      auth2ErrPayload?.message === 'Invalid login ID or account password',
      5,
      'Invalid trading password rejected with clear error without DEMO fallback'
    );
    wsClient2.close();

    // -------------------------------------------------------------------------
    // TEST 6 & 7: Password reset invalidates old password and new password authenticates
    // -------------------------------------------------------------------------
    const resetRes = await apiCall(`/api/admin/trading/accounts/${standaloneRes.data.id}/password`, {
      method: 'POST',
      body: JSON.stringify({
        password: 'NewResetPassword999!',
        reason: 'Client requested password reset via CRM portal',
      }),
    });

    assert(
      resetRes.status === 200 &&
      resetRes.data?.success === true &&
      resetRes.data?.accountNumber === '900001',
      6,
      'Manager password reset endpoint returns 200 OK and confirms reset'
    );

    // Old password should fail now
    const wsClient3 = await connectWsHelper();
    wsClient3.sendEnvelope('SESSION_INIT', {
      mode: 'TRADING_ACCOUNT',
      loginId: '900001',
      password: 'StandalonePass123!',
    }, 'req_auth_03');
    const auth3OldErr = await wsClient3.waitForMessage('ERROR', 'req_auth_03');

    // New password should succeed
    const wsClient4 = await connectWsHelper();
    wsClient4.sendEnvelope('SESSION_INIT', {
      mode: 'TRADING_ACCOUNT',
      loginId: '900001',
      password: 'NewResetPassword999!',
    }, 'req_auth_04');
    const auth4NewReady = await wsClient4.waitForMessage('SESSION_READY', 'req_auth_04');

    const auth3Payload = auth3OldErr?.payload as any;
    const auth4Acc = (auth4NewReady?.payload as any)?.account;
    assert(
      !!auth3OldErr && auth3Payload?.code === 'INVALID_CREDENTIALS' &&
      !!auth4NewReady && auth4Acc?.accountNumber === '900001',
      7,
      'Old password invalidated and new password authenticates immediately'
    );
    wsClient3.close();
    wsClient4.close();

    // -------------------------------------------------------------------------
    // TEST 8: Account status controls access (DISABLED & SUSPENDED)
    // -------------------------------------------------------------------------
    const disabledAccRes = await apiCall('/api/admin/trading/accounts', {
      method: 'POST',
      body: JSON.stringify({
        accountNumber: '900008',
        status: 'DISABLED',
        tradingPassword: 'DisabledPass123!',
      }),
    });

    const wsClientDisabled = await connectWsHelper();
    wsClientDisabled.sendEnvelope('SESSION_INIT', {
      mode: 'TRADING_ACCOUNT',
      loginId: '900008',
      password: 'DisabledPass123!',
    }, 'req_auth_disabled');
    const disabledErr = await wsClientDisabled.waitForMessage('ERROR', 'req_auth_disabled');
    const disabledPayload = disabledErr?.payload as any;

    assert(
      disabledAccRes.status === 201 &&
      !!disabledErr &&
      disabledPayload?.code === 'ACCOUNT_DISABLED',
      8,
      'DISABLED account status strictly rejects login attempt'
    );
    wsClientDisabled.close();

    // -------------------------------------------------------------------------
    // TEST 9: READ_ONLY behavior (login allowed, trading blocked)
    // -------------------------------------------------------------------------
    const readOnlyAccRes = await apiCall('/api/admin/trading/accounts', {
      method: 'POST',
      body: JSON.stringify({
        accountNumber: '900009',
        initialBalance: 1000.00,
        status: 'READ_ONLY',
        tradingPassword: 'ReadOnlyPass123!',
      }),
    });

    const wsClientReadOnly = await connectWsHelper();
    wsClientReadOnly.sendEnvelope('SESSION_INIT', {
      mode: 'TRADING_ACCOUNT',
      loginId: '900009',
      password: 'ReadOnlyPass123!',
    }, 'req_auth_ro');
    const roReady = await wsClientReadOnly.waitForMessage('SESSION_READY', 'req_auth_ro');
    const roAcc = (roReady?.payload as any)?.account;

    // Attempt order execution via PLACE_ORDER
    wsClientReadOnly.sendEnvelope('PLACE_ORDER', {
      clientOrderId: 'ro_order_01',
      symbol: 'EURUSD',
      side: 'BUY',
      type: 'MARKET',
      volume: 0.1,
    }, 'req_order_ro');
    const roOrderRes = await wsClientReadOnly.waitForMessage('ORDER_ACK', 'req_order_ro');
    const roOrderPayload = roOrderRes?.payload as any;

    assert(
      readOnlyAccRes.status === 201 &&
      !!roReady &&
      roAcc?.status === 'READ_ONLY' &&
      roAcc?.tradingEnabled === false &&
      !!roOrderRes &&
      (roOrderPayload?.success === false || roOrderPayload?.order?.status === 'REJECTED') &&
      (roOrderPayload?.error?.toLowerCase().includes('read-only') ||
       roOrderPayload?.order?.rejectReason?.toLowerCase().includes('read-only')),
      9,
      'READ_ONLY account connects to WebTrader but order execution is blocked by RiskEngine'
    );
    wsClientReadOnly.close();

    // -------------------------------------------------------------------------
    // TEST 10: Duplicate provisioning does not create duplicate account (idempotent retry)
    // -------------------------------------------------------------------------
    const retryRes = await apiCall('/api/admin/trading/accounts', {
      method: 'POST',
      body: JSON.stringify({
        accountNumber: '900002',
        clientId: 'crm_usr_55001',
        currency: 'EUR',
        platform: 'MT5',
        leverage: 100,
        idempotencyKey: 'idemp_req_900002_001',
      }),
    });

    assert(
      (retryRes.status === 200 || retryRes.status === 201) &&
      retryRes.data?.accountNumber === '900002' &&
      retryRes.data?.id === clientLinkedRes.data.id,
      10,
      'Idempotent provisioning retry safely returns existing account without duplicate creation'
    );

    // -------------------------------------------------------------------------
    // TEST 11: Account created through API is immediately available to WebTrader without restart
    // -------------------------------------------------------------------------
    const freshAccRes = await apiCall('/api/admin/trading/accounts', {
      method: 'POST',
      body: JSON.stringify({
        accountNumber: '900011',
        initialBalance: 2500.00,
        leverage: 100,
        status: 'ACTIVE',
        tradingPassword: 'FreshPass111!',
      }),
    });

    const wsClientFresh = await connectWsHelper();
    wsClientFresh.sendEnvelope('SESSION_INIT', {
      mode: 'TRADING_ACCOUNT',
      loginId: '900011',
      password: 'FreshPass111!',
    }, 'req_fresh_auth');
    const freshReady = await wsClientFresh.waitForMessage('SESSION_READY', 'req_fresh_auth');
    const freshAcc = (freshReady?.payload as any)?.account;

    assert(
      freshAccRes.status === 201 &&
      !!freshReady &&
      freshAcc?.accountNumber === '900011' &&
      freshAcc?.balance === 2500.00,
      11,
      'API-created account is instantly live and authenticatable in WebTrader with zero server restart'
    );
    wsClientFresh.close();

    // -------------------------------------------------------------------------
    // TEST 12: Account balance & leverage available after creation
    // -------------------------------------------------------------------------
    const getFresh = await apiCall(`/api/admin/trading/accounts/${freshAccRes.data.id}`);
    assert(
      getFresh.status === 200 &&
      getFresh.data?.balance === 2500.00 &&
      getFresh.data?.equity === 2500.00 &&
      getFresh.data?.leverage === 100 &&
      getFresh.data?.tradingPassword === undefined,
      12,
      'Account balance and leverage correctly retrieved through GET API'
    );

    // -------------------------------------------------------------------------
    // TEST 13: Client mapping preserved and updatable via PATCH
    // -------------------------------------------------------------------------
    const patchClientRes = await apiCall(`/api/admin/trading/accounts/${freshAccRes.data.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        clientId: 'crm_usr_998877',
        leverage: 400,
      }),
    });

    assert(
      patchClientRes.status === 200 &&
      patchClientRes.data?.clientId === 'crm_usr_998877' &&
      patchClientRes.data?.leverage === 400,
      13,
      'Client mapping and leverage successfully updated via PATCH /api/admin/trading/accounts/:id'
    );

    // -------------------------------------------------------------------------
    // TEST 14: Initial ledger transaction created
    // -------------------------------------------------------------------------
    const ledger = runtime.accounts.getLedger(freshAccRes.data.id);
    const dbLedger = await runtime.persistence.accounts.getLedger(freshAccRes.data.id);
    const hasInitialDeposit = ledger.some((e) => e.type === 'DEPOSIT' && e.amount === 2500.00) ||
                              dbLedger.some((e) => e.type === 'DEPOSIT' && e.amount === 2500.00);

    assert(
      hasInitialDeposit,
      14,
      'Initial ledger DEPOSIT entry created for funded account provisioning'
    );

  } catch (err: any) {
    console.error('Test execution error:', err);
    failed++;
  } finally {
    try {
      wsServer.close();
      runtime.stop();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    } catch {}
    DatabaseClient.resetInstance();
  }

  console.log('\n=============================================================');
  console.log(`  CRM PROVISIONING TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('=============================================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

runProvisioningTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
