/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * PRODUCTION SCHEMA COMPATIBILITY TEST SUITE
 * Validates that all PostgreSQL tables, columns, constraints, and indexes
 * required by the M2M funding flow and Trading Platform persistence exist.
 * 
 * Run with: npx tsx server/src/tests/production_schema_compatibility.test.ts
 */

import path from 'path';
import fs from 'fs';
import { DatabaseClient } from '../db/DatabaseClient';
import { runMigrations } from '../db/migrations';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testNum: string, name: string, detail?: string) {
  if (condition) {
    console.log(`  \x1b[32m✔ PASS [${testNum}]\x1b[0m ${name}`);
    passed++;
  } else {
    console.error(`  \x1b[31m✖ FAIL [${testNum}]\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

async function runSchemaCompatibilityTests() {
  console.log('\n=============================================================');
  console.log('  RUNNING PRODUCTION SCHEMA COMPATIBILITY TESTS');
  console.log('=============================================================\n');

  const testDbDir = path.resolve(process.cwd(), 'data', 'test_schema_compat_db');
  process.env.DATABASE_STORAGE_PATH = testDbDir;
  if (fs.existsSync(testDbDir)) {
    fs.rmSync(testDbDir, { recursive: true, force: true });
  }

  DatabaseClient.resetInstance();
  const db = DatabaseClient.getInstance(testDbDir);
  await db.init();

  // 1. Simulate a pre-existing trading_accounts table created by CRM without financial columns
  await db.query(`
    CREATE TABLE IF NOT EXISTS trading_accounts (
      id VARCHAR(64) PRIMARY KEY,
      account_number VARCHAR(64) NOT NULL UNIQUE
    );
  `);
  await db.query(`
    INSERT INTO trading_accounts (id, account_number) VALUES ('acc_seed_pre_existing', '998877');
  `);

  console.log('--- 1. MIGRATION RUNNER IDEMPOTENT EXECUTION ---');
  await runMigrations(db);
  assert(true, 'SCHEMA-01', 'runMigrations executed on pre-existing database without fatal exceptions');

  // Helper to get columns for a table
  async function getColumns(tableName: string): Promise<string[]> {
    const res = await db.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1;`,
      [tableName]
    );
    return res.rows.map((r) => r.column_name);
  }

  console.log('\n--- 2. TRADING_ACCOUNTS FINANCIAL COLUMNS RECONCILIATION ---');
  const accountCols = await getColumns('trading_accounts');
  const requiredAccountCols = [
    'id', 'tenant_id', 'client_id', 'account_number', 'platform', 'currency',
    'account_type', 'session_mode', 'leverage', 'balance', 'equity', 'used_margin',
    'free_margin', 'margin_level', 'margin_call_level', 'stop_out_level', 'status',
    'trading_enabled', 'max_order_volume', 'max_position_volume', 'created_at', 'updated_at'
  ];

  for (const col of requiredAccountCols) {
    assert(accountCols.includes(col), `SCHEMA-ACC-${col}`, `trading_accounts has required column '${col}'`);
  }

  // Verify pre-existing data integrity
  const preExistingRow = await db.query(`SELECT * FROM trading_accounts WHERE id = 'acc_seed_pre_existing';`);
  assert(
    preExistingRow.rows.length === 1 &&
    Number(preExistingRow.rows[0].balance) === 0 &&
    preExistingRow.rows[0].account_number === '998877',
    'SCHEMA-ACC-PREEXISTING',
    'Pre-existing account rows preserved with default financial column values'
  );

  console.log('\n--- 3. TRADING_FUNDING_TRANSACTIONS TABLE RECONCILIATION ---');
  const fundingCols = await getColumns('trading_funding_transactions');
  const requiredFundingCols = [
    'id', 'idempotency_key', 'account_id', 'tenant_id', 'amount', 'currency',
    'balance_before', 'balance_after', 'note', 'ledger_entry_id', 'status', 'created_at'
  ];

  for (const col of requiredFundingCols) {
    assert(fundingCols.includes(col), `SCHEMA-FUND-${col}`, `trading_funding_transactions has required column '${col}'`);
  }

  console.log('\n--- 4. TRADING_LEDGER TABLE RECONCILIATION ---');
  const ledgerCols = await getColumns('trading_ledger');
  const requiredLedgerCols = [
    'id', 'account_id', 'tenant_id', 'type', 'amount', 'balance_after',
    'reference_id', 'description', 'created_at'
  ];

  for (const col of requiredLedgerCols) {
    assert(ledgerCols.includes(col), `SCHEMA-LEDGER-${col}`, `trading_ledger has required column '${col}'`);
  }

  console.log('\n--- 5. TRADING_AUDIT_LOG TABLE RECONCILIATION ---');
  const auditCols = await getColumns('trading_audit_log');
  const requiredAuditCols = [
    'id', 'tenant_id', 'admin_id', 'action', 'resource_type', 'resource_id',
    'prev_state', 'new_state', 'reason', 'timestamp'
  ];

  for (const col of requiredAuditCols) {
    assert(auditCols.includes(col), `SCHEMA-AUDIT-${col}`, `trading_audit_log has required column '${col}'`);
  }

  console.log('\n--- 6. IDEMPOTENT RERUN VERIFICATION ---');
  // Re-run migrations on the populated database
  await runMigrations(db);
  assert(true, 'SCHEMA-RERUN', 'Second execution of runMigrations is 100% idempotent without error');

  console.log('\n--- 7. DATE / TIMESTAMPTZ TYPE COMPATIBILITY TESTS ---');
  // Create test table with explicit PostgreSQL TIMESTAMPTZ columns simulating production Supabase
  await db.query(`
    CREATE TABLE IF NOT EXISTS test_timestamptz_compat (
      id VARCHAR(64) PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const { toDbTimestamp, parseDbTimestamp } = await import('../db/timestampUtils');
  const nowMs = Date.now();
  const dbTs = toDbTimestamp(nowMs);

  await db.query(
    `INSERT INTO test_timestamptz_compat (id, created_at, updated_at) VALUES ($1, $2, $3);`,
    ['ts_test_01', dbTs, dbTs]
  );

  const tsRow = await db.query(`SELECT * FROM test_timestamptz_compat WHERE id = 'ts_test_01';`);
  const parsedCreated = parseDbTimestamp(tsRow.rows[0].created_at);
  const parsedUpdated = parseDbTimestamp(tsRow.rows[0].updated_at);

  assert(
    Math.abs(parsedCreated - nowMs) < 5000,
    'TIME-01',
    `TIMESTAMPTZ column writes JS Date and reads back accurate epoch ms (${parsedCreated} vs ${nowMs})`
  );

  // Test repository write into TIMESTAMPTZ without out-of-range error
  const { PostgresFundingRepository } = await import('../repositories/PostgresFundingRepository');
  const fundingRepo = new PostgresFundingRepository(db);

  await fundingRepo.updateAccountBalance('acc_seed_pre_existing', 1000, 1000, 1000, 0);
  const updatedPre = await db.query(`SELECT * FROM trading_accounts WHERE id = 'acc_seed_pre_existing';`);
  assert(
    Number(updatedPre.rows[0].balance) === 1000,
    'TIME-02',
    'updateAccountBalance executes with toDbTimestamp() successfully'
  );

  console.log('\n--- 8. BIGINT TIMESTAMP COLUMN COMPATIBILITY TESTS ---');
  // Create test table with explicit PostgreSQL BIGINT columns simulating pre-existing Supabase tables
  await db.query(`
    CREATE TABLE IF NOT EXISTS test_bigint_compat (
      id VARCHAR(64) PRIMARY KEY,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );
  `);

  const { SchemaInspector } = await import('../db/timestampUtils');
  await SchemaInspector.loadSchema(db);

  const bigintVal = toDbTimestamp(nowMs, 'test_bigint_compat', 'created_at');
  assert(
    typeof bigintVal === 'number',
    'TIME-03',
    `SchemaInspector detected BIGINT column and formatted parameter as number (${typeof bigintVal})`
  );

  await db.query(
    `INSERT INTO test_bigint_compat (id, created_at, updated_at) VALUES ($1, $2, $3);`,
    ['bi_test_01', bigintVal, bigintVal]
  );

  const biRow = await db.query(`SELECT * FROM test_bigint_compat WHERE id = 'bi_test_01';`);
  const parsedBiCreated = parseDbTimestamp(biRow.rows[0].created_at);

  assert(
    Math.abs(parsedBiCreated - nowMs) < 5000,
    'TIME-04',
    `BIGINT column writes number without bigint syntax error and reads back accurate epoch ms (${parsedBiCreated} vs ${nowMs})`
  );

  await db.close();

  console.log('\n=============================================================');
  console.log(`  SCHEMA COMPATIBILITY TESTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('=============================================================\n');

  if (failed > 0) process.exit(1);
}

runSchemaCompatibilityTests().catch((err) => {
  console.error('Fatal schema compatibility test error:', err);
  process.exit(1);
});
