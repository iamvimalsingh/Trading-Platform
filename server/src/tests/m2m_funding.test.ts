/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * STEP 3 — M2M FUNDING CREDIT COMPREHENSIVE TEST SUITE
 * Validates:
 * A. Valid HMAC request -> accepted (200 OK)
 * B. Missing signature -> rejected (401)
 * C. Invalid signature -> rejected (401)
 * D. Wrong secret/signature -> rejected (401)
 * E. Missing timestamp -> rejected (401)
 * F. Expired timestamp -> rejected (401)
 * G. Future/unreasonable timestamp -> rejected (401)
 * H. Modified request body -> rejected (401)
 * I. Invalid amount (zero, negative, NaN) -> rejected (400)
 * J. Invalid/nonexistent account -> rejected (404)
 * K. Successful funding updates balance in memory & PostgreSQL
 * L. Successful funding creates double-entry ledger entry
 * M. Transaction survives / hydrates correctly across cold restart
 * N. Same transaction sent twice -> no double credit (idempotent duplicate response)
 * O. Same idempotency key sent twice -> no double credit
 * P. Concurrent duplicate requests -> no double credit (atomic race protection)
 * Q. Existing /api/admin/trading routes still work
 * R. Existing admin authentication behavior is unchanged
 */

import path from 'path';
import fs from 'fs';
import { createAppAndServer } from '../index';
import { DatabaseClient } from '../db/DatabaseClient';
import { M2MAuthService } from '../auth/M2MAuthService';
import { AdminAuthService } from '../auth/AdminAuthService';

let passCount = 0;
let failCount = 0;

function assert(condition: boolean, code: string, description: string, detail?: string) {
  if (condition) {
    console.log(`  \x1b[32m✔ PASS [${code}]\x1b[0m ${description}`);
    passCount++;
  } else {
    console.error(`  \x1b[31m✖ FAIL [${code}]\x1b[0m ${description}${detail ? ` — ${detail}` : ''}`);
    failCount++;
  }
}

async function runM2MFundingTests() {
  console.log('\n=============================================================');
  console.log('  RUNNING STEP 3 CRM -> TRADING ENGINE M2M FUNDING TEST SUITE');
  console.log('=============================================================\n');

  const testSecret = 'crm_m2m_test_secret_key_8374928174';
  const adminSecret = 'super_secret_admin_test_key_2026';
  process.env.CRM_M2M_SECRET = testSecret;
  process.env.ADMIN_API_SECRET = adminSecret;
  process.env.USE_REAL_MARKET_DATA = 'false';

  const testStorageDir = path.resolve(process.cwd(), 'data', `m2m_test_${Date.now()}`);
  process.env.DATABASE_STORAGE_PATH = testStorageDir;

  DatabaseClient.resetInstance();
  const db = DatabaseClient.getInstance(testStorageDir);

  const serverContext = createAppAndServer();
  let serverPort = 0;
  await new Promise<void>((resolve) => {
    serverContext.httpServer.listen(0, '127.0.0.1', () => {
      serverPort = (serverContext.httpServer.address() as any).port;
      resolve();
    });
  });

  await serverContext.runtime.persistence.init();
  const baseUrl = `http://127.0.0.1:${serverPort}`;

  // Seed a test account
  const testAccountId = 'acc_funding_test_1';
  const testTenantId = 'tenant_broker_alpha';
  await db.query(
    `INSERT INTO trading_accounts (
      id, tenant_id, client_id, account_number, platform, currency,
      account_type, session_mode, leverage, balance, equity, used_margin,
      free_margin, margin_level, margin_call_level, stop_out_level, status,
      created_at, updated_at
    ) VALUES 
      ($1, $2, 'cli_funding_1', 'FUND-100', 'MT5', 'USD', 'LIVE', 'EXTERNAL', 100, 1000.00, 1000.00, 0.00, 1000.00, 0.00, 100.00, 50.00, 'ACTIVE', $3, $3)
    ON CONFLICT (id) DO NOTHING;`,
    [testAccountId, testTenantId, Date.now()]
  );

  // Helper function to send signed M2M requests
  async function sendM2MRequest(
    body: any,
    options?: {
      timestamp?: string | number;
      signature?: string;
      secret?: string;
      rawBodyOverride?: string;
      endpoint?: string;
    }
  ) {
    const rawBody = options?.rawBodyOverride ?? JSON.stringify(body);
    const timestamp = options?.timestamp !== undefined ? String(options.timestamp) : String(Math.floor(Date.now() / 1000));
    const signingKey = options?.secret ?? testSecret;
    const signature = options?.signature !== undefined
      ? options.signature
      : M2MAuthService.computeSignature(timestamp, rawBody, signingKey);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (options?.timestamp !== null && timestamp !== 'OMIT') {
      headers['X-CRM-Timestamp'] = timestamp;
    }
    if (options?.signature !== null && signature !== 'OMIT') {
      headers['X-CRM-Signature'] = signature;
    }

    const endpoint = options?.endpoint || '/api/v1/admin/trading/funding/credit';
    const res = await fetch(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers,
      body: rawBody,
    });

    const json = await res.json().catch(() => ({}));
    return { status: res.status, body: json };
  }

  // --- SECTION 1: AUTHENTICATION & SIGNATURE SECURITY ---
  console.log('--- 1. M2M HMAC AUTHENTICATION & SECURITY VALIDATION ---');

  // A. Valid HMAC request -> accepted (200 OK)
  const reqA = {
    accountId: testAccountId,
    amount: 250.00,
    currency: 'USD',
    transactionId: 'tx_fund_valid_01',
    idempotencyKey: 'idem_fund_valid_01',
    note: 'Initial deposit from CRM wallet',
  };
  const resA = await sendM2MRequest(reqA);
  assert(resA.status === 200 && resA.body.success === true && resA.body.balanceAfter === 1250.00, 'M2M-A', 'Valid HMAC request accepted with 200 OK and updated balance');

  // B. Missing signature -> rejected (401)
  const resB = await sendM2MRequest(reqA, { signature: 'OMIT' });
  assert(resB.status === 401 && resB.body.code === 'MISSING_HEADERS', 'M2M-B', 'Missing X-CRM-Signature is rejected with 401');

  // C. Invalid signature -> rejected (401)
  const resC = await sendM2MRequest(reqA, { signature: 'invalid_base64_signature_bytes_1234' });
  assert(resC.status === 401 && resC.body.code === 'INVALID_SIGNATURE', 'M2M-C', 'Tampered/invalid signature is rejected with 401');

  // D. Wrong secret -> rejected (401)
  const resD = await sendM2MRequest(reqA, { secret: 'completely_wrong_secret_key_8829' });
  assert(resD.status === 401 && resD.body.code === 'INVALID_SIGNATURE', 'M2M-D', 'Signature created with wrong secret is rejected with 401');

  // E. Missing timestamp -> rejected (401)
  const resE = await sendM2MRequest(reqA, { timestamp: 'OMIT' });
  assert(resE.status === 401 && resE.body.code === 'MISSING_HEADERS', 'M2M-E', 'Missing X-CRM-Timestamp is rejected with 401');

  // F. Expired timestamp (10 minutes old) -> rejected (401)
  const expiredTimestamp = Math.floor((Date.now() - 600_000) / 1000);
  const resF = await sendM2MRequest(reqA, { timestamp: expiredTimestamp });
  assert(resF.status === 401 && resF.body.code === 'TIMESTAMP_EXPIRED', 'M2M-F', 'Stale/expired timestamp (>5min old) is rejected with 401');

  // G. Future timestamp (>2 minutes in future) -> rejected (401)
  const futureTimestamp = Math.floor((Date.now() + 150_000) / 1000);
  const resG = await sendM2MRequest(reqA, { timestamp: futureTimestamp });
  assert(resG.status === 401 && resG.body.code === 'FUTURE_TIMESTAMP', 'M2M-G', 'Future timestamp with clock skew > 60s is rejected with 401');

  // H. Modified request body (tamper attack) -> rejected (401)
  const validBodyStr = JSON.stringify(reqA);
  const tamperedBodyStr = JSON.stringify({ ...reqA, amount: 999999.00 });
  const correctSigForOriginal = M2MAuthService.computeSignature(Math.floor(Date.now() / 1000), validBodyStr, testSecret);
  const resH = await sendM2MRequest(null, {
    timestamp: Math.floor(Date.now() / 1000),
    signature: correctSigForOriginal,
    rawBodyOverride: tamperedBodyStr,
  });
  assert(resH.status === 401 && resH.body.code === 'INVALID_SIGNATURE', 'M2M-H', 'Tampered request body payload rejected with 401');

  // --- SECTION 2: INPUT VALIDATION & BUSINESS RULES ---
  console.log('\n--- 2. INPUT VALIDATION & BUSINESS RULES ---');

  // I1. Zero amount -> rejected (400)
  const resI1 = await sendM2MRequest({
    accountId: testAccountId,
    amount: 0.00,
    currency: 'USD',
    transactionId: 'tx_zero_amount',
    idempotencyKey: 'idem_zero_amount',
  });
  assert(resI1.status === 400 && resI1.body.code === 'INVALID_AMOUNT', 'M2M-I1', 'Zero amount rejected with 400');

  // I2. Negative amount -> rejected (400)
  const resI2 = await sendM2MRequest({
    accountId: testAccountId,
    amount: -100.00,
    currency: 'USD',
    transactionId: 'tx_neg_amount',
    idempotencyKey: 'idem_neg_amount',
  });
  assert(resI2.status === 400 && resI2.body.code === 'INVALID_AMOUNT', 'M2M-I2', 'Negative amount rejected with 400');

  // I3. Non-numeric amount -> rejected (400)
  const resI3 = await sendM2MRequest({
    accountId: testAccountId,
    amount: 'five_hundred' as any,
    currency: 'USD',
    transactionId: 'tx_invalid_amount_type',
    idempotencyKey: 'idem_invalid_amount_type',
  });
  assert(resI3.status === 400 && resI3.body.code === 'INVALID_AMOUNT', 'M2M-I3', 'Non-numeric amount rejected with 400');

  // J. Nonexistent account -> rejected (404)
  const resJ = await sendM2MRequest({
    accountId: 'acc_does_not_exist_9999',
    amount: 100.00,
    currency: 'USD',
    transactionId: 'tx_nonexistent_acc',
    idempotencyKey: 'idem_nonexistent_acc',
  });
  assert(resJ.status === 404 && resJ.body.code === 'ACCOUNT_NOT_FOUND', 'M2M-J', 'Nonexistent account returns 404 ACCOUNT_NOT_FOUND');

  // --- SECTION 3: BALANCE MUTATION & LEDGER PERSISTENCE ---
  console.log('\n--- 3. BALANCE MUTATION, LEDGER & DATABASE PERSISTENCE ---');

  // K. Successful funding updates balance in memory & PostgreSQL
  const reqK = {
    accountId: testAccountId,
    amount: 500.00,
    currency: 'USD',
    transactionId: 'tx_fund_k_500',
    idempotencyKey: 'idem_fund_k_500',
    note: 'Second credit test',
  };
  const resK = await sendM2MRequest(reqK);
  assert(
    resK.status === 200 && resK.body.balanceBefore === 1250.00 && resK.body.balanceAfter === 1750.00,
    'M2M-K01',
    'Funding response returns correct balanceBefore ($1250.00) and balanceAfter ($1750.00)'
  );

  const memAccount = serverContext.runtime.accounts.getAccount(testAccountId)!;
  assert(memAccount.balance === 1750.00, 'M2M-K02', 'In-memory AccountRegistry balance correctly updated to $1750.00');

  const dbAccount = await serverContext.runtime.persistence.accounts.getAccount(testAccountId);
  assert(dbAccount?.balance === 1750.00, 'M2M-K03', 'PostgreSQL database balance correctly updated to $1750.00');

  // L. Successful funding creates double-entry ledger entry
  const ledgerEntries = await serverContext.runtime.persistence.ledger.getLedgerForAccount(testAccountId);
  const matchingLedger = ledgerEntries.find((e) => e.referenceId === 'tx_fund_k_500');
  assert(
    !!matchingLedger && matchingLedger.amount === 500.00 && matchingLedger.balanceAfter === 1750.00 && matchingLedger.type === 'DEPOSIT',
    'M2M-L',
    'Immutable ledger entry created with type DEPOSIT, amount 500.00, and referenceId tx_fund_k_500'
  );

  // --- SECTION 4: IDEMPOTENCY & DUPLICATE PROTECTION ---
  console.log('\n--- 4. IDEMPOTENCY & DUPLICATE PROTECTION ---');

  // N. Same transaction sent twice sequentially -> no double credit
  const resN = await sendM2MRequest(reqK);
  assert(
    resN.status === 200 && resN.body.duplicate === true && resN.body.balanceAfter === 1750.00,
    'M2M-N01',
    'Duplicate transactionId returns 200 with duplicate=true and unchanged balance'
  );

  const memAccountAfterDup = serverContext.runtime.accounts.getAccount(testAccountId)!;
  assert(memAccountAfterDup.balance === 1750.00, 'M2M-N02', 'Account balance remains $1750.00 (zero double crediting)');

  // O. Same idempotency key sent twice with different transactionId -> recognized as duplicate
  const reqO = {
    ...reqK,
    transactionId: 'tx_different_id_same_idem',
    idempotencyKey: 'idem_fund_k_500', // same idempotency key as reqK
  };
  const resO = await sendM2MRequest(reqO);
  assert(
    resO.status === 200 && resO.body.duplicate === true && resO.body.balanceAfter === 1750.00,
    'M2M-O',
    'Duplicate idempotencyKey recognized and rejected without duplicate balance credit'
  );

  // P. Concurrent duplicate requests -> atomic protection (no double credit)
  console.log('\n--- 5. CONCURRENT DUPLICATE RACE PROTECTION ---');
  const concurrentTxId = 'tx_concurrent_funding_race';
  const concurrentIdemKey = 'idem_concurrent_funding_race';
  const concurrentReq = {
    accountId: testAccountId,
    amount: 300.00,
    currency: 'USD',
    transactionId: concurrentTxId,
    idempotencyKey: concurrentIdemKey,
    note: 'Concurrent funding race test',
  };

  const [raceRes1, raceRes2, raceRes3] = await Promise.all([
    sendM2MRequest(concurrentReq),
    sendM2MRequest(concurrentReq),
    sendM2MRequest(concurrentReq),
  ]);

  const successResults = [raceRes1, raceRes2, raceRes3].filter((r) => r.status === 200 && r.body.duplicate === false);
  const duplicateResults = [raceRes1, raceRes2, raceRes3].filter((r) => r.status === 200 && r.body.duplicate === true);

  assert(
    successResults.length === 1 && duplicateResults.length === 2,
    'M2M-P01',
    `Concurrent race protection: exactly 1 applied (${successResults.length}), 2 duplicates detected (${duplicateResults.length})`
  );

  const accountAfterRace = serverContext.runtime.accounts.getAccount(testAccountId)!;
  assert(
    accountAfterRace.balance === 2050.00, // 1750 + 300 = 2050
    'M2M-P02',
    `Account balance reflects exactly one credit: $2050.00 (Got: $${accountAfterRace.balance})`
  );

  // --- SECTION 6: COLD SERVER RESTART PERSISTENCE RECOVERY ---
  console.log('\n--- 6. COLD RESTART RECOVERY & HYDRATION ---');
  serverContext.wsServer.close();
  serverContext.runtime.stop();
  await serverContext.runtime.persistence.db.close();
  await new Promise<void>((r) => serverContext.httpServer.close(() => r()));
  DatabaseClient.resetInstance();
  await new Promise((r) => setTimeout(r, 500));

  // Boot up Server 2 with the same storage
  const serverContext2 = createAppAndServer();
  await serverContext2.runtime.persistence.init();

  const hydratedAccount = await serverContext2.runtime.persistence.hydrateAccountSession(testAccountId);
  assert(
    hydratedAccount?.account.balance === 2050.00,
    'M2M-M01',
    `Cold restart: Account balance ($2050.00) fully hydrated from PostgreSQL (Got: $${hydratedAccount?.account.balance})`
  );

  const txInDb2 = await serverContext2.runtime.persistence.funding.getFundingTransaction(concurrentTxId);
  assert(
    !!txInDb2 && txInDb2.amount === 300.00 && txInDb2.status === 'SUCCESS',
    'M2M-M02',
    'Cold restart: Funding transaction record preserved across server restart'
  );

  // --- SECTION 7: EXISTING ADMIN APIS UNBROKEN ---
  console.log('\n--- 7. REGRESSION CHECK: EXISTING ADMIN APIS & AUTH ---');

  let server2Port = 0;
  await new Promise<void>((resolve) => {
    serverContext2.httpServer.listen(0, '127.0.0.1', () => {
      server2Port = (serverContext2.httpServer.address() as any).port;
      resolve();
    });
  });
  const baseUrl2 = `http://127.0.0.1:${server2Port}`;

  // Q1. Unauthenticated request to /api/admin/trading/accounts/:id returns 401
  const unauthAdminRes = await fetch(`${baseUrl2}/api/admin/trading/accounts/${testAccountId}`);
  assert(unauthAdminRes.status === 401, 'M2M-Q01', 'Existing /api/admin/trading/accounts/:id rejects unauthenticated request with 401');

  // Q2. Authenticated request with X-Admin-Key to /api/admin/trading/accounts/:id succeeds
  const authAdminRes = await fetch(`${baseUrl2}/api/admin/trading/accounts/${testAccountId}`, {
    headers: {
      'X-Admin-Key': adminSecret,
      'X-Tenant-Id': testTenantId,
    },
  });
  assert(authAdminRes.status === 200, 'M2M-Q02', 'Existing /api/admin/trading/accounts/:id accepts X-Admin-Key with 200 OK');

  // Q3. Authenticated request to /api/admin/trading/symbols succeeds
  const symbolsRes = await fetch(`${baseUrl2}/api/admin/trading/symbols`, {
    headers: {
      'X-Admin-Key': adminSecret,
      'X-Tenant-Id': testTenantId,
    },
  });
  assert(symbolsRes.status === 200, 'M2M-Q03', 'Existing /api/admin/trading/symbols accepts X-Admin-Key with 200 OK');

  // Cleanup
  serverContext2.wsServer.close();
  serverContext2.runtime.stop();
  await serverContext2.runtime.persistence.db.close();
  await new Promise<void>((r) => serverContext2.httpServer.close(() => r()));

  console.log('\n=============================================================');
  console.log(`  M2M FUNDING TESTS: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('=============================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

runM2MFundingTests().catch((err) => {
  console.error('Fatal M2M Funding test error:', err);
  process.exit(1);
});
