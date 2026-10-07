/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * SERVER POSTGRESQL MIGRATIONS
 * Idempotent schema initialization for Trading Platform persistence.
 */

import { IDatabaseClient } from './DatabaseClient';
import { SchemaInspector } from './timestampUtils';

export async function runMigrations(db: IDatabaseClient): Promise<void> {
  // 0. Detect if trading_accounts.id is UUID or VARCHAR in target database
  let isUuidAccount = false;
  try {
    const colRes = await db.query(
      `SELECT data_type FROM information_schema.columns WHERE table_name = 'trading_accounts' AND column_name = 'id' LIMIT 1;`
    );
    if (colRes.rows.length > 0 && colRes.rows[0].data_type?.toLowerCase() === 'uuid') {
      isUuidAccount = true;
    }
  } catch {
    // Ignore error if information_schema is restricted
  }

  const accountFkType = isUuidAccount ? 'UUID' : 'VARCHAR(64)';

  const statements = [
    // 1. Trading Accounts Table
    `CREATE TABLE IF NOT EXISTS trading_accounts (
      id VARCHAR(64) PRIMARY KEY,
      tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant_default',
      client_id VARCHAR(64),
      account_number VARCHAR(64) NOT NULL UNIQUE,
      platform VARCHAR(32) NOT NULL DEFAULT 'MT5',
      currency VARCHAR(16) NOT NULL DEFAULT 'USD',
      account_type VARCHAR(16) NOT NULL DEFAULT 'LIVE',
      session_mode VARCHAR(16) NOT NULL DEFAULT 'EXTERNAL',
      leverage NUMERIC NOT NULL DEFAULT 100,
      balance NUMERIC(16, 2) NOT NULL DEFAULT 0.00,
      equity NUMERIC(16, 2) NOT NULL DEFAULT 0.00,
      used_margin NUMERIC(16, 2) NOT NULL DEFAULT 0.00,
      free_margin NUMERIC(16, 2) NOT NULL DEFAULT 0.00,
      margin_level NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
      margin_call_level NUMERIC(10, 2) NOT NULL DEFAULT 100.00,
      stop_out_level NUMERIC(10, 2) NOT NULL DEFAULT 50.00,
      status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,

    // Ensure all required columns exist even if trading_accounts was previously created by an external service/CRM
    `ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant_default';`,
    `ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS client_id VARCHAR(64);`,
    `ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS account_number VARCHAR(64);`,
    `ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS platform VARCHAR(32) NOT NULL DEFAULT 'MT5';`,
    `ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS currency VARCHAR(16) NOT NULL DEFAULT 'USD';`,
    `ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS account_type VARCHAR(16) NOT NULL DEFAULT 'LIVE';`,
    `ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS session_mode VARCHAR(16) NOT NULL DEFAULT 'EXTERNAL';`,
    `ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS leverage NUMERIC NOT NULL DEFAULT 100;`,
    `ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS balance NUMERIC(16, 2) NOT NULL DEFAULT 0.00;`,
    `ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS equity NUMERIC(16, 2) NOT NULL DEFAULT 0.00;`,
    `ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS used_margin NUMERIC(16, 2) NOT NULL DEFAULT 0.00;`,
    `ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS free_margin NUMERIC(16, 2) NOT NULL DEFAULT 0.00;`,
    `ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS margin_level NUMERIC(10, 2) NOT NULL DEFAULT 0.00;`,
    `ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS margin_call_level NUMERIC(10, 2) NOT NULL DEFAULT 100.00;`,
    `ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS stop_out_level NUMERIC(10, 2) NOT NULL DEFAULT 50.00;`,
    `ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE';`,
    `ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS trading_password VARCHAR(255);`,
    `ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);`,
    `ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`,
    `ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`,

    `CREATE INDEX IF NOT EXISTS idx_accounts_tenant ON trading_accounts(tenant_id, account_number);`,

    // 2. Trading Orders Table
    `CREATE TABLE IF NOT EXISTS trading_orders (
      id VARCHAR(64) PRIMARY KEY,
      client_order_id VARCHAR(64) NOT NULL,
      account_id ${accountFkType} NOT NULL REFERENCES trading_accounts(id),
      tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant_default',
      symbol VARCHAR(32) NOT NULL,
      side VARCHAR(8) NOT NULL,
      type VARCHAR(16) NOT NULL,
      volume NUMERIC(12, 4) NOT NULL,
      requested_price NUMERIC(16, 5),
      execution_price NUMERIC(16, 5),
      stop_loss NUMERIC(16, 5),
      take_profit NUMERIC(16, 5),
      status VARCHAR(16) NOT NULL,
      reject_reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      executed_at TIMESTAMPTZ
    );`,

    `CREATE INDEX IF NOT EXISTS idx_orders_account ON trading_orders(account_id, status);`,

    // 3. Trading Positions Table
    `CREATE TABLE IF NOT EXISTS trading_positions (
      id VARCHAR(64) PRIMARY KEY,
      account_id ${accountFkType} NOT NULL REFERENCES trading_accounts(id),
      tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant_default',
      symbol VARCHAR(32) NOT NULL,
      side VARCHAR(8) NOT NULL,
      volume NUMERIC(12, 4) NOT NULL,
      open_price NUMERIC(16, 5) NOT NULL,
      current_price NUMERIC(16, 5) NOT NULL,
      unrealized_pnl NUMERIC(16, 2) NOT NULL DEFAULT 0.00,
      realized_pnl NUMERIC(16, 2) NOT NULL DEFAULT 0.00,
      stop_loss NUMERIC(16, 5),
      take_profit NUMERIC(16, 5),
      margin_locked NUMERIC(16, 2) NOT NULL DEFAULT 0.00,
      opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      closed_at TIMESTAMPTZ,
      status VARCHAR(16) NOT NULL DEFAULT 'OPEN'
    );`,

    `CREATE INDEX IF NOT EXISTS idx_positions_account ON trading_positions(account_id, status);`,

    // 4. Trading Executions Table
    `CREATE TABLE IF NOT EXISTS trading_executions (
      id VARCHAR(64) PRIMARY KEY,
      order_id VARCHAR(64),
      position_id VARCHAR(64),
      account_id ${accountFkType} NOT NULL REFERENCES trading_accounts(id),
      tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant_default',
      symbol VARCHAR(32) NOT NULL,
      side VARCHAR(8) NOT NULL,
      type VARCHAR(16) NOT NULL,
      volume NUMERIC(12, 4) NOT NULL,
      execution_price NUMERIC(16, 5) NOT NULL,
      commission NUMERIC(16, 2) NOT NULL DEFAULT 0.00,
      fee NUMERIC(16, 2) NOT NULL DEFAULT 0.00,
      realized_pnl NUMERIC(16, 2),
      client_order_id VARCHAR(64),
      timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,

    `CREATE INDEX IF NOT EXISTS idx_executions_account ON trading_executions(account_id, timestamp DESC);`,

    // 5. Trading Ledger Table
    `CREATE TABLE IF NOT EXISTS trading_ledger (
      id VARCHAR(64) PRIMARY KEY,
      account_id ${accountFkType} NOT NULL REFERENCES trading_accounts(id),
      tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant_default',
      type VARCHAR(32) NOT NULL,
      amount NUMERIC(16, 2) NOT NULL,
      balance_after NUMERIC(16, 2) NOT NULL,
      reference_id VARCHAR(64),
      description TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,

    `CREATE INDEX IF NOT EXISTS idx_ledger_account ON trading_ledger(account_id, created_at DESC);`,

    // --- STEP 5: RISK + ADMIN CONTROL FOUNDATION MIGRATIONS ---

    // 6. Account Controls Columns
    `ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS trading_enabled BOOLEAN NOT NULL DEFAULT true;`,
    `ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS max_order_volume NUMERIC(12, 4);`,
    `ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS max_position_volume NUMERIC(12, 4);`,

    // 7. Trading Spread Configurations Table (Pair-Wise Spread Policy)
    `CREATE TABLE IF NOT EXISTS trading_spread_configs (
      id VARCHAR(64) PRIMARY KEY,
      tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant_default',
      symbol VARCHAR(32) NOT NULL,
      spread_points NUMERIC(10, 4) NOT NULL,
      spread_unit VARCHAR(16) NOT NULL DEFAULT 'POINTS',
      is_active BOOLEAN NOT NULL DEFAULT true,
      effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by VARCHAR(64) NOT NULL DEFAULT 'system',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
    `CREATE INDEX IF NOT EXISTS idx_spread_configs_lookup ON trading_spread_configs(tenant_id, symbol, is_active, effective_from);`,

    // 8. Trading Audit Log Table (Immutable Administrative Operations Trail)
    `CREATE TABLE IF NOT EXISTS trading_audit_log (
      id VARCHAR(64) PRIMARY KEY,
      tenant_id VARCHAR(64) NOT NULL,
      admin_id VARCHAR(64) NOT NULL,
      action VARCHAR(64) NOT NULL,
      resource_type VARCHAR(64) NOT NULL,
      resource_id VARCHAR(64) NOT NULL,
      prev_state JSONB,
      new_state JSONB,
      reason TEXT,
      timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
    `CREATE INDEX IF NOT EXISTS idx_audit_log_tenant ON trading_audit_log(tenant_id, timestamp DESC);`,

    // 9. Trading Symbol Configurations Overrides Table (Tenant / Admin Symbol Overrides)
    `CREATE TABLE IF NOT EXISTS trading_symbol_configs (
      id VARCHAR(64) PRIMARY KEY,
      tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant_default',
      symbol VARCHAR(32) NOT NULL,
      is_enabled BOOLEAN NOT NULL DEFAULT true,
      trading_status VARCHAR(32) NOT NULL DEFAULT 'TRADING',
      min_volume NUMERIC(12, 4),
      max_volume NUMERIC(12, 4),
      volume_step NUMERIC(12, 4),
      digits INTEGER,
      tick_size NUMERIC(16, 6),
      contract_size NUMERIC(16, 2),
      updated_by VARCHAR(64),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(tenant_id, symbol)
    );`,
    `CREATE INDEX IF NOT EXISTS idx_symbol_configs_tenant ON trading_symbol_configs(tenant_id, symbol);`,

    // 10. Seed default demo accounts for foreign key consistency (only if id is not strictly uuid in database)
    ...(isUuidAccount ? [] : [
      `INSERT INTO trading_accounts (id, tenant_id, client_id, account_number, platform, currency, account_type, session_mode, leverage, balance, equity, used_margin, free_margin, margin_level, margin_call_level, stop_out_level, status, created_at, updated_at)
       VALUES ('acc_demo_1001', 'tenant_default', 'client_demo_1001', 'DEMO-1001', 'PROPRIETARY', 'USD', 'DEMO', 'DEMO', 100, 10000.00, 10000.00, 0.00, 10000.00, 0.00, 100.00, 50.00, 'ACTIVE', NOW(), NOW())
       ON CONFLICT (id) DO NOTHING;`,
      `INSERT INTO trading_accounts (id, tenant_id, client_id, account_number, platform, currency, account_type, session_mode, leverage, balance, equity, used_margin, free_margin, margin_level, margin_call_level, stop_out_level, status, created_at, updated_at)
       VALUES ('acc_demo_1002', 'tenant_default', 'client_demo_1002', 'DEMO-1002', 'PROPRIETARY', 'EUR', 'DEMO', 'DEMO', 100, 10000.00, 10000.00, 0.00, 10000.00, 0.00, 100.00, 50.00, 'ACTIVE', NOW(), NOW())
       ON CONFLICT (id) DO NOTHING;`,
    ]),

    // 11. Idempotent Data Repair: Target known corrupted test account 57575
    // Resets synthetic 25,000.00 / 10,000.00 balance to authoritative 0.00 without touching any other account or valid history.
    `UPDATE trading_accounts
     SET balance = 0.00,
         equity = 0.00,
         used_margin = 0.00,
         free_margin = 0.00,
         margin_level = 0.00
     WHERE account_number = '57575'
       AND session_mode = 'EXTERNAL'
       AND (balance = 25000.00 OR balance = 10000.00);`,
    `DELETE FROM trading_ledger
     WHERE account_id IN (SELECT id FROM trading_accounts WHERE account_number = '57575')
       AND type = 'DEPOSIT'
       AND (amount = 25000.00 OR amount = 10000.00)
       AND (description LIKE '%External Account Hydrated from CRM%' OR description LIKE '%Initial Demo Balance%');`,

    // 12. Trading Funding Transactions Table (Step 3 CRM M2M Funding Credit Idempotency & Audit)
    `CREATE TABLE IF NOT EXISTS trading_funding_transactions (
      id VARCHAR(64) PRIMARY KEY,
      idempotency_key VARCHAR(128) NOT NULL,
      account_id ${accountFkType} NOT NULL REFERENCES trading_accounts(id),
      tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant_default',
      amount NUMERIC(16, 2) NOT NULL,
      currency VARCHAR(16) NOT NULL DEFAULT 'USD',
      balance_before NUMERIC(16, 2) NOT NULL,
      balance_after NUMERIC(16, 2) NOT NULL,
      note TEXT,
      ledger_entry_id VARCHAR(64),
      status VARCHAR(32) NOT NULL DEFAULT 'SUCCESS',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_funding_idempotency_key ON trading_funding_transactions(tenant_id, idempotency_key);`,
    `CREATE INDEX IF NOT EXISTS idx_funding_account ON trading_funding_transactions(account_id, created_at DESC);`,
  ];

  for (const stmt of statements) {
    try {
      await db.query(stmt);
    } catch (err: any) {
      console.warn('[runMigrations] Non-fatal migration statement warning:', err?.message || err);
    }
  }

  await SchemaInspector.loadSchema(db);
}
