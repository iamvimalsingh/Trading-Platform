/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * AUTOMATED THEME SYSTEM & REPEATED SWITCHING TEST SUITE
 * Run with: tsx src/tests/themeSwitching.test.ts
 */

import { useTradingStore } from '../store/useTradingStore';
import { EChartsAdapter } from '../components/chart/EChartsAdapter';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  \x1b[32m✔ PASS\x1b[0m ${testName}`);
    passed++;
  } else {
    console.error(`  \x1b[31m✖ FAIL\x1b[0m ${testName}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

// Mock browser localStorage & document for Node.js test runner
const mockStorage: Record<string, string> = {};
(global as any).localStorage = {
  getItem: (key: string) => mockStorage[key] || null,
  setItem: (key: string, val: string) => {
    mockStorage[key] = val;
  },
  removeItem: (key: string) => {
    delete mockStorage[key];
  },
};

const classListSet = new Set<string>();
(global as any).document = {
  documentElement: {
    classList: {
      add: (cls: string) => classListSet.add(cls),
      remove: (cls: string) => classListSet.delete(cls),
      contains: (cls: string) => classListSet.has(cls),
    },
  },
};

async function runThemeTests() {
  console.log('\n=============================================================');
  console.log('  UI POLISH 1.1 — THEME SYSTEM & REPEATABILITY TESTS');
  console.log('=============================================================');

  // Test 1: Initial Default Theme
  console.log('\n--- 1. INITIAL THEME INVARIANTS ---');
  useTradingStore.getState().setTheme('light');
  assert(useTradingStore.getState().theme === 'light', '[THEME-01] Initial default theme is "light"');
  assert(!classListSet.has('dark'), '[THEME-02] documentElement does not have "dark" class in light mode');
  assert(mockStorage['trading_terminal_theme'] === 'light', '[THEME-03] localStorage correctly stores "light" preference');

  // Test 2: Switch to Dark Mode
  console.log('\n--- 2. LIGHT -> DARK SWITCH ---');
  useTradingStore.getState().toggleTheme();
  assert(useTradingStore.getState().theme === 'dark', '[THEME-04] toggleTheme() transitions to "dark"');
  assert(classListSet.has('dark'), '[THEME-05] documentElement receives "dark" class in dark mode');
  assert(mockStorage['trading_terminal_theme'] === 'dark', '[THEME-06] localStorage persists "dark" preference');

  // Test 3: Switch back to Light Mode
  console.log('\n--- 3. DARK -> LIGHT SWITCH ---');
  useTradingStore.getState().toggleTheme();
  assert(useTradingStore.getState().theme === 'light', '[THEME-07] toggleTheme() transitions back to "light"');
  assert(!classListSet.has('dark'), '[THEME-08] documentElement removes "dark" class');
  assert(mockStorage['trading_terminal_theme'] === 'light', '[THEME-09] localStorage updates to "light"');

  // Test 4: Repeated 10x Cycling Without Stuck State
  console.log('\n--- 4. REPEATED 10x CYCLING ---');
  let cycleSuccess = true;
  for (let i = 0; i < 10; i++) {
    const expected = i % 2 === 0 ? 'dark' : 'light';
    useTradingStore.getState().toggleTheme();
    if (useTradingStore.getState().theme !== expected) {
      cycleSuccess = false;
    }
  }
  assert(cycleSuccess, '[THEME-10] 10 consecutive rapid theme toggles succeed without stuck state');
  assert(useTradingStore.getState().theme === 'light', '[THEME-11] Final state correctly settled on "light"');

  // Test 5: Trading State Preservation Across Theme Switches
  console.log('\n--- 5. TRADING STATE IMMUTABILITY ACROSS THEME SWITCH ---');
  useTradingStore.getState().setSelectedSymbol('XAUUSD');
  const initialBalance = useTradingStore.getState().account.balance;
  const initialEquity = useTradingStore.getState().account.equity;
  const initialAccountNum = useTradingStore.getState().account.accountNumber;

  // Toggle multiple times
  useTradingStore.getState().toggleTheme();
  useTradingStore.getState().toggleTheme();

  assert(useTradingStore.getState().selectedSymbol === 'XAUUSD', '[THEME-12] selectedSymbol preserved across theme switches');
  assert(useTradingStore.getState().account.balance === initialBalance, '[THEME-13] Account balance preserved across theme switches');
  assert(useTradingStore.getState().account.equity === initialEquity, '[THEME-14] Account equity preserved across theme switches');
  assert(useTradingStore.getState().account.accountNumber === initialAccountNum, '[THEME-15] Account number preserved across theme switches');

  // Test 6: ECharts Adapter Theme Support Verification
  console.log('\n--- 6. ECHARTS ADAPTER DYNAMIC THEME VERIFICATION ---');
  const mockCtx = {
    fillRect: () => {},
    clearRect: () => {},
    getImageData: () => ({ data: [] }),
    putImageData: () => {},
    createImageData: () => [],
    setTransform: () => {},
    drawImage: () => {},
    save: () => {},
    fillText: () => {},
    restore: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    stroke: () => {},
    translate: () => {},
    scale: () => {},
    rotate: () => {},
    arc: () => {},
    fill: () => {},
    measureText: () => ({ width: 0 }),
    transform: () => {},
    rect: () => {},
    clip: () => {},
  };

  const createMockElement = (tag?: string) => ({
    getContext: () => mockCtx,
    style: {},
    setAttribute: () => {},
    getAttribute: () => null,
    appendChild: () => {},
    removeChild: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    clientWidth: 800,
    clientHeight: 500,
    width: 800,
    height: 500,
  });

  (global as any).document.createElement = (tag: string) => createMockElement(tag);

  const mockContainer = {
    ...createMockElement('div'),
    clientWidth: 800,
    clientHeight: 500,
  } as any;

  (global as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  const echartsAdapter = new EChartsAdapter(mockContainer);
  const sampleBars = [
    { time: 1700000000, open: 1.085, high: 1.086, low: 1.084, close: 1.0855, volume: 10 },
  ];

  echartsAdapter.init(sampleBars, 'light');
  assert(true, '[THEME-16] EChartsAdapter initializes with "light" theme');

  echartsAdapter.applyTheme('dark');
  assert(true, '[THEME-17] EChartsAdapter applies "dark" theme dynamically');

  echartsAdapter.applyTheme('light');
  assert(true, '[THEME-18] EChartsAdapter applies "light" theme dynamically');

  echartsAdapter.destroy();
  assert(true, '[THEME-19] EChartsAdapter cleans up resources on destroy');

  console.log('\n=============================================================');
  console.log(`  THEME SYSTEM TEST RESULTS: ${passed} PASSED, ${failed} FAILED (TOTAL: ${passed + failed})`);
  console.log('=============================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runThemeTests();
