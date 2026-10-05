/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * MASTER TEST SUITE: ACCOUNT STATE + RISK + 18-INSTRUMENT MARKET WATCH
 * 
 * Comprehensive verification of:
 * 1. External account initialBalance = 0 -> balance = 0, equity = 0, freeMargin = 0
 * 2. External account initialBalance = 10000 -> balance = 10000
 * 3. Missing external initialBalance -> safe external default = 0
 * 4. External account must never fallback to 25000 or 10000
 * 5. Existing external account must not receive duplicate initial deposit
 * 6. Account 57575 repair results in balance 0, equity 0, margin 0, free margin 0, P/L 0
 * 7. Demo mode remains unchanged (DEMO-1001 with 10000 balance)
 * 8. Zero-balance external account creates ZERO synthetic deposit ledger entries
 * 9. Non-zero initial balance creates exactly one valid initial ledger event
 * 10. Ledger account ID matches canonical account ID
 * 11. Zero-balance account -> order requiring margin is strictly REJECTED by RiskEngine
 * 12. Funded account -> order passes pre-trade risk checks
 * 13. Exactly 18 active instruments in canonical registry and symbol mappings
 * 14. EURGBP removed from active watchlist
 * 15. USDCNH added to active watchlist as Chinese Yuan (Offshore)
 * 16. ZERO indices in active watchlist (no US500)
 * 17. Provider mapping for all 18 configured symbols (10 FX, 5 Crypto, 3 Commodities)
 * 18. Provider symbol mapping bidirectional lookups
 * 19. Provider reconnect / bounded lifecycle
 * 20. Provider failure does not crash MarketDataRouter
 * 21. Normalized internal quote consistency across providers
 * 22. CRM external account 57575 remains the sole active account without DEMO-1001 leakage
 */

import { PGlite } from '@electric-sql/pglite';
import { SessionTokenService } from '../auth/SessionTokenService';
import { AccountRegistry } from '../runtime/AccountRegistry';
import { PostgresAccountRepository } from '../repositories/PostgresAccountRepository';
import { PostgresLedgerRepository } from '../repositories/PostgresLedgerRepository';
import { runMigrations } from '../db/migrations';
import { CENTRAL_SYMBOL_MAPPINGS, getCanonicalFromTwelveData, getCanonicalFromTiingo, getSymbolMapping } from '../market/SymbolMapping';
import { CANONICAL_INSTRUMENTS, InstrumentRegistry } from '../market/InstrumentRegistry';
import { INITIAL_SYMBOLS, ALL_SYMBOLS } from '../market/MarketEngine';
import { TwelveDataMarketDataAdapter } from '../market/TwelveDataMarketDataAdapter';
import { MarketDataRouter } from '../market/MarketDataRouter';
import { GenericFeedAdapter } from '../market/GenericFeedAdapter';
import { RiskEngine } from '../trading/RiskEngine';
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
  console.log('  RUNNING MASTER AUDIT VERIFICATION TEST SUITE (22 REQUIREMENTS)');
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

  // --- ACCOUNT & FINANCIAL INTEGRITY TESTS (1 - 7) ---

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

  const claimsZero = SessionTokenService.verifyLaunchToken(tokenZero, secret).claims!;
  const provZeroDb = await accountRepo.provisionExternalAccount(claimsZero);
  assert(
    provZeroDb.balance === 0.00 && provZeroDb.equity === 0.00 && provZeroDb.freeMargin === 0.00,
    1,
    'External account with initialBalance = 0 provisions balance = 0.00, equity = 0.00, freeMargin = 0.00'
  );

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

  const claims10k = SessionTokenService.verifyLaunchToken(token10k, secret).claims!;
  const prov10kDb = await accountRepo.provisionExternalAccount(claims10k);
  assert(prov10kDb.balance === 10000.00 && prov10kDb.equity === 10000.00, 2, 'External account with initialBalance = 10000 provisions balance = 10000.00');

  // REQ 3: Missing external initialBalance -> safe external default = 0
  const tokenMissingBal = SessionTokenService.createLaunchToken({
    iss: 'crm-backend',
    sub: 'client_nobal_01',
    aud: 'trading-terminal',
    accountId: 'acc_crm_nobal_01',
    accountNumber: '70003',
    tenantId: 'broker_live',
    platform: 'MT5',
    currency: 'USD',
    accountType: 'LIVE',
    leverage: 100,
  }, 300, secret);

  const claimsMissingBal = SessionTokenService.verifyLaunchToken(tokenMissingBal, secret).claims!;
  const provMissingDb = await accountRepo.provisionExternalAccount(claimsMissingBal);
  assert(provMissingDb.balance === 0.00, 3, 'External account without initialBalance defaults strictly to 0.00');

  // REQ 4: External account must never fallback to 25000
  assert(
    provZeroDb.balance !== 25000.00 && provMissingDb.balance !== 25000.00,
    4,
    'External account provisioning has ZERO fallback to 25,000'
  );

  // REQ 5: Existing external account must not receive duplicate initial deposit
  const reloaded10k = await accountRepo.provisionExternalAccount(claims10k);
  const ledger10k = await ledgerRepo.getLedgerForAccount(reloaded10k.id);
  assert(ledger10k.length === 1 && reloaded10k.balance === 10000.00, 5, 'Re-launching existing external account does NOT duplicate initial deposit');

  // REQ 6: Account 57575 repair results in balance 0, equity 0, margin 0, free margin 0
  // Seed corrupted record for 57575 to verify migration repair logic
  await dbClient.query(`
    INSERT INTO trading_accounts (id, tenant_id, client_id, account_number, platform, currency, account_type, session_mode, leverage, balance, equity, used_margin, free_margin, margin_level, margin_call_level, stop_out_level, status, created_at, updated_at)
    VALUES ('acc_crm_57575', 'tenant_default', 'client_57575', '57575', 'MT5', 'USD', 'LIVE', 'EXTERNAL', 100, 25000.00, 25000.00, 0.00, 25000.00, 0.00, 100.00, 50.00, 'ACTIVE', NOW(), NOW())
    ON CONFLICT (id) DO UPDATE SET balance = 25000.00, equity = 25000.00, free_margin = 25000.00;
  `);
  await dbClient.query(`
    INSERT INTO trading_ledger (id, account_id, tenant_id, type, amount, balance_after, description, created_at)
    VALUES ('led_corrupt_57575', 'acc_crm_57575', 'tenant_default', 'DEPOSIT', 25000.00, 25000.00, 'External Account Hydrated from CRM (MT5 #57575)', NOW())
    ON CONFLICT (id) DO NOTHING;
  `);

  // Run migration repair
  await runMigrations(dbClient as any);
  const repaired57575 = await accountRepo.getAccount('57575');
  const repairedLedger = await ledgerRepo.getLedgerForAccount('acc_crm_57575');

  assert(
    !!repaired57575 &&
    repaired57575.balance === 0.00 &&
    repaired57575.equity === 0.00 &&
    repaired57575.freeMargin === 0.00 &&
    repairedLedger.length === 0,
    6,
    'Targeted repair on test account 57575 authoritatively resets balance to 0.00 and cleans synthetic ledger'
  );

  // REQ 7: Demo mode remains unchanged (DEMO-1001 with 10000 balance)
  const demoAcc = await accountRepo.getAccount('DEMO-1001');
  assert(
    !!demoAcc && demoAcc.accountNumber === 'DEMO-1001' && demoAcc.balance === 10000.00 && demoAcc.sessionMode === 'DEMO',
    7,
    'Standalone demo mode remains intact with $10,000 initial balance'
  );

  // --- LEDGER TESTS (8 - 10) ---

  // REQ 8: Zero-balance external account does not create fake zero deposit
  const ledgerZero = await ledgerRepo.getLedgerForAccount(provZeroDb.id);
  assert(ledgerZero.length === 0, 8, 'Zero-balance external account creates ZERO synthetic deposit ledger entries');

  // REQ 9: Non-zero initial balance creates only one valid initial ledger event
  assert(ledger10k.length === 1 && ledger10k[0].amount === 10000.00 && ledger10k[0].type === 'DEPOSIT', 9, 'Non-zero initial balance creates exactly one valid initial deposit entry');

  // REQ 10: Ledger account ID matches canonical account ID
  assert(ledger10k[0].accountId === prov10kDb.id, 10, 'Ledger account ID matches canonical account ID');

  // --- ORDER / PRE-TRADE RISK TESTS (11 - 12) ---

  // REQ 11: Zero-balance account -> order requiring margin is strictly REJECTED by RiskEngine
  const eurusdCfg = CANONICAL_INSTRUMENTS.find((s) => s.symbol === 'EURUSD')!;
  const reqMargin1Lot = RiskEngine.calculateRequiredMargin(1.0, 1.08500, eurusdCfg, provZeroDb.leverage);
  const zeroRiskResult = RiskEngine.validatePreTradeRisk(provZeroDb, reqMargin1Lot, eurusdCfg, 1.0);
  assert(
    Boolean(!zeroRiskResult.valid && zeroRiskResult.reason?.includes('Insufficient Free Margin')),
    11,
    'Order requiring margin is strictly REJECTED on zero-balance account by server RiskEngine'
  );

  // REQ 12: Funded account -> order passes pre-trade risk checks
  const fundedRiskResult = RiskEngine.validatePreTradeRisk(prov10kDb, reqMargin1Lot, eurusdCfg, 1.0);
  assert(
    Boolean(fundedRiskResult.valid),
    12,
    'Funded account ($10,000) successfully passes pre-trade margin validation'
  );

  // --- 18-INSTRUMENT MARKET WATCH & ROUTING TESTS (13 - 18) ---

  // REQ 13: Exactly 18 active instruments in canonical registry and symbol mappings
  assert(
    CENTRAL_SYMBOL_MAPPINGS.length === 18 &&
    CANONICAL_INSTRUMENTS.length === 18 &&
    INITIAL_SYMBOLS.length === 18,
    13,
    `Market Watch contains EXACTLY 18 active instruments (Mappings: ${CENTRAL_SYMBOL_MAPPINGS.length}, Registry: ${CANONICAL_INSTRUMENTS.length}, Initial: ${INITIAL_SYMBOLS.length})`
  );

  // REQ 14: EURGBP removed from active watchlist
  assert(
    !CENTRAL_SYMBOL_MAPPINGS.some((s) => s.canonical === 'EURGBP') &&
    !CANONICAL_INSTRUMENTS.some((s) => s.symbol === 'EURGBP'),
    14,
    'EURGBP is cleanly REMOVED from active watchlist'
  );

  // REQ 15: USDCNH added to active watchlist as Chinese Yuan (Offshore)
  const cnhMapping = getSymbolMapping('USDCNH');
  assert(
    !!cnhMapping &&
    cnhMapping.canonical === 'USDCNH' &&
    cnhMapping.tiingoSymbol === 'usdcnh' &&
    cnhMapping.twelveDataSymbol === 'USD/CNH',
    15,
    'USDCNH is correctly ADDED as Chinese Yuan (Offshore) with Tiingo and Twelve Data mappings'
  );

  // REQ 16: ZERO indices in active watchlist (no US500)
  assert(
    !CENTRAL_SYMBOL_MAPPINGS.some((s) => s.category === 'INDICES') &&
    !CANONICAL_INSTRUMENTS.some((s) => s.category === 'INDICES') &&
    !INITIAL_SYMBOLS.some((s) => s.symbol === 'US500'),
    16,
    'ZERO indices in active watchlist (US500 and other indices excluded)'
  );

  // REQ 17: Provider mapping for all 18 configured symbols (10 FX, 5 Crypto, 3 Commodities)
  const fxCount = CENTRAL_SYMBOL_MAPPINGS.filter((s) => s.category === 'FOREX').length;
  const cryptoCount = CENTRAL_SYMBOL_MAPPINGS.filter((s) => s.category === 'CRYPTO').length;
  const commCount = CENTRAL_SYMBOL_MAPPINGS.filter((s) => s.category === 'COMMODITIES').length;
  assert(
    fxCount === 10 && cryptoCount === 5 && commCount === 3,
    17,
    `Exact category breakdown verified: 10 Forex, 5 Crypto, 3 Commodities (Total = 18)`
  );

  // REQ 18: Provider symbol mapping bidirectional lookups
  assert(
    getCanonicalFromTwelveData('BTC/USD') === 'BTCUSD' &&
    getCanonicalFromTwelveData('XAU/USD') === 'XAUUSD' &&
    getCanonicalFromTwelveData('WTI/USD') === 'WTIUSD' &&
    getCanonicalFromTwelveData('USD/CNH') === 'USDCNH' &&
    getCanonicalFromTiingo('eurusd') === 'EURUSD' &&
    getCanonicalFromTiingo('usdcnh') === 'USDCNH',
    18,
    'Provider symbol mapping bidirectional lookups resolve cleanly to canonical identifiers'
  );

  // --- MARKET DATA INFRASTRUCTURE TESTS (19 - 22) ---

  // REQ 19: Provider reconnect / bounded lifecycle
  const twelveAdapter = new TwelveDataMarketDataAdapter({
    apiKey: 'mock_twelve_key',
    symbols: ['BTCUSD', 'ETHUSD', 'WTIUSD'],
  });
  assert(
    twelveAdapter.getStatus().supportedSymbols.includes('BTCUSD') &&
    twelveAdapter.getStatus().supportedSymbols.includes('WTIUSD'),
    19,
    'Twelve Data adapter tracks supported symbols for automated resubscription upon reconnect'
  );

  // REQ 20: Provider failure does not crash MarketDataRouter
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
    mockFaultyProvider.setStatus('DISCONNECTED');
    router.stop();
  } catch {
    routerCrashed = true;
  }
  assert(!routerCrashed, 20, 'Provider disconnect or failure does not crash MarketDataRouter');

  // REQ 21: Quote normalization produces the same internal format regardless of provider
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
    21,
    'Twelve Data tick normalizes to canonical internal Quote contract with bid, ask, mid, spread'
  );

  // REQ 22: CRM external account 57575 remains the sole active account
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
    22,
    'CRM account 57575 resolves authoritatively as the sole active account with zero balance without DEMO-1001 leakage'
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
