/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * TARGETED DATABASE CONNECTION STABILITY TEST
 * Validates:
 * 1. pg.Pool maximum client configuration is clamped to 5
 * 2. DatabaseClient singleton & idempotent initialization
 * 3. DatabaseClient.close() cleanly releases resources
 */

import assert from 'node:assert/strict';
import { DatabaseClient } from '../db/DatabaseClient';

async function runTests() {
  console.log('--- Starting Database Connection Stability Tests ---');

  // Test 1: Configured pool max is 5
  console.log('[Test 1] Verifying application-side pool max is 5...');
  const db1 = DatabaseClient.getInstance();
  assert.equal(db1.getPoolMax(), 5, 'DatabaseClient pool max must be configured to 5');
  console.log('✓ Pool max = 5 confirmed');

  // Test 2: Singleton behavior
  console.log('[Test 2] Verifying singleton instance identity...');
  const db2 = DatabaseClient.getInstance();
  assert.strictEqual(db1, db2, 'DatabaseClient.getInstance() must return the identical singleton instance');
  console.log('✓ Singleton instance confirmed');

  // Test 3: Idempotent initialization
  console.log('[Test 3] Verifying idempotent init() calls...');
  await db1.init();
  assert.equal(db1.isReady(), true, 'DatabaseClient should be ready after init()');

  // Call init() repeatedly
  await Promise.all([db1.init(), db1.init(), db1.init()]);
  assert.equal(db1.isReady(), true, 'DatabaseClient remains ready after multiple concurrent init() calls');
  console.log('✓ Idempotent init() confirmed');

  // Test 4: Resource release on close()
  console.log('[Test 4] Verifying graceful close() and resource release...');
  await db1.close();
  assert.equal(db1.isReady(), false, 'DatabaseClient should not be ready after close()');

  // Double close() should be safe and idempotent
  await db1.close();
  assert.equal(db1.isReady(), false, 'Subsequent close() calls should safely succeed');
  console.log('✓ Graceful close() and release confirmed');

  // Clean up
  DatabaseClient.resetInstance();

  console.log('--- All Database Connection Stability Tests Passed ---');
}

runTests().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
