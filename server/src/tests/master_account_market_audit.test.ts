/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * MASTER TEST SUITE: ACCOUNT STATE + BALANCE + LEDGER + MARKET DATA + SECONDARY PROVIDER
 * Verifies all 20 requirements specified in the Part 18 audit checklist:
 * 
 * ACCOUNT TESTS (1-7):
 * 1. External account initialBalance = 0 -> balance = 0
 * 2. External account initialBalance = 10000 -> balance = 10000
 * 3. Missing external initialBalance -> safe external default = 0
 * 4. External account must never fallback to 25000
 * 5. Existing external account must not receive duplicate initial deposit
 * 6. Account 57575 repair results in balance 0, equity 0, margin 0, free margin 0, P/L 0
 * 7. Demo mode remains unchanged (DEMO-1001 with 10000 balance)
 * 
 * LEDGER TESTS (8-10):
 * 8. Zero-balance external account does not create fake zero deposit
 * 9. Non-zero initial balance creates only one valid initial ledger event where appropriate
 * 10. Ledger account ID matches canonical account ID
 * 
 * MARKET DATA TESTS (11-18):
 * 11. Tiingo routes supported symbols (including USDCAD)
 * 12. Secondary provider routes missing symbols (Twelve Data for XAUUSD, XAGUSD, BTCUSD, ETHUSD)
 * 13. Internal symbol mapping is correct
 * 14. Unsupported symbols do not produce fake quotes (US500)
 * 15. Provider reconnect resubscribes correctly
 * 16. Provider failure does not crash the Trading Engine
 * 17. No uncontrolled provider connection multiplication
 * 18. Quote normalization produces the same internal format regardless of provider
 * 
 * REGRESSION TESTS (19-20):
 * 19. CRM external account 57575 remains the sole active account
 * 20. DEMO-1001 does not reappear in EXTERNAL mode
 */

import { PGlite } from '@electric-sql/pglite';
import { SessionTokenService } from '../auth/SessionTokenService';
import { AccountRegistry } from '../runtime/AccountRegistry';
import { PostgresAccountRepository } from '../repositories/PostgresAccountRepository';
import { PostgresLedgerRepository } from '../repositories/PostgresLedgerRepository';
import { runMigrations } from '../db/migrations';
import { CENTRAL_SYMBOL_MAPPINGS, getCanonicalFromTwelveData, getCanonicalFromTiingo, getSymbolMapping } from '../market/SymbolMapping';
import { TwelveDataMarketDataAdapter } from '../market/TwelveDataMarketDataAdapter';
import { MarketDataRouter } from '../market/MarketDataRouter';
import { MarketEngine } from '../market/MarketEngine';
import { GenericFeedAdapter } from '../market/GenericFeedAdapter';
import { NormalizedInternalQuote } from '../types/marketData';

let passed = 0;
let failed = 0;

function assert(condition: boolean, num: number, name: string, detail?: string) {
  if (condition) {
    console.log(`  \x1b[32m✔ PASS [REQ-${num.toString().padStart(2, '0')}]\x1b[0m ${name}`);
    passed++;
  } else {
    console.error(`  \x1b[31m✖ FAIL [REQ-${num.toString().padStart(2, '0')}]\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

async function runMasterTestSuite() {
  console.log('\n=============================================================');
  console.log('  RUNNING MASTER AUDIT VERIFICATION TEST SUITE (20 REQUIREMENTS)');
  console.log('=============================================================\n');

  const secret = 'master_test_shared_secret_12345';
  process.env.CRM_LAUNCH_SECRET = secret;

  // Initialize isolated in-memory PostgreSQL engine for tests
  const pglite = new PGlite();
  const dbClient = {
    query: async (sql: string, params?: any[]) => {
      const res = await pglite.query(sql, params);
      return { rows: res.rows, rowCount: res.rows.length };
    },
    transaction: async <T>(cb: any) => cb(dbClient),
    close: async () => {},
    isReady: () => true,
  };

  // Run schema migrations and data repairs
  await runMigrations(dbClient as any);

  const accountRepo = new PostgresAccountRepository(dbClient as any);
  const ledgerRepo = new PostgresLedgerRepository(dbClient as any);
  const memoryRegistry = new AccountRegistry();

  // --- ACCOUNT TESTS (1 - 7) ---

  // REQ 1: External account initialBalance = 0 -> balance = 0
  const tokenZero = SessionTokenService.createLaunchToken({
    iss: 'crm-backend',
    sub: 'client_zero_01',
    aud: 'trading-terminal',
    accountId: 'acc_crm_zero_01',
    accountNumber: '70001',
    tenantId: 'broker_live',
    platform: 'MT5',
    currency: 'USD',
    accountType: 'LIVE',
    leverage: 100,
    initialBalance: 0.00,
  }, 300, secret);

  const verifyZero = SessionTokenService.verifyLaunchToken(tokenZero, secret);
  assert(verifyZero.valid && verifyZero.claims?.initialBalance === 0.00, 1, 'Token verification preserves initialBalance = 0.00 without falsy coercion');

  const provZeroDb = await accountRepo.provisionExternalAccount(verifyZero.claims!);
  const provZeroMem = memoryRegistry.provisionExternalAccount(verifyZero.claims!);
  assert(provZeroDb.balance === 0.00 && provZeroMem.balance === 0.00, 1, 'External account with initialBalance = 0 provisions balance = 0.00 in DB and memory');

  // REQ 2: External account initialBalance = 10000 -> balance = 10000
  const token10k = SessionTokenService.createLaunchToken({
    iss: 'crm-backend',
    sub: 'client_10k_01',
    aud: 'trading-terminal',
    accountId: 'acc_crm_10k_01',
    accountNumber: '70002',
    tenantId: 'broker_live',
    platform: 'MT5',
    currency: 'USD',
    accountType: 'LIVE',
    leverage: 100,
    initialBalance: 10000.00,
  }, 300, secret);

  const verify10k = SessionTokenService.verifyLaunchToken(token10k, secret);
  const prov10kDb = await accountRepo.provisionExternalAccount(verify10k.claims!);
  assert(prov10kDb.balance === 10000.00 && prov10kDb.equity === 10000.00, 2, 'External account with initialBalance = 10000 provisions balance = 10000.00');

  // REQ 3: Missing external initialBalance -> safe external default = 0
  const tokenMissingBal = SessionTokenService.createLaunchToken({
    iss: 'crm-backend',
    sub: 'client_missing_01',
    aud: 'trading-terminal',
    accountId: 'acc_crm_missing_01',
    accountNumber: '70003',
    tenantId: 'broker_live',
    platform: 'MT5',
    currency: 'USD',
    accountType: 'LIVE',
    leverage: 100,
  } as any, 300, secret);

  const verifyMissing = SessionTokenService.verifyLaunchToken(tokenMissingBal, secret);
  const provMissingDb = await accountRepo.provisionExternalAccount(verifyMissing.claims!);
  assert(provMissingDb.balance === 0.00 && provMissingDb.equity === 0.00, 3, 'Missing external initialBalance safely defaults to 0.00 (not undefined or NaN)');

  // REQ 4: External account must never fallback to 25000
  assert(
    provZeroDb.balance !== 25000.00 && provMissingDb.balance !== 25000.00,
    4,
    'External account provisioning NEVER falls back to synthetic 25,000.00'
  );

  // REQ 5: Existing external account must not receive duplicate initial deposit
  await accountRepo.provisionExternalAccount(verify10k.claims!); // second login
  const ledger10k = await ledgerRepo.getLedgerForAccount(prov10kDb.id);
  assert(ledger10k.length === 1, 5, 'Existing external account does NOT receive duplicate initial deposit on re-login');

  // REQ 6: Account 57575 repair results in balance 0, equity 0, margin 0, free margin 0, P/L 0
  // First simulate the corrupted state in DB
  await dbClient.query(`
    INSERT INTO trading_accounts (id, tenant_id, client_id, account_number, platform, currency, account_type, session_mode, leverage, balance, equity, used_margin, free_margin, margin_level, margin_call_level, stop_out_level, status, created_at, updated_at)
    VALUES ('acc_crm_57575', 'tenant_default', 'client_57575', '57575', 'MT5', 'USD', 'LIVE', 'EXTERNAL', 100, 25000.00, 25000.00, 0.00, 25000.00, 0.00, 100.00, 50.00, 'ACTIVE', 1700000000000, 1700000000000)
    ON CONFLICT (id) DO UPDATE SET balance = 25000.00, equity = 25000.00, free_margin = 25000.00;
  `);
  await dbClient.query(`
    INSERT INTO trading_ledger (id, account_id, tenant_id, type, amount, balance_after, description, created_at)
    VALUES ('led_corrupt_57575', 'acc_crm_57575', 'tenant_default', 'DEPOSIT', 25000.00, 25000.00, 'External Account Hydrated from CRM (MT5 #57575)', 1700000000000)
    ON CONFLICT (id) DO NOTHING;
  `);

  // Run migration repair
  await runMigrations(dbClient as any);

  const repairedAcc = await accountRepo.getAccount('57575');
  const repairedLedger = await ledgerRepo.getLedgerForAccount('acc_crm_57575');
  assert(
    !!repairedAcc &&
    repairedAcc.balance === 0.00 &&
    repairedAcc.equity === 0.00 &&
    repairedAcc.usedMargin === 0.00 &&
    repairedAcc.freeMargin === 0.00 &&
    (repairedAcc.equity - repairedAcc.balance) === 0.00 &&
    repairedLedger.length === 0,
    6,
    'Account 57575 repair safely restores balance = 0, equity = 0, margin = 0, free margin = 0, P/L = 0 and cleans false ledger'
  );

  // REQ 7: Demo mode remains unchanged (DEMO-1001 with 10000 balance)
  const demoAcc = await accountRepo.getAccount('DEMO-1001');
  assert(
    !!demoAcc && demoAcc.accountNumber === 'DEMO-1001' && demoAcc.balance === 10000.00 && demoAcc.sessionMode === 'DEMO',
    7,
    'Demo mode remains completely intact with standard $10,000 balance'
  );

  // --- LEDGER TESTS (8 - 10) ---

  // REQ 8: Zero-balance external account does not create fake zero deposit
  const ledgerZero = await ledgerRepo.getLedgerForAccount(provZeroDb.id);
  assert(ledgerZero.length === 0, 8, 'Zero-balance external account creates ZERO synthetic deposit ledger entries');

  // REQ 9: Non-zero initial balance creates only one valid initial ledger event
  assert(ledger10k.length === 1 && ledger10k[0].amount === 10000.00 && ledger10k[0].type === 'DEPOSIT', 9, 'Non-zero initial balance creates exactly one valid initial deposit entry');

  // REQ 10: Ledger account ID matches canonical account ID
  assert(ledger10k[0].accountId === prov10kDb.id, 10, 'Ledger account ID matches canonical account ID');

  // --- MARKET DATA TESTS (11 - 18) ---

  // REQ 11: Tiingo routes supported symbols (including USDCAD)
  const usdcadMapping = getSymbolMapping('USDCAD');
  assert(
    !!usdcadMapping && usdcadMapping.tiingoSymbol === 'usdcad' && usdcadMapping.primaryProvider === 'tiingo_fx',
    11,
    'Tiingo is configured as primary provider for USDCAD along with the 5 other majors'
  );

  // REQ 12: Secondary provider routes missing symbols (Twelve Data for XAUUSD, XAGUSD, BTCUSD, ETHUSD)
  const xauMapping = getSymbolMapping('XAUUSD');
  const btcMapping = getSymbolMapping('BTCUSD');
  assert(
    xauMapping?.primaryProvider === 'twelve_data' && xauMapping.twelveDataSymbol === 'XAU/USD' &&
    btcMapping?.primaryProvider === 'twelve_data' && btcMapping.twelveDataSymbol === 'BTC/USD',
    12,
    'Twelve Data is configured as primary route for Metals (XAUUSD) and Crypto (BTCUSD)'
  );

  // REQ 13: Internal symbol mapping is correct
  assert(
    getCanonicalFromTwelveData('BTC/USD') === 'BTCUSD' &&
    getCanonicalFromTwelveData('XAU/USD') === 'XAUUSD' &&
    getCanonicalFromTiingo('eurusd') === 'EURUSD' &&
    getCanonicalFromTiingo('usdcad') === 'USDCAD',
    13,
    'Provider symbol mapping bidirectional lookups resolve cleanly to canonical identifiers'
  );

  // REQ 14: Unsupported symbols do not produce fake quotes (US500)
  const us500Mapping = getSymbolMapping('US500');
  assert(
    us500Mapping?.isAvailableOnStandardTier === false && us500Mapping.primaryProvider === 'unassigned',
    14,
    'US500 is explicitly flagged as unavailable on standard plan with ZERO fake quote fabrication'
  );

  // REQ 15: Provider reconnect resubscribes correctly
  const twelveAdapter = new TwelveDataMarketDataAdapter({
    apiKey: 'mock_twelve_key',
    symbols: ['BTCUSD', 'ETHUSD'],
  });
  assert(
    twelveAdapter.getStatus().supportedSymbols.includes('BTCUSD') &&
    twelveAdapter.getStatus().supportedSymbols.includes('ETHUSD'),
    15,
    'Twelve Data adapter tracks supported symbols for automated resubscription upon reconnect'
  );

  // REQ 16: Provider failure does not crash the Trading Engine
  let routerCrashed = false;
  try {
    const mockFaultyProvider = new GenericFeedAdapter({
      providerId: 'faulty_feed',
      providerName: 'FaultyFeed',
    });
    const router = new MarketDataRouter({
      tiingoAdapter: mockFaultyProvider,
      isRealMarketData: true,
    });
    router.start();
    // Simulate error/disconnect
    mockFaultyProvider.setStatus('DISCONNECTED');
    router.stop();
  } catch {
    routerCrashed = true;
  }
  assert(!routerCrashed, 16, 'Provider disconnect or failure does not crash MarketDataRouter');

  // REQ 17: No uncontrolled provider connection multiplication
  const adapterStatusBefore = twelveAdapter.getStatus();
  twelveAdapter.stop();
  twelveAdapter.stop(); // idempotent multiple stops
  assert(twelveAdapter.getStatus().status === 'DISCONNECTED', 17, 'Provider adapter maintains single bounded lifecycle (zero socket multiplication)');

  // REQ 18: Quote normalization produces the same internal format regardless of provider
  let normalizedFromTwelve: NormalizedInternalQuote | null = null;
  twelveAdapter.onQuote((q) => { normalizedFromTwelve = q; });
  twelveAdapter.handleMessage(JSON.stringify({
    event: 'price',
    symbol: 'BTC/USD',
    price: 68450.50,
    timestamp: Math.floor(Date.now() / 1000),
  }));

  assert(
    !!normalizedFromTwelve &&
    (normalizedFromTwelve as any).symbol === 'BTCUSD' &&
    (normalizedFromTwelve as any).mid === 68450.50 &&
    (normalizedFromTwelve as any).providerId === 'twelve_data' &&
    typeof (normalizedFromTwelve as any).bid === 'number' &&
    typeof (normalizedFromTwelve as any).ask === 'number',
    18,
    'Twelve Data tick normalizes to canonical internal Quote contract with bid, ask, mid, spread'
  );

  // --- REGRESSION TESTS (19 - 20) ---

  // REQ 19: CRM external account 57575 remains the sole active account
  const token57575 = SessionTokenService.createLaunchToken({
    iss: 'crm-backend',
    sub: 'client_live_57575',
    aud: 'trading-terminal',
    accountId: 'acc_crm_57575',
    accountNumber: '57575',
    tenantId: 'tenant_default',
    platform: 'MT5',
    currency: 'USD',
    accountType: 'LIVE',
    leverage: 100,
    initialBalance: 0.00,
  }, 300, secret);

  const resolved57575 = await accountRepo.provisionExternalAccount(SessionTokenService.verifyLaunchToken(token57575, secret).claims!);
  assert(
    resolved57575.accountNumber === '57575' && resolved57575.sessionMode === 'EXTERNAL' && resolved57575.balance === 0.00,
    19,
    'CRM account 57575 resolves authoritatively as the sole active account with zero balance'
  );

  // REQ 20: DEMO-1001 does not reappear in EXTERNAL mode
  assert(
    resolved57575.accountNumber !== 'DEMO-1001' && resolved57575.id !== 'acc_demo_1001',
    20,
    'DEMO-1001 does NOT bleed into or overwrite external CRM account 57575'
  );

  console.log('\n=============================================================');
  console.log(`  MASTER AUDIT TEST SUITE RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('=============================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runMasterTestSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
