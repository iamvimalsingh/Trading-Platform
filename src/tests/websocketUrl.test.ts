/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * T4A.8 WEBSOCKET URL CONFIGURATION & RESOLUTION TEST SUITE
 * Validates:
 * 1. Explicit VITE_WS_URL environment variable handling.
 * 2. Same-origin fallback resolution for local and production hosts.
 * 3. Protocol matching (HTTP -> ws://, HTTPS -> wss://).
 * 4. Normalization and prevention of duplicate paths (e.g. avoiding /ws/ws).
 * 5. Whitespace and trailing slash trimming.
 */

import { resolveWebSocketUrl } from '../services/tradingSocket';

let passCount = 0;
let failCount = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${testName}`);
    passCount++;
  } else {
    console.error(`  ✗ FAIL: ${testName}${detail ? ` (${detail})` : ''}`);
    failCount++;
  }
}

async function runWebSocketUrlTests() {
  console.log('\n=============================================================');
  console.log('  T4A.8 — WEBSOCKET URL RESOLUTION TESTS');
  console.log('=============================================================');

  console.log('\n--- TEST A: VITE_WS_URL Present Uses Configured URL ---');
  {
    const configured = 'wss://trading-api.example.com/ws';
    const resolved = resolveWebSocketUrl(configured, { protocol: 'https:', host: 'my-app.vercel.app' });
    assert(resolved === configured, `Uses configured WSS URL (got ${resolved})`);
  }

  console.log('\n--- TEST B: VITE_WS_URL Absent Uses Same-Origin Fallback ---');
  {
    const resolvedEmpty = resolveWebSocketUrl('', { protocol: 'https:', host: 'app.example.com' });
    const resolvedUndef = resolveWebSocketUrl(undefined, { protocol: 'https:', host: 'app.example.com' });

    assert(resolvedEmpty === 'wss://app.example.com/ws', `Empty string falls back to same-origin (got ${resolvedEmpty})`);
    assert(resolvedUndef === 'wss://app.example.com/ws', `Undefined falls back to same-origin (got ${resolvedUndef})`);
  }

  console.log('\n--- TEST C: HTTPS Page Without Env Yields WSS ---');
  {
    const resolved = resolveWebSocketUrl(undefined, { protocol: 'https:', host: 'trading.domain.com' });
    assert(resolved === 'wss://trading.domain.com/ws', `HTTPS page resolves to wss:// (got ${resolved})`);
  }

  console.log('\n--- TEST D: HTTP Page Without Env Yields WS ---');
  {
    const resolved = resolveWebSocketUrl(undefined, { protocol: 'http:', host: 'localhost:3000' });
    assert(resolved === 'ws://localhost:3000/ws', `HTTP localhost resolves to ws:// (got ${resolved})`);
  }

  console.log('\n--- TEST E: Configured URL Already Ending With /ws Prevents Duplicate ---');
  {
    const resolvedA = resolveWebSocketUrl('wss://backend.example.com/ws', { protocol: 'https:', host: 'app.vercel.app' });
    const resolvedB = resolveWebSocketUrl('wss://backend.example.com/ws/', { protocol: 'https:', host: 'app.vercel.app' });

    assert(resolvedA === 'wss://backend.example.com/ws', `Exact /ws path preserved without duplicate (got ${resolvedA})`);
    assert(resolvedB === 'wss://backend.example.com/ws', `Trailing slash stripped without duplicate /ws (got ${resolvedB})`);
    assert(!resolvedA.includes('/ws/ws'), 'No double /ws/ws created');
    assert(!resolvedB.includes('/ws/ws'), 'No double /ws/ws created with trailing slash');
  }

  console.log('\n--- TEST F: Configured Host Without /ws Appends Exactly Once ---');
  {
    const resolvedDomain = resolveWebSocketUrl('wss://backend.example.com', { protocol: 'https:', host: 'app.vercel.app' });
    const resolvedHttps = resolveWebSocketUrl('https://backend.example.com', { protocol: 'https:', host: 'app.vercel.app' });
    const resolvedHttp = resolveWebSocketUrl('http://127.0.0.1:8080', { protocol: 'http:', host: 'localhost:3000' });

    assert(resolvedDomain === 'wss://backend.example.com/ws', `Appends /ws to bare domain (got ${resolvedDomain})`);
    assert(resolvedHttps === 'wss://backend.example.com/ws', `Converts https:// and appends /ws (got ${resolvedHttps})`);
    assert(resolvedHttp === 'ws://127.0.0.1:8080/ws', `Converts http:// and appends /ws (got ${resolvedHttp})`);
  }

  console.log('\n--- TEST G: Whitespace Trimming & Robust Input Handling ---');
  {
    const resolvedPadded = resolveWebSocketUrl('  wss://backend.example.com/ws  ');
    assert(resolvedPadded === 'wss://backend.example.com/ws', `Trims whitespace cleanly (got ${resolvedPadded})`);

    const resolvedBare = resolveWebSocketUrl('backend.example.com');
    assert(resolvedBare === 'wss://backend.example.com/ws', `Bare host defaults to wss:// and appends /ws (got ${resolvedBare})`);
  }

  console.log('\n=============================================================');
  console.log(`TOTAL WEBSOCKET URL TESTS: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('=============================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

runWebSocketUrlTests().catch((err) => {
  console.error('Test run failed:', err);
  process.exit(1);
});
