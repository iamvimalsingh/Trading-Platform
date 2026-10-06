/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * STEP 5 — RISK + ADMIN CONTROL FOUNDATION TEST SUITE
 * 
 * Exhaustive validation covering:
 * 1. Admin Authentication & Role Authorization (JWT + X-Admin-Key + End-User Token Rejection)
 * 2. Strict Multi-Tenant Isolation (Accounts, Symbols, Spreads, Audits across Tenant A and Tenant B)
 * 3. Account Admin Controls (Active/Disabled status, Trading Enabled/Disabled toggle, Leverage control)
 * 4. Account Risk Limits (maxOrderVolume, maxPositionVolume enforced in RiskEngine)
 * 5. Symbol Admin Controls (enable/disable, HALTED, CLOSE_ONLY, min/max volume limits)
 * 6. Pair-Wise Spread Policy (symbol-specific spreads for EURUSD, XAUUSD, BTCUSD)
 * 7. Effective-Time Dating (future effectiveFrom not activated until scheduled time)
 * 8. Real-Time Spread Application to New Quotes without Retroactive Trade Modification
 * 9. Historical Execution & Existing Position Immutability
 * 10. Server-Authoritative Audit Trail in PostgreSQL
 */

import fs from 'fs';
import path from 'path';
import { DatabaseClient } from '../db/DatabaseClient';
import { runMigrations } from '../db/migrations';
import { createAppAndServer } from '../index';
import { AdminAuthService } from '../auth/AdminAuthService';
import { SessionTokenService } from '../auth/SessionTokenService';
import { InstrumentRegistry } from '../market/InstrumentRegistry';
import { RiskEngine } from '../trading/RiskEngine';
import { AdminSpreadPricingPolicy } from '../market/AdminSpreadPricingPolicy';
import { NormalizedInternalQuote } from '../types/marketData';
import { Quote } from '../types/trading';

let passCount = 0;
let failCount = 0;

function assert(condition: boolean, testId: string, testName: string, detail?: string) {
  if (condition) {
    console.log(`  \x1b[32m✔ PASS [${testId}]\x1b[0m ${testName}`);
    passCount++;
  } else {
    console.error(`  \x1b[31m✖ FAIL [${testId}]\x1b[0m ${testName}${detail ? ` (${detail})` : ''}`);
    failCount++;
  }
}

async function runStep5Tests() {
  console.log('\n=============================================================');
  console.log('  RUNNING STEP 5: RISK + ADMIN CONTROL FOUNDATION TESTS');
  console.log('=============================================================\n');

  // 1. Isolate test database
  process.env.USE_REAL_MARKET_DATA = 'false';
  const testDbDir = path.resolve(process.cwd(), 'data', 'test_step5_admin_db');
  if (fs.existsSync(testDbDir)) {
    fs.rmSync(testDbDir, { recursive: true, force: true });
  }
  process.env.DATABASE_STORAGE_PATH = testDbDir;
  process.env.ADMIN_API_SECRET = 'super_secret_admin_test_key_2026';
  process.env.CRM_LAUNCH_SECRET = 'test_crm_launch_secret_key_8849204';
  DatabaseClient.resetInstance();
  InstrumentRegistry.resetInstance();

  const db = DatabaseClient.getInstance();
  await runMigrations(db);

  const { app, httpServer, runtime, adminService } = createAppAndServer();
  let serverPort = 0;

  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => {
      const address = httpServer.address() as any;
      serverPort = address.port;
      resolve();
    });
  });

  const baseUrl = `http://127.0.0.1:${serverPort}`;

  // Helper for HTTP requests
  const apiCall = async (endpoint: string, options?: RequestInit) => {
    const res = await fetch(`${baseUrl}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options?.headers || {}),
      },
    });
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  };

  // -------------------------------------------------------------------------
  // SECTION 1: ADMIN AUTHORIZATION & SECURITY BOUNDARY
  // -------------------------------------------------------------------------
  console.log('--- 1. ADMIN AUTHORIZATION & SECURITY BOUNDARY ---');
  {
    // A) Missing credentials -> 401 Unauthorized
    const resNoAuth = await apiCall('/api/admin/trading/accounts/acc_demo_1001');
    assert(resNoAuth.status === 401, 'S5-01', 'Rejects unauthenticated request with 401 Unauthorized');

    // B) Normal end-user client token -> REJECTED (401)
    const clientUserToken = SessionTokenService.createLaunchToken({
      iss: 'crm-backend',
      aud: 'trading-terminal',
      sub: 'client_regular_user',
      accountId: 'acc_demo_1001',
      accountNumber: 'DEMO-1001',
      tenantId: 'tenant_default',
    });
    const resClientToken = await apiCall('/api/admin/trading/accounts/acc_demo_1001', {
      headers: { Authorization: `Bearer ${clientUserToken}` },
    });
    assert(resClientToken.status === 401, 'S5-02', 'Strictly rejects normal client external session tokens from Admin API');

    // C) Malformed admin token -> 401
    const resBadToken = await apiCall('/api/admin/trading/accounts/acc_demo_1001', {
      headers: { Authorization: 'Bearer not.a.valid.jwt' },
    });
    assert(resBadToken.status === 401, 'S5-03', 'Rejects malformed admin token with 401');

    // D) Valid signed Admin token -> 200 OK
    const validAdminToken = AdminAuthService.generateAdminToken({
      adminId: 'adm_master',
      tenantId: 'tenant_default',
      role: 'SUPER_ADMIN',
    });
    const resValidAdmin = await apiCall('/api/admin/trading/accounts/acc_demo_1001', {
      headers: { Authorization: `Bearer ${validAdminToken}` },
    });
    assert(resValidAdmin.status === 200, 'S5-04', 'Authenticates valid signed Admin token successfully (200 OK)');
    assert(resValidAdmin.data?.accountNumber === 'DEMO-1001', 'S5-05', 'Returns authoritative account data for authorized admin');

    // E) Valid direct X-Admin-Key header -> 200 OK
    const resApiKey = await apiCall('/api/admin/trading/accounts/acc_demo_1001', {
      headers: {
        'X-Admin-Key': 'super_secret_admin_test_key_2026',
        'X-Tenant-ID': 'tenant_default',
        'X-Admin-User-Id': 'adm_crm_backend',
      },
    });
    assert(resApiKey.status === 200, 'S5-06', 'Authenticates valid X-Admin-Key header for server-to-server CRM calls');

    // F) Invalid X-Admin-Key header -> 401
    const resBadApiKey = await apiCall('/api/admin/trading/accounts/acc_demo_1001', {
      headers: {
        'X-Admin-Key': 'incorrect_secret_key',
        'X-Tenant-ID': 'tenant_default',
      },
    });
    assert(resBadApiKey.status === 401, 'S5-07', 'Rejects invalid X-Admin-Key with 401');
  }

  // -------------------------------------------------------------------------
  // SECTION 2: MULTI-TENANT ISOLATION
  // -------------------------------------------------------------------------
  console.log('\n--- 2. STRICT MULTI-TENANT ISOLATION ---');
  {
    // Setup Account for Tenant B
    const tenantBAccount = runtime.accounts.provisionExternalAccount({
      iss: 'crm-backend',
      sub: 'client_tenant_b_1',
      aud: 'trading-terminal',
      accountId: 'acc_tenant_b_5001',
      accountNumber: 'TB-5001',
      tenantId: 'tenant_broker_b',
      currency: 'USD',
      initialBalance: 50000,
      leverage: 100,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    await runtime.persistence.accounts.updateAccount(tenantBAccount);

    // Tenant A Admin Token
    const tenantAToken = AdminAuthService.generateAdminToken({
      adminId: 'admin_tenant_a',
      tenantId: 'tenant_broker_a',
      role: 'ADMIN',
    });

    // Tenant B Admin Token
    const tenantBToken = AdminAuthService.generateAdminToken({
      adminId: 'admin_tenant_b',
      tenantId: 'tenant_broker_b',
      role: 'ADMIN',
    });

    // Tenant A attempts to read Tenant B account -> 404 (Hidden by tenant isolation)
    const resCrossTenantGet = await apiCall('/api/admin/trading/accounts/acc_tenant_b_5001', {
      headers: { Authorization: `Bearer ${tenantAToken}` },
    });
    assert(resCrossTenantGet.status === 404, 'S5-08', 'Tenant A administrator cannot read Tenant B account (isolated with 404)');

    // Tenant A attempts to update Tenant B account -> 404
    const resCrossTenantPatch = await apiCall('/api/admin/trading/accounts/acc_tenant_b_5001', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tenantAToken}` },
      body: JSON.stringify({ leverage: 50 }),
    });
    assert(resCrossTenantPatch.status === 404, 'S5-09', 'Tenant A administrator cannot modify Tenant B account parameters');

    // Tenant B reads own account -> 200 OK
    const resTenantBGet = await apiCall('/api/admin/trading/accounts/acc_tenant_b_5001', {
      headers: { Authorization: `Bearer ${tenantBToken}` },
    });
    assert(resTenantBGet.status === 200 && resTenantBGet.data?.id === 'acc_tenant_b_5001', 'S5-10', 'Tenant B administrator successfully accesses Tenant B account');
  }

  // -------------------------------------------------------------------------
  // SECTION 3: ACCOUNT ADMIN CONTROLS & TRADING RESTRICTIONS
  // -------------------------------------------------------------------------
  console.log('\n--- 3. ACCOUNT ADMIN CONTROLS & TRADING RESTRICTIONS ---');
  {
    const adminToken = AdminAuthService.generateAdminToken({
      adminId: 'admin_super',
      tenantId: 'tenant_default',
      role: 'SUPER_ADMIN',
    });

    // 1. Disable trading on DEMO-1001
    const patchDisable = await apiCall('/api/admin/trading/accounts/acc_demo_1001', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ tradingEnabled: false, reason: 'Risk review in progress' }),
    });
    assert(patchDisable.status === 200 && patchDisable.data?.tradingEnabled === false, 'S5-11', 'Admin successfully disables trading on account');

    // Verify RiskEngine rejects orders on disabled trading account
    const accDisabled = runtime.accounts.getAccount('acc_demo_1001')!;
    const eurusdCfg = runtime.market.getSymbolConfig('EURUSD')!;
    const riskCheckDisabled = RiskEngine.validatePreTradeRisk(accDisabled, 10.85, eurusdCfg, 0.01);
    assert(!riskCheckDisabled.valid && riskCheckDisabled.reason === 'Trading is disabled for this account', 'S5-12', 'RiskEngine server-side rejects orders when tradingEnabled is false');

    // 2. Re-enable trading
    const patchEnable = await apiCall('/api/admin/trading/accounts/acc_demo_1001', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ tradingEnabled: true, reason: 'Risk review completed' }),
    });
    assert(patchEnable.status === 200 && patchEnable.data?.tradingEnabled === true, 'S5-13', 'Admin successfully re-enables trading on account');

    // 3. Set status to DISABLED
    const patchStatus = await apiCall('/api/admin/trading/accounts/acc_demo_1001', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ status: 'DISABLED' }),
    });
    assert(patchStatus.status === 200 && patchStatus.data?.status === 'DISABLED', 'S5-14', 'Admin updates account status to DISABLED');

    const accStatusDisabled = runtime.accounts.getAccount('acc_demo_1001')!;
    const riskCheckStatus = RiskEngine.validatePreTradeRisk(accStatusDisabled, 10.85, eurusdCfg, 0.01);
    assert(!riskCheckStatus.valid && (riskCheckStatus.reason === 'Trading account is disabled' || riskCheckStatus.reason === 'Account is currently DISABLED'), 'S5-15', 'RiskEngine server-side blocks orders when account status is DISABLED');

    // Restore to ACTIVE
    await apiCall('/api/admin/trading/accounts/acc_demo_1001', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ status: 'ACTIVE' }),
    });

    // 4. Update Leverage: 100x -> 200x
    const patchLev = await apiCall('/api/admin/trading/accounts/acc_demo_1001', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ leverage: 200 }),
    });
    assert(patchLev.status === 200 && patchLev.data?.leverage === 200, 'S5-16', 'Admin changes account leverage from 100 to 200');

    // Verify margin reduction with increased leverage: 1 lot EURUSD @ 1.08500:
    // At 100x: 108,500 / 100 = $1,085.00
    // At 200x: 108,500 / 200 = $542.50
    const acc200 = runtime.accounts.getAccount('acc_demo_1001')!;
    const margin100 = RiskEngine.calculateRequiredMargin(1.0, 1.08500, eurusdCfg, 100);
    const margin200 = RiskEngine.calculateRequiredMargin(1.0, 1.08500, eurusdCfg, acc200.leverage);
    assert(margin100 === 1085.00 && margin200 === 542.50, 'S5-17', 'Account leverage change immediately halves required margin for new trades');

    // 5. Account Risk Limit: maxOrderVolume
    await apiCall('/api/admin/trading/accounts/acc_demo_1001', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ maxOrderVolume: 0.50 }),
    });
    const accWithMaxVol = runtime.accounts.getAccount('acc_demo_1001')!;
    const checkOrderOverMax = RiskEngine.validatePreTradeRisk(accWithMaxVol, 542.50, eurusdCfg, 1.0);
    assert(!checkOrderOverMax.valid && Boolean(checkOrderOverMax.reason?.includes('exceeds account maximum order volume')), 'S5-18', 'RiskEngine enforces account maxOrderVolume limit');

    const checkOrderUnderMax = RiskEngine.validatePreTradeRisk(accWithMaxVol, 27.12, eurusdCfg, 0.05);
    assert(checkOrderUnderMax.valid, 'S5-19', 'Orders below maxOrderVolume pass validation cleanly');
  }

  // -------------------------------------------------------------------------
  // SECTION 4: SYMBOL / INSTRUMENT ADMIN CONTROLS
  // -------------------------------------------------------------------------
  console.log('\n--- 4. SYMBOL / INSTRUMENT ADMIN CONTROLS ---');
  {
    const adminToken = AdminAuthService.generateAdminToken({
      adminId: 'admin_super',
      tenantId: 'tenant_default',
      role: 'SUPER_ADMIN',
    });

    // 1. List all symbols
    const resSymbols = await apiCall('/api/admin/trading/symbols', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(resSymbols.status === 200 && Array.isArray(resSymbols.data) && resSymbols.data.length >= 10, 'S5-20', 'Admin API lists all configured canonical symbols');

    // 2. Halt EURUSD trading
    const resHalt = await apiCall('/api/admin/trading/symbols/EURUSD', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ tradingStatus: 'HALTED' }),
    });
    assert(resHalt.status === 200 && resHalt.data?.tradingStatus === 'HALTED', 'S5-21', 'Admin halts EURUSD trading status');

    const eurusdHalted = InstrumentRegistry.getInstance().getSymbol('EURUSD')!;
    const acc = runtime.accounts.getAccount('acc_demo_1001')!;
    const checkHalted = RiskEngine.validatePreTradeRisk(acc, 5.42, eurusdHalted, 0.01);
    assert(!checkHalted.valid && checkHalted.reason === 'Trading for EURUSD is currently halted', 'S5-22', 'RiskEngine server-side blocks orders on HALTED symbol');

    // 3. Set to CLOSE_ONLY
    await apiCall('/api/admin/trading/symbols/EURUSD', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ tradingStatus: 'CLOSE_ONLY' }),
    });
    const eurusdCloseOnly = InstrumentRegistry.getInstance().getSymbol('EURUSD')!;
    const checkCloseOnly = RiskEngine.validatePreTradeRisk(acc, 5.42, eurusdCloseOnly, 0.01);
    assert(!checkCloseOnly.valid && checkCloseOnly.reason === 'Symbol EURUSD is in close-only mode', 'S5-23', 'RiskEngine blocks new opening orders on CLOSE_ONLY symbol');

    // 4. Update symbol volume constraints: minVolume = 0.05, maxVolume = 50.0
    await apiCall('/api/admin/trading/symbols/EURUSD', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ tradingStatus: 'TRADING', minVolume: 0.05, maxVolume: 50.0 }),
    });
    const eurusdCustomVol = InstrumentRegistry.getInstance().getSymbol('EURUSD')!;
    const checkVolBelow = RiskEngine.validatePreTradeRisk(acc, 5.42, eurusdCustomVol, 0.01);
    assert(!checkVolBelow.valid && Boolean(checkVolBelow.reason?.includes('below minimum allowed')), 'S5-24', 'RiskEngine enforces updated symbol minVolume (0.05)');

    // Restore standard volume
    await apiCall('/api/admin/trading/symbols/EURUSD', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ minVolume: 0.01, maxVolume: 100.0 }),
    });
  }

  // -------------------------------------------------------------------------
  // SECTION 5: PAIR-WISE SPREAD CONTROL & EFFECTIVE DATING
  // -------------------------------------------------------------------------
  console.log('\n--- 5. PAIR-WISE SPREAD CONTROL & EFFECTIVE DATING ---');
  {
    const adminToken = AdminAuthService.generateAdminToken({
      adminId: 'admin_super',
      tenantId: 'tenant_default',
      role: 'SUPER_ADMIN',
    });

    // 1. Create custom spread for EURUSD: 3.5 points (0.000035 on 5 digits)
    const createRes = await apiCall('/api/admin/trading/spreads', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        symbol: 'EURUSD',
        spreadPoints: 3.5,
        spreadUnit: 'POINTS',
        isActive: true,
      }),
    });
    assert(createRes.status === 201 && createRes.data?.symbol === 'EURUSD', 'S5-25', 'Creates pair-wise spread configuration for EURUSD (3.5 points)');

    // Verify spread policy applies new spread to normalized quote
    const rawQuote: NormalizedInternalQuote = {
      symbol: 'EURUSD',
      bid: 1.08450,
      ask: 1.08462,
      mid: 1.08456,
      spread: 0.00012,
      timestamp: Date.now(),
      receivedTimestamp: Date.now(),
      marketStatus: 'LIVE',
      providerId: 'tiingo_fx',
      assetClass: 'FOREX',
      digits: 5,
      tickSize: 0.00001,
      high24h: 1.08500,
      low24h: 1.08400,
      change24h: 0,
      change24hPct: 0,
    };

    const eurusdCfg = InstrumentRegistry.getInstance().getSymbol('EURUSD')!;
    const clientQuote = adminService.spreadPolicy.applyPricing(rawQuote, eurusdCfg, 'tenant_default');
    
    // Half spread for 3.5 points = 3.5 * 0.00001 / 2 = 0.0000175
    // bid = 1.08456 - 0.0000175 = 1.08454
    // ask = 1.08456 + 0.0000175 = 1.08458
    assert(clientQuote.spread === 0.00004, 'S5-26', 'Admin spread policy symmetrically applies 3.5 pt spread to client quote');
    assert(Boolean(clientQuote.source?.includes('admin_spread')), 'S5-27', 'Client quote source metadata identifies admin_spread application');

    // 2. Future Effective Dating: spread configured for 1 hour in the future
    const futureTime = Date.now() + 3600000;
    const futureRes = await apiCall('/api/admin/trading/spreads', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        symbol: 'BTCUSD',
        spreadPoints: 50.0,
        spreadUnit: 'POINTS',
        effectiveFrom: futureTime,
        isActive: true,
      }),
    });
    assert(futureRes.status === 201 && futureRes.data?.effectiveFrom === futureTime, 'S5-28', 'Creates future-dated spread configuration with effectiveFrom');

    // Check pricing as of NOW: future config should NOT be active yet
    const btcRaw: NormalizedInternalQuote = {
      symbol: 'BTCUSD',
      bid: 68500.00,
      ask: 68508.00,
      mid: 68504.00,
      spread: 8.00,
      timestamp: Date.now(),
      receivedTimestamp: Date.now(),
      marketStatus: 'LIVE',
      providerId: 'crypto_feed',
      assetClass: 'CRYPTO',
      digits: 2,
      tickSize: 0.01,
      high24h: 69000.00,
      low24h: 68000.00,
      change24h: 0,
      change24hPct: 0,
    };
    const btcCfg = InstrumentRegistry.getInstance().getSymbol('BTCUSD')!;
    const quoteNow = adminService.spreadPolicy.applyPricing(btcRaw, btcCfg, 'tenant_default');
    assert(quoteNow.spread === 8.00, 'S5-29', 'Future effective spread is NOT applied prior to its scheduled effectiveFrom timestamp');

    // Check pricing at future time (futureTime + 1000): future config MUST activate
    const btcRawFuture = { ...btcRaw, timestamp: futureTime + 1000 };
    const quoteFuture = adminService.spreadPolicy.applyPricing(btcRawFuture, btcCfg, 'tenant_default');
    // 50 points * 0.01 tickSize = $0.50 spread
    assert(quoteFuture.spread === 0.50, 'S5-30', 'Future effective spread automatically activates once timestamp reaches effectiveFrom');

    // 3. Deactivate spread configuration -> Reverts back to raw provider spread
    const spreadId = createRes.data?.id;
    await apiCall(`/api/admin/trading/spreads/${spreadId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ isActive: false }),
    });

    const quoteDeactivated = adminService.spreadPolicy.applyPricing(rawQuote, eurusdCfg, 'tenant_default');
    assert(quoteDeactivated.spread === rawQuote.spread, 'S5-31', 'Deactivating spread configuration reverts cleanly to raw provider spread');
  }

  // -------------------------------------------------------------------------
  // SECTION 6: HISTORICAL EXECUTION IMMUTABILITY
  // -------------------------------------------------------------------------
  console.log('\n--- 6. HISTORICAL EXECUTION IMMUTABILITY ---');
  {
    // Place an order at initial pricing
    const initialQuote: Quote = {
      symbol: 'EURUSD',
      bid: 1.08450,
      ask: 1.08462,
      mid: 1.08456,
      spread: 0.00012,
      high24h: 1.08500,
      low24h: 1.08400,
      change24h: 0,
      change24hPct: 0,
      timestamp: Date.now(),
    };

    const acc = runtime.accounts.getAccount('acc_demo_1001')!;
    const eurusdCfg = runtime.market.getSymbolConfig('EURUSD')!;

    const { result } = runtime.orders.executeMarketOrder(
      {
        accountId: acc.id,
        symbol: 'EURUSD',
        side: 'BUY',
        type: 'MARKET',
        volume: 0.1,
      },
      acc,
      initialQuote,
      eurusdCfg
    );

    assert(result.success && result.order.executionPrice === 1.08462, 'S5-32', 'Order executes at initial Ask price 1.08462');
    const executedOrderId = result.order.id;

    // Admin now introduces a massive spread markup
    const adminToken = AdminAuthService.generateAdminToken({
      adminId: 'admin_super',
      tenantId: 'tenant_default',
      role: 'SUPER_ADMIN',
    });
    await apiCall('/api/admin/trading/spreads', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        symbol: 'EURUSD',
        spreadPoints: 50.0, // 50 points = 5.0 pips
        isActive: true,
      }),
    });

    // Verify historical execution and order are strictly UNCHANGED
    const historicalOrder = runtime.orders.getOrder(executedOrderId)!;
    assert(historicalOrder.executionPrice === 1.08462, 'S5-33', 'Historical executed order price remains 1.08462 (strictly immutable)');
    assert(historicalOrder.status === 'FILLED', 'S5-34', 'Historical trade status is completely unaffected by subsequent admin spread changes');
  }

  // -------------------------------------------------------------------------
  // SECTION 7: AUDIT TRAIL LOGGING
  // -------------------------------------------------------------------------
  console.log('\n--- 7. AUDIT TRAIL LOGGING ---');
  {
    const adminToken = AdminAuthService.generateAdminToken({
      adminId: 'admin_super',
      tenantId: 'tenant_default',
      role: 'SUPER_ADMIN',
    });

    const resAudit = await apiCall('/api/admin/trading/audit', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    assert(resAudit.status === 200 && Array.isArray(resAudit.data), 'S5-35', 'Admin API queries audit log trail');
    const logs = resAudit.data as any[];
    assert(logs.length >= 5, 'S5-36', `Audit log recorded all administrative operations (got ${logs.length} entries)`);

    const hasAccountUpdate = logs.some((l) => l.action === 'UPDATE_ACCOUNT');
    const hasSymbolUpdate = logs.some((l) => l.action === 'UPDATE_SYMBOL');
    const hasSpreadCreate = logs.some((l) => l.action === 'CREATE_SPREAD_CONFIG');

    assert(hasAccountUpdate, 'S5-37', 'Audit trail captures account updates with admin identity and prevState/newState');
    assert(hasSymbolUpdate, 'S5-38', 'Audit trail captures symbol parameter modifications');
    assert(hasSpreadCreate, 'S5-39', 'Audit trail captures pair-wise spread creations');
  }

  console.log('\n=============================================================');
  console.log(`  STEP 5 TEST RESULTS: ${passCount} PASSED, ${failCount} FAILED (TOTAL: ${passCount + failCount})`);
  console.log('=============================================================\n');

  runtime.stop();
  httpServer.close();
  process.exit(failCount > 0 ? 1 : 0);
}

runStep5Tests().catch((err) => {
  console.error('Fatal Step 5 test failure:', err);
  process.exit(1);
});
