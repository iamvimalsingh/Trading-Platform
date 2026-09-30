/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * SERVER POSTGRESQL MIGRATIONS
 * Idempotent schema initialization for Trading Platform persistence.
 */

import { IDatabaseClient } from './DatabaseClient';

export async function runMigrations(db: IDatabaseClient): Promise<void> {
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
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );`,

    `CREATE INDEX IF NOT EXISTS idx_accounts_tenant ON trading_accounts(tenant_id, account_number);`,

    // 2. Trading Orders Table
    `CREATE TABLE IF NOT EXISTS trading_orders (
      id VARCHAR(64) PRIMARY KEY,
      client_order_id VARCHAR(64) NOT NULL,
      account_id VARCHAR(64) NOT NULL REFERENCES trading_accounts(id),
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
      created_at BIGINT NOT NULL,
      executed_at BIGINT
    );`,

    `CREATE INDEX IF NOT EXISTS idx_orders_account ON trading_orders(account_id, status);`,

    // 3. Trading Positions Table
    `CREATE TABLE IF NOT EXISTS trading_positions (
      id VARCHAR(64) PRIMARY KEY,
      account_id VARCHAR(64) NOT NULL REFERENCES trading_accounts(id),
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
      opened_at BIGINT NOT NULL,
      closed_at BIGINT,
      status VARCHAR(16) NOT NULL DEFAULT 'OPEN'
    );`,

    `CREATE INDEX IF NOT EXISTS idx_positions_account ON trading_positions(account_id, status);`,

    // 4. Trading Executions Table
    `CREATE TABLE IF NOT EXISTS trading_executions (
      id VARCHAR(64) PRIMARY KEY,
      order_id VARCHAR(64),
      position_id VARCHAR(64),
      account_id VARCHAR(64) NOT NULL REFERENCES trading_accounts(id),
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
      timestamp BIGINT NOT NULL
    );`,

    `CREATE INDEX IF NOT EXISTS idx_executions_account ON trading_executions(account_id, timestamp DESC);`,

    // 5. Trading Ledger Table
    `CREATE TABLE IF NOT EXISTS trading_ledger (
      id VARCHAR(64) PRIMARY KEY,
      account_id VARCHAR(64) NOT NULL REFERENCES trading_accounts(id),
      tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant_default',
      type VARCHAR(32) NOT NULL,
      amount NUMERIC(16, 2) NOT NULL,
      balance_after NUMERIC(16, 2) NOT NULL,
      reference_id VARCHAR(64),
      description TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );`,

    `CREATE INDEX IF NOT EXISTS idx_ledger_account ON trading_ledger(account_id, created_at DESC);`,

    // 6. Seed default demo accounts for foreign key consistency
    `INSERT INTO trading_accounts (id, tenant_id, client_id, account_number, platform, currency, account_type, session_mode, leverage, balance, equity, used_margin, free_margin, margin_level, margin_call_level, stop_out_level, status, created_at, updated_at)
     VALUES ('acc_demo_1001', 'tenant_default', 'client_demo_1001', 'DEMO-1001', 'PROPRIETARY', 'USD', 'DEMO', 'DEMO', 100, 10000.00, 10000.00, 0.00, 10000.00, 0.00, 100.00, 50.00, 'ACTIVE', 1700000000000, 1700000000000)
     ON CONFLICT (id) DO NOTHING;`,
    `INSERT INTO trading_accounts (id, tenant_id, client_id, account_number, platform, currency, account_type, session_mode, leverage, balance, equity, used_margin, free_margin, margin_level, margin_call_level, stop_out_level, status, created_at, updated_at)
     VALUES ('acc_demo_1002', 'tenant_default', 'client_demo_1002', 'DEMO-1002', 'PROPRIETARY', 'EUR', 'DEMO', 'DEMO', 100, 10000.00, 10000.00, 0.00, 10000.00, 0.00, 100.00, 50.00, 'ACTIVE', 1700000000000, 1700000000000)
     ON CONFLICT (id) DO NOTHING;`,
  ];

  for (const stmt of statements) {
    await db.query(stmt);
  }
}
