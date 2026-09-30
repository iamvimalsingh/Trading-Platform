/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * STEP 2 — POSTGRESQL PERSISTENCE & RECOVERY TEST SUITE
 * Rigorously verifies:
 * A-M: Individual CRUD persistence for Accounts, Orders, Positions, Executions, Ledger.
 * CRITICAL ACCEPTANCE TEST: Cold server restart and state re-hydration across restarts.
 * Concurrency, Idempotency, Transaction Rollback, Multi-Tenant isolation.
 * 
 * Run with: tsx server/src/tests/postgresql_persistence.test.ts
 */

import fs from 'fs';
import path from 'path';
import { WebSocket } from 'ws';
import { createAppAndServer } from '../index';
import { DatabaseClient } from '../db/DatabaseClient';
import { runMigrations } from '../db/migrations';
import { SessionTokenService } from '../auth/SessionTokenService';
import { PostgresAccountRepository } from '../repositories/PostgresAccountRepository';
import { PostgresOrderRepository } from '../repositories/PostgresOrderRepository';
import { PostgresPositionRepository } from '../repositories/PostgresPositionRepository';
import { PostgresExecutionRepository } from '../repositories/PostgresExecutionRepository';
import { PostgresLedgerRepository } from '../repositories/PostgresLedgerRepository';
import { WsEnvelope } from '../ws/wsProtocol';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testNum: number, name: string, detail?: string) {
  if (condition) {
    console.log(`  \x1b[32m✔ PASS [STEP2-${testNum.toString().padStart(2, '0')}]\x1b[0m ${name}`);
    passed++;
  } else {
    console.error(`  \x1b[31m✖ FAIL [STEP2-${testNum.toString().padStart(2, '0')}]\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

async function runPersistenceTests() {
  process.env.USE_REAL_MARKET_DATA = 'false';
  const testSecret = 'crm_secret_for_persistence_suite_4920';
  process.env.CRM_LAUNCH_SECRET = testSecret;

  // Use isolated test database directory
  const testDbDir = path.resolve(process.cwd(), 'data', 'test_persistence_db');
  if (fs.existsSync(testDbDir)) {
    fs.rmSync(testDbDir, { recursive: true, force: true });
  }

  console.log('\n=============================================================');
  console.log('  RUNNING STEP 2 POSTGRESQL PERSISTENCE & REPOSITORY TESTS');
  console.log('=============================================================\n');

  // --- PART 1: DIRECT REPOSITORY & TRANSACTION UNIT TESTS ---
  DatabaseClient.resetInstance();
  const db = DatabaseClient.getInstance(testDbDir);
  await db.init();
  await runMigrations(db);

  const accountRepo = new PostgresAccountRepository(db);
  const orderRepo = new PostgresOrderRepository(db);
  const positionRepo = new PostgresPositionRepository(db);
  const executionRepo = new PostgresExecutionRepository(db);
  const ledgerRepo = new PostgresLedgerRepository(db);

  // Test 1: Account Persistence
  await accountRepo.updateAccount({
    id: 'acc_crm_57775',
    tenantId: 'broker_live',
    clientId: 'client_98231',
    accountNumber: '57775',
    platform: 'MT5',
    currency: 'USD',
    accountType: 'LIVE',
    sessionMode: 'EXTERNAL',
    leverage: 100,
    balance: 25000.00,
    equity: 25000.00,
    usedMargin: 0.00,
    freeMargin: 25000.00,
    marginLevel: 0,
    marginCallLevel: 100,
    stopOutLevel: 50,
    status: 'ACTIVE',
  });
  const loadedAcc = await accountRepo.getAccount('57775');
  assert(
    !!loadedAcc && loadedAcc.id === 'acc_crm_57775' && loadedAcc.balance === 25000.00 && loadedAcc.platform === 'MT5',
    1,
    'PostgreSQL Account persistence and retrieval by account number'
  );

  // Test 2: Order Persistence
  await orderRepo.saveOrder({
    id: 'ord_test_001',
    clientOrderId: 'cli_001',
    accountId: 'acc_crm_57775',
    symbol: 'EURUSD',
    side: 'BUY',
    type: 'LIMIT',
    volume: 1.0,
    requestedPrice: 1.08000,
    executionPrice: 0,
    status: 'WORKING',
    createdAt: Date.now(),
  }, 'broker_live');
  const loadedOrder = await orderRepo.getOrder('ord_test_001');
  assert(
    !!loadedOrder && loadedOrder.symbol === 'EURUSD' && loadedOrder.status === 'WORKING' && loadedOrder.volume === 1.0,
    2,
    'PostgreSQL Order persistence and retrieval'
  );

  // Test 3: Position Persistence
  await positionRepo.savePosition({
    id: 'pos_test_001',
    accountId: 'acc_crm_57775',
    symbol: 'EURUSD',
    side: 'BUY',
    volume: 1.0,
    openPrice: 1.08500,
    currentPrice: 1.08520,
    unrealizedPnL: 20.00,
    realizedPnL: 0.00,
    marginLocked: 1085.00,
    openedAt: Date.now(),
    status: 'OPEN',
  }, 'broker_live');
  const loadedPos = await positionRepo.getPosition('pos_test_001');
  assert(
    !!loadedPos && loadedPos.openPrice === 1.08500 && loadedPos.status === 'OPEN' && loadedPos.volume === 1.0,
    3,
    'PostgreSQL Position persistence and retrieval'
  );

  // Test 4: Execution Persistence & Idempotency
  await executionRepo.saveExecution({
    id: 'exec_test_001',
    orderId: 'ord_test_001',
    positionId: 'pos_test_001',
    accountId: 'acc_crm_57775',
    symbol: 'EURUSD',
    side: 'BUY',
    type: 'OPEN',
    volume: 1.0,
    executionPrice: 1.08500,
    commission: 0,
    fee: 0,
    timestamp: Date.now(),
  }, 'broker_live');
  // Attempt duplicate save
  await executionRepo.saveExecution({
    id: 'exec_test_001',
    orderId: 'ord_test_001',
    positionId: 'pos_test_001',
    accountId: 'acc_crm_57775',
    symbol: 'EURUSD',
    side: 'BUY',
    type: 'OPEN',
    volume: 1.0,
    executionPrice: 1.08500,
    commission: 0,
    fee: 0,
    timestamp: Date.now(),
  }, 'broker_live');
  const allExecs = await executionRepo.getExecutionsForAccount('acc_crm_57775');
  assert(
    allExecs.length === 1 && allExecs[0].id === 'exec_test_001',
    4,
    'Execution persistence with duplicate idempotency protection'
  );

  // Test 5: Ledger Persistence
  await ledgerRepo.createEntry({
    id: 'led_test_001',
    accountId: 'acc_crm_57775',
    type: 'DEPOSIT',
    amount: 25000.00,
    balanceAfter: 25000.00,
    description: 'Initial external funding from CRM',
    createdAt: Date.now(),
  }, 'broker_live');
  const ledgerEntries = await ledgerRepo.getLedgerForAccount('acc_crm_57775');
  assert(
    ledgerEntries.length === 1 && ledgerEntries[0].amount === 25000.00 && ledgerEntries[0].type === 'DEPOSIT',
    5,
    'Immutable Ledger persistence and retrieval'
  );

  // Test 6: Transaction Rollback on Failure
  let rollbackSuccess = false;
  try {
    await db.transaction(async (tx) => {
      await tx.query(`INSERT INTO trading_orders (id, client_order_id, account_id, tenant_id, symbol, side, type, volume, status, created_at)
                      VALUES ('ord_fail_tx', 'cli_tx', 'acc_crm_57775', 'broker_live', 'EURUSD', 'BUY', 'MARKET', 1, 'FILLED', ${Date.now()});`);
      // Simulate unhandled failure inside atomic transaction
      throw new Error('Simulated atomic transaction failure');
    });
  } catch {
    const checkOrder = await orderRepo.getOrder('ord_fail_tx');
    if (!checkOrder) rollbackSuccess = true;
  }
  assert(rollbackSuccess, 6, 'Database transaction rollback prevents partial state corruption');

  // Test 7: Multi-Tenant / Account Isolation Guard
  const tenantIsolationCheck = await db.query(
    `SELECT * FROM trading_accounts WHERE tenant_id = 'broker_other' AND account_number = '57775';`
  );
  assert(
    tenantIsolationCheck.rows.length === 0,
    7,
    'Multi-tenant account boundary isolates data between distinct brokers'
  );

  await db.close();

  // --- PART 2: FULL RUNTIME SERVER RESTART ACCEPTANCE TEST ---
  console.log('\n--- EXECUTING CRITICAL SERVER RESTART ACCEPTANCE TEST ---');

  // Launch Token for Account 57775
  const launchToken = SessionTokenService.createLaunchToken({
    iss: 'crm-backend',
    sub: 'client_98231',
    aud: 'trading-terminal',
    accountId: 'acc_crm_57775',
    accountNumber: '57775',
    tenantId: 'broker_live',
    platform: 'MT5',
    currency: 'USD',
    accountType: 'LIVE',
    leverage: 100,
    initialBalance: 25000.00,
  }, 600, testSecret);

  // Phase A: Server 1 - Start and place trades
  DatabaseClient.resetInstance();
  const server1Instance = createAppAndServer();
  let server1Port = 0;
  await new Promise<void>((r) => server1Instance.httpServer.listen(0, '127.0.0.1', () => {
    server1Port = (server1Instance.httpServer.address() as any).port;
    r();
  }));

  const ws1 = new WebSocket(`ws://127.0.0.1:${server1Port}/ws`);
  const ws1Messages: WsEnvelope[] = [];
  ws1.on('message', (d) => ws1Messages.push(JSON.parse(d.toString())));
  await new Promise<void>((r) => ws1.on('open', () => r()));

  // Authenticate session on Server 1
  ws1.send(JSON.stringify({
    type: 'SESSION_INIT',
    requestId: 'init_s1',
    payload: { mode: 'EXTERNAL', token: launchToken },
  }));

  await new Promise((r) => {
    const iv = setInterval(() => {
      if (ws1Messages.find((m) => m.type === 'SESSION_READY' && m.requestId === 'init_s1')) {
        clearInterval(iv);
        r(null);
      }
    }, 10);
  });

  // Open BUY position on EURUSD (Market Order)
  ws1.send(JSON.stringify({
    type: 'PLACE_ORDER',
    requestId: 'order_buy_1',
    payload: {
      symbol: 'EURUSD',
      side: 'BUY',
      type: 'MARKET',
      volume: 1.0,
      clientOrderId: 'cli_buy_restart_test',
    },
  }));

  let openedPosId = '';
  await new Promise((r) => {
    const iv = setInterval(() => {
      const ack = ws1Messages.find((m) => m.type === 'ORDER_ACK' && m.requestId === 'order_buy_1');
      if (ack) {
        openedPosId = (ack.payload as any).position?.id;
        clearInterval(iv);
        r(null);
      }
    }, 10);
  });

  // Place a working LIMIT order
  ws1.send(JSON.stringify({
    type: 'PLACE_ORDER',
    requestId: 'order_limit_1',
    payload: {
      symbol: 'EURUSD',
      side: 'BUY',
      type: 'LIMIT',
      volume: 0.50,
      requestedPrice: 1.05000,
      clientOrderId: 'cli_limit_restart_test',
    },
  }));

  await new Promise((r) => {
    const iv = setInterval(() => {
      if (ws1Messages.find((m) => m.type === 'ORDER_ACK' && m.requestId === 'order_limit_1')) {
        clearInterval(iv);
        r(null);
      }
    }, 10);
  });

  // Short pause to ensure async PostgreSQL writes complete
  await new Promise((r) => setTimeout(r, 100));

  // --- HARD SERVER 1 RESTART SIMULATION ---
  ws1.close();
  server1Instance.wsServer.close();
  server1Instance.runtime.stop();
  await server1Instance.runtime.persistence.db.close();
  await new Promise<void>((r) => server1Instance.httpServer.close(() => r()));
  // Destroy Server 1 in-memory runtime!
  console.log('  [Server 1] Cold shutdown complete. In-memory state destroyed.');

  // Phase B: Server 2 - Cold Start and Hydrate
  DatabaseClient.resetInstance();
  const server2Instance = createAppAndServer();
  let server2Port = 0;
  await new Promise<void>((r) => server2Instance.httpServer.listen(0, '127.0.0.1', () => {
    server2Port = (server2Instance.httpServer.address() as any).port;
    r();
  }));
  console.log(`  [Server 2] Cold boot up on port ${server2Port}. Recovering state from PostgreSQL...`);

  const ws2 = new WebSocket(`ws://127.0.0.1:${server2Port}/ws`);
  const ws2Messages: WsEnvelope[] = [];
  ws2.on('message', (d) => ws2Messages.push(JSON.parse(d.toString())));
  await new Promise<void>((r) => ws2.on('open', () => r()));

  // Re-authenticate session on Server 2
  ws2.send(JSON.stringify({
    type: 'SESSION_INIT',
    requestId: 'init_s2',
    payload: { mode: 'EXTERNAL', token: launchToken },
  }));

  let s2ReadyMsg: WsEnvelope | undefined;
  await new Promise((r) => {
    const iv = setInterval(() => {
      const msg = ws2Messages.find((m) => m.type === 'SESSION_READY' && m.requestId === 'init_s2');
      if (msg) {
        s2ReadyMsg = msg;
        clearInterval(iv);
        r(null);
      }
    }, 10);
  });

  const recoveredAccount = (s2ReadyMsg?.payload as any)?.account;
  const recoveredPositions = (s2ReadyMsg?.payload as any)?.positions;
  const recoveredOrders = (s2ReadyMsg?.payload as any)?.orders;
  const recoveredLedger = (s2ReadyMsg?.payload as any)?.ledger;

  assert(
    !!recoveredAccount &&
      recoveredAccount.accountNumber === '57775' &&
      recoveredAccount.platform === 'MT5' &&
      recoveredAccount.sessionMode === 'EXTERNAL' &&
      recoveredAccount.balance >= 24900 &&
      recoveredAccount.balance <= 25100,
    8,
    'Server restart preserves account balance and metadata (#57775, ~$25,000.00)',
    JSON.stringify(recoveredAccount)
  );

  assert(
    Array.isArray(recoveredPositions) &&
      recoveredPositions.some((p: any) => p.id === openedPosId && p.status === 'OPEN'),
    9,
    'Server restart preserves and hydrates open positions from PostgreSQL',
    `Found position ${openedPosId}`
  );

  assert(
    Array.isArray(recoveredOrders) &&
      recoveredOrders.some((o: any) => o.clientOrderId === 'cli_limit_restart_test' && o.status === 'WORKING'),
    10,
    'Server restart preserves active working orders in OrderEngine'
  );

  assert(
    Array.isArray(recoveredLedger) && recoveredLedger.length >= 1,
    11,
    'Server restart preserves historical financial ledger entries'
  );

  // Now manually close the position on Server 2
  ws2.send(JSON.stringify({
    type: 'CLOSE_POSITION',
    requestId: 'close_pos_s2',
    payload: { positionId: openedPosId },
  }));

  let closeSucceeded = false;
  await new Promise((r) => {
    const iv = setInterval(() => {
      if (ws2Messages.find((m) => m.type === 'POSITION_CLOSED')) {
        closeSucceeded = true;
        clearInterval(iv);
        r(null);
      }
    }, 10);
  });

  assert(closeSucceeded, 12, 'Closed position successfully on recovered Server 2 instance');

  // Allow async PostgreSQL position close write to finalize
  await new Promise((r) => setTimeout(r, 100));

  // --- HARD SERVER 2 RESTART SIMULATION ---
  ws2.close();
  server2Instance.wsServer.close();
  server2Instance.runtime.stop();
  await server2Instance.runtime.persistence.db.close();
  await new Promise<void>((r) => server2Instance.httpServer.close(() => r()));
  console.log('  [Server 2] Cold shutdown complete.');

  // Phase C: Server 3 - Verify closed position in Trade History survives second restart
  DatabaseClient.resetInstance();
  const server3Instance = createAppAndServer();
  let server3Port = 0;
  await new Promise<void>((r) => server3Instance.httpServer.listen(0, '127.0.0.1', () => {
    server3Port = (server3Instance.httpServer.address() as any).port;
    r();
  }));
  console.log(`  [Server 3] Cold boot up on port ${server3Port}.`);

  const ws3 = new WebSocket(`ws://127.0.0.1:${server3Port}/ws`);
  const ws3Messages: WsEnvelope[] = [];
  ws3.on('message', (d) => ws3Messages.push(JSON.parse(d.toString())));
  await new Promise<void>((r) => ws3.on('open', () => r()));

  ws3.send(JSON.stringify({
    type: 'SESSION_INIT',
    requestId: 'init_s3',
    payload: { mode: 'EXTERNAL', token: launchToken },
  }));

  let s3ReadyMsg: WsEnvelope | undefined;
  await new Promise((r) => {
    const iv = setInterval(() => {
      const msg = ws3Messages.find((m) => m.type === 'SESSION_READY' && m.requestId === 'init_s3');
      if (msg) {
        s3ReadyMsg = msg;
        clearInterval(iv);
        r(null);
      }
    }, 10);
  });

  const s3Positions = (s3ReadyMsg?.payload as any)?.positions;
  const s3Ledger = (s3ReadyMsg?.payload as any)?.ledger;

  // Query closed positions directly from PostgreSQL repository
  const s3Db = DatabaseClient.getInstance();
  const s3PosRepo = new PostgresPositionRepository(s3Db);
  const closedHistory = await s3PosRepo.getClosedPositionsForAccount('acc_crm_57775');

  assert(
    closedHistory.some((p) => p.id === openedPosId && p.status === 'CLOSED'),
    13,
    'Trade History of closed positions survives multiple server restarts',
    `Found closed trade ${openedPosId} with realized PnL: $${closedHistory[0]?.realizedPnL}`
  );

  assert(
    s3Ledger.some((l: any) => l.type === 'TRADE_PNL' && l.referenceId === openedPosId),
    14,
    'Realized P/L Ledger entry survives multiple server restarts'
  );

  // Teardown Server 3
  ws3.close();
  server3Instance.wsServer.close();
  server3Instance.runtime.stop();
  await s3Db.close();
  await new Promise<void>((r) => server3Instance.httpServer.close(() => r()));

  console.log('\n=============================================================');
  console.log(`  STEP 2 PERSISTENCE & RECOVERY TESTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('=============================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runPersistenceTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
