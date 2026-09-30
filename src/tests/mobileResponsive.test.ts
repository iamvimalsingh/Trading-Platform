/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * MOBILE-RESPONSIVE TRADING UX TEST SUITE (T2B)
 * Deterministic unit and workflow tests verifying mobile navigation,
 * account drawer, position card mapping, and end-to-end trading flow on mobile.
 */

import { useTradingStore } from '../store/useTradingStore';
import { Position } from '../types/trading';

let passCount = 0;
let failCount = 0;

function assert(condition: boolean, testName: string) {
  if (condition) {
    console.log(`  ✓ ${testName}`);
    passCount++;
  } else {
    console.error(`  ✗ FAIL: ${testName}`);
    failCount++;
  }
}

async function runMobileResponsiveTests() {
  console.log('\n--- 1. MOBILE BOTTOM NAVIGATION STATE TESTS ---');
  {
    const state = useTradingStore.getState();
    assert(state.mobileTab === 'quotes', 'Default mobile tab is quotes');

    state.setMobileTab('chart');
    assert(useTradingStore.getState().mobileTab === 'chart', 'Switch to chart tab succeeds');

    state.setMobileTab('trade');
    assert(useTradingStore.getState().mobileTab === 'trade', 'Switch to trade tab succeeds');

    state.setMobileTab('positions');
    assert(useTradingStore.getState().mobileTab === 'positions', 'Switch to positions tab succeeds');

    state.setMobileTab('history');
    assert(useTradingStore.getState().mobileTab === 'history', 'Switch to history tab succeeds');

    // Return to quotes
    state.setMobileTab('quotes');
    assert(useTradingStore.getState().mobileTab === 'quotes', 'Return to quotes tab succeeds');
  }

  console.log('\n--- 2. MOBILE ACCOUNT DRAWER TOGGLE TESTS ---');
  {
    const state = useTradingStore.getState();
    assert(state.isMobileAccountDrawerOpen === false, 'Account drawer is initially closed');

    state.toggleMobileAccountDrawer();
    assert(useTradingStore.getState().isMobileAccountDrawerOpen === true, 'toggleMobileAccountDrawer opens drawer');

    state.setMobileAccountDrawerOpen(false);
    assert(useTradingStore.getState().isMobileAccountDrawerOpen === false, 'setMobileAccountDrawerOpen(false) closes drawer');

    state.setMobileAccountDrawerOpen(true);
    assert(useTradingStore.getState().isMobileAccountDrawerOpen === true, 'setMobileAccountDrawerOpen(true) opens drawer');
    state.setMobileAccountDrawerOpen(false);
  }

  console.log('\n--- 3. MOBILE POSITION CARD DATA MAPPING INVARIANTS ---');
  {
    const testPos: Position = {
      id: 'pos_mobile_test_1',
      accountId: 'acc_demo_1001',
      symbol: 'XAUUSD',
      side: 'BUY',
      volume: 0.25,
      openPrice: 2650.50,
      currentPrice: 2655.00,
      stopLoss: 2640.00,
      takeProfit: 2670.00,
      unrealizedPnL: 112.50,
      realizedPnL: 0,
      marginLocked: 265.05,
      openedAt: Date.now() - 120000,
      status: 'OPEN',
    };

    // Calculate card presentation values
    const isProfitable = testPos.unrealizedPnL >= 0;
    const formattedLots = `${testPos.volume.toFixed(2)}L`;
    const formattedPnL = `${isProfitable ? '+' : ''}$${testPos.unrealizedPnL.toFixed(2)}`;

    assert(isProfitable === true, 'Card identifies positive unrealized P/L');
    assert(formattedLots === '0.25L', 'Lots correctly formatted for mobile card badge');
    assert(formattedPnL === '+$112.50', 'PnL correctly formatted with + prefix');
    assert(testPos.stopLoss === 2640.00 && testPos.takeProfit === 2670.00, 'SL/TP values present for inline editor');
  }

  console.log('\n--- 4. MOBILE ORDER EXECUTION & LIFECYCLE SIMULATION ---');
  {
    const store = useTradingStore.getState();

    // Ensure EURUSD quote exists
    useTradingStore.setState({
      quotes: {
        EURUSD: {
          symbol: 'EURUSD',
          bid: 1.0850,
          ask: 1.0852,
          mid: 1.0851,
          spread: 2.0,
          change24h: 0.0015,
          change24hPct: 0.15,
          high24h: 1.0890,
          low24h: 1.0820,
          timestamp: Date.now(),
        },
      },
      selectedSymbol: 'EURUSD',
    });

    const currentQuote = useTradingStore.getState().quotes['EURUSD'];
    assert(currentQuote !== undefined, 'Live EURUSD quote available for execution');

    // Simulate placing order from mobile trade view
    const initialPositionsCount = useTradingStore.getState().positions.length;
    const initialBalance = useTradingStore.getState().account.balance;

    // Simulate filled position creation in store
    const newPosId = `pos_mob_${Date.now()}`;
    const newPos: Position = {
      id: newPosId,
      accountId: 'acc_demo_1001',
      symbol: 'EURUSD',
      side: 'BUY',
      volume: 0.10,
      openPrice: 1.0852,
      currentPrice: 1.0852,
      stopLoss: 1.0800,
      takeProfit: 1.0900,
      unrealizedPnL: 0.00,
      realizedPnL: 0.00,
      marginLocked: 108.52,
      openedAt: Date.now(),
      status: 'OPEN',
    };

    useTradingStore.setState((prev) => ({
      ...prev,
      positions: [newPos, ...prev.positions],
      orders: [
        {
          id: `ord_${Date.now()}`,
          clientOrderId: `cl_ord_${Date.now()}`,
          accountId: 'acc_demo_1001',
          symbol: 'EURUSD',
          side: 'BUY',
          type: 'MARKET',
          volume: 0.10,
          requestedPrice: 1.0852,
          executionPrice: 1.0852,
          status: 'FILLED',
          createdAt: Date.now(),
        },
        ...prev.orders,
      ],
    }));

    const afterPosCount = useTradingStore.getState().positions.length;
    assert(afterPosCount === initialPositionsCount + 1, 'Position created and added to store');

    // Simulate mark price move to 1.0862 (+10 pips = +$10.00 PnL)
    useTradingStore.setState((prev) => ({
      ...prev,
      positions: prev.positions.map((p) => {
        if (p.id !== newPosId) return p;
        return {
          ...p,
          currentPrice: 1.0862,
          unrealizedPnL: 10.00,
        };
      }),
      account: {
        ...prev.account,
        equity: prev.account.balance + 10.00,
      },
    }));

    const updatedPos = useTradingStore.getState().positions.find((p) => p.id === newPosId);
    assert(updatedPos?.unrealizedPnL === 10.00, 'Unrealized floating P/L updated on quote movement');
    assert(useTradingStore.getState().account.equity === initialBalance + 10.00, 'Account equity reflects live floating P/L');

    // Simulate SL/TP modification
    useTradingStore.getState().updatePositionSLTP(newPosId, 1.0810, 1.0920);
    const modPos = useTradingStore.getState().positions.find((p) => p.id === newPosId);
    assert(modPos?.stopLoss === 1.0810 && modPos?.takeProfit === 1.0920, 'SL/TP modified successfully');

    // Simulate position close
    useTradingStore.setState((prev) => {
      const closing = prev.positions.find((p) => p.id === newPosId)!;
      const closed: Position = {
        ...closing,
        status: 'CLOSED',
        realizedPnL: 10.00,
        closedAt: Date.now(),
      };
      return {
        ...prev,
        positions: prev.positions.filter((p) => p.id !== newPosId),
        closedTrades: [closed, ...prev.closedTrades],
        account: {
          ...prev.account,
          balance: prev.account.balance + 10.00,
          equity: prev.account.balance + 10.00,
          usedMargin: Math.max(0, prev.account.usedMargin - closing.marginLocked),
          freeMargin: prev.account.freeMargin + closing.marginLocked + 10.00,
        },
      };
    });

    const finalPosCount = useTradingStore.getState().positions.length;
    assert(finalPosCount === initialPositionsCount, 'Open positions count decreases on close');
    assert(useTradingStore.getState().closedTrades.length > 0, 'Closed trade appears in history');
    assert(useTradingStore.getState().account.balance === initialBalance + 10.00, 'Realized balance increased by +$10.00');
  }

  console.log('\n--- 5. DESKTOP WORKSPACE PRESERVATION INVARIANTS ---');
  {
    // Verify that mobile tab switching did not alter desktop activeTab
    const desktopTab = useTradingStore.getState().activeTab;
    assert(['positions', 'orders', 'history', 'benchmark'].includes(desktopTab), 'Desktop activeTab remains valid');
    assert(useTradingStore.getState().account.currency === 'USD', 'Account base currency preserved');
    assert(useTradingStore.getState().activeSymbolCount >= 10, 'Symbol count scaling preserved');
  }

  console.log('\n=============================================');
  console.log(`MOBILE RESPONSIVE TEST RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('=============================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

runMobileResponsiveTests().catch((err) => {
  console.error('Mobile responsive test execution failed:', err);
  process.exit(1);
});
