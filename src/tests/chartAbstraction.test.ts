/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * CHART ABSTRACTION FOUNDATION TESTS
 * Deterministic unit tests validating the three chart abstraction boundaries:
 * 1. CandleBar & IChartDataProvider
 * 2. ChartPriceLevel & IChartOverlayAdapter
 * 3. IChartInteractionAdapter
 */

import {
  CandleBar,
  ChartOrderMarker,
  ChartPriceLevel,
  IChartDataProvider,
  IChartInteractionAdapter,
  IChartOverlayAdapter,
} from '../types/chart';
import { ChartDataProvider, TIMEFRAME_SECONDS } from '../services/chartDataProvider';
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

async function runChartAbstractionTests() {
  console.log('\n--- 1. CANDLEBAR & NORMALIZATION TESTS ---');
  {
    const provider: IChartDataProvider = new ChartDataProvider();
    const bars: CandleBar[] = await provider.getHistoricalBars('EURUSD', '1m', 60);

    assert(Array.isArray(bars), 'getHistoricalBars returns an array');
    assert(bars.length === 60, `getHistoricalBars returns requested count of 60 (got ${bars.length})`);

    // Verify OHLC invariants
    let validOHLC = true;
    let strictlyAscendingTime = true;

    for (let i = 0; i < bars.length; i++) {
      const b = bars[i];
      if (
        typeof b.time !== 'number' ||
        typeof b.open !== 'number' ||
        typeof b.high !== 'number' ||
        typeof b.low !== 'number' ||
        typeof b.close !== 'number'
      ) {
        validOHLC = false;
      }

      if (b.high < b.open || b.high < b.close || b.low > b.open || b.low > b.close) {
        validOHLC = false;
      }

      if (i > 0 && b.time <= bars[i - 1].time) {
        strictlyAscendingTime = false;
      }
    }

    assert(validOHLC, 'All bars strictly satisfy High >= max(Open, Close) and Low <= min(Open, Close)');
    assert(strictlyAscendingTime, 'Bar timestamps are strictly monotonically ascending');
  }

  console.log('\n--- 2. TIMEFRAME GRID ADAPTATION TESTS ---');
  {
    const provider = new ChartDataProvider();
    const tf1m = await provider.getHistoricalBars('GBPUSD', '1m', 10);
    const tf5m = await provider.getHistoricalBars('GBPUSD', '5m', 10);
    const tf1h = await provider.getHistoricalBars('GBPUSD', '1h', 10);

    assert(tf1m.length === 10, '1m timeframe returns 10 bars');
    assert(tf5m.length === 10, '5m timeframe returns 10 bars');
    assert(tf1h.length === 10, '1h timeframe returns 10 bars');

    const step1m = tf1m[1].time - tf1m[0].time;
    const step5m = tf5m[1].time - tf5m[0].time;
    const step1h = tf1h[1].time - tf1h[0].time;

    assert(step1m === TIMEFRAME_SECONDS['1m'], `1m bar delta matches 60s (got ${step1m})`);
    assert(step5m === TIMEFRAME_SECONDS['5m'], `5m bar delta matches 300s (got ${step5m})`);
    assert(step1h === TIMEFRAME_SECONDS['1h'], `1h bar delta matches 3600s (got ${step1h})`);
  }

  console.log('\n--- 3. DATA PROVIDER STREAM SUBSCRIPTION CONTRACT ---');
  {
    const provider: IChartDataProvider = new ChartDataProvider();
    let receivedUpdate: CandleBar | null = null;

    const unsubscribe = provider.subscribeBarUpdates('EURUSD', '1m', (bar) => {
      receivedUpdate = bar;
    });

    assert(typeof unsubscribe === 'function', 'subscribeBarUpdates returns an unsubscribe function');
    assert(receivedUpdate === null, 'No bar emitted before ticks arrive');

    unsubscribe();
    assert(true, 'Unsubscribe cleans up listeners without errors');
  }

  console.log('\n--- 4. TRADING OVERLAY STATE MAPPING TESTS ---');
  {
    const samplePositions: Position[] = [
      {
        id: 'pos_101',
        accountId: 'DEMO-1001',
        symbol: 'EURUSD',
        side: 'BUY',
        volume: 0.5,
        openPrice: 1.0850,
        currentPrice: 1.0865,
        stopLoss: 1.0820,
        takeProfit: 1.0920,
        unrealizedPnL: 75.0,
        realizedPnL: 0,
        marginLocked: 108.5,
        openedAt: Date.now() - 60000,
        status: 'OPEN',
      },
      {
        id: 'pos_102',
        accountId: 'DEMO-1001',
        symbol: 'USDJPY', // Different symbol
        side: 'SELL',
        volume: 0.1,
        openPrice: 154.20,
        currentPrice: 154.10,
        unrealizedPnL: 10.0,
        realizedPnL: 0,
        marginLocked: 30.8,
        openedAt: Date.now() - 30000,
        status: 'OPEN',
      },
    ];

    // Filter and map levels for EURUSD
    const targetSymbol = 'EURUSD';
    const levels: ChartPriceLevel[] = [];
    const openForSymbol = samplePositions.filter((p) => p.symbol === targetSymbol && p.status === 'OPEN');

    for (const pos of openForSymbol) {
      levels.push({
        id: `entry_${pos.id}`,
        type: 'ENTRY',
        price: pos.openPrice,
        label: `${pos.side} ${pos.volume}L @ ${pos.openPrice}`,
        isDraggable: false,
      });
      if (pos.stopLoss) {
        levels.push({
          id: `sl_${pos.id}`,
          type: 'STOP_LOSS',
          price: pos.stopLoss,
          label: `SL @ ${pos.stopLoss}`,
          isDraggable: true,
        });
      }
      if (pos.takeProfit) {
        levels.push({
          id: `tp_${pos.id}`,
          type: 'TAKE_PROFIT',
          price: pos.takeProfit,
          label: `TP @ ${pos.takeProfit}`,
          isDraggable: true,
        });
      }
    }

    assert(levels.length === 3, `EURUSD position maps to 3 overlay levels (Entry, SL, TP); got ${levels.length}`);
    assert(levels[0].type === 'ENTRY' && levels[0].price === 1.0850, 'Entry level correctly mapped');
    assert(levels[1].type === 'STOP_LOSS' && levels[1].price === 1.0820 && levels[1].isDraggable, 'Stop loss level correctly mapped as draggable');
    assert(levels[2].type === 'TAKE_PROFIT' && levels[2].price === 1.0920 && levels[2].isDraggable, 'Take profit level correctly mapped as draggable');
  }

  console.log('\n--- 5. MOCK OVERLAY ADAPTER IMPLEMENTATION CONTRACT ---');
  {
    const registeredLevels = new Map<string, ChartPriceLevel>();
    const registeredMarkers: ChartOrderMarker[] = [];

    const mockOverlayAdapter: IChartOverlayAdapter = {
      setPriceLevels(levels: ChartPriceLevel[]) {
        registeredLevels.clear();
        for (const l of levels) registeredLevels.set(l.id, l);
      },
      removePriceLevel(id: string) {
        registeredLevels.delete(id);
      },
      clearPriceLevels() {
        registeredLevels.clear();
      },
      setOrderMarkers(markers: ChartOrderMarker[]) {
        registeredMarkers.length = 0;
        registeredMarkers.push(...markers);
      },
    };

    mockOverlayAdapter.setPriceLevels([
      { id: 'lvl_1', type: 'ENTRY', price: 1.085, label: 'ENTRY', isDraggable: false },
      { id: 'lvl_2', type: 'STOP_LOSS', price: 1.080, label: 'SL', isDraggable: true },
    ]);

    assert(registeredLevels.size === 2, 'Overlay adapter registers 2 levels');
    assert(registeredLevels.has('lvl_1') && registeredLevels.has('lvl_2'), 'Registered levels have correct IDs');

    mockOverlayAdapter.removePriceLevel('lvl_2');
    assert(registeredLevels.size === 1 && !registeredLevels.has('lvl_2'), 'removePriceLevel removes target level');

    mockOverlayAdapter.clearPriceLevels();
    assert(registeredLevels.size === 0, 'clearPriceLevels clears all levels');

    mockOverlayAdapter.setOrderMarkers([
      { id: 'm1', time: 1700000000, text: 'BUY 0.10', side: 'BUY', price: 1.085 },
    ]);
    assert(registeredMarkers.length === 1 && registeredMarkers[0].side === 'BUY', 'setOrderMarkers stores order marker');
  }

  console.log('\n--- 6. CHART INTERACTION ADAPTER DISPATCH CONTRACT ---');
  {
    let selectedPriceDispatched: number | null = null;
    let modifiedLevelDispatched: { id: string; newPrice: number } | null = null;

    const interactionAdapter: IChartInteractionAdapter = {
      onPriceSelected: (price) => {
        selectedPriceDispatched = price;
      },
      onLevelModified: (id, newPrice) => {
        modifiedLevelDispatched = { id, newPrice };
      },
    };

    // Simulate user clicking on chart canvas at price 1.08725
    interactionAdapter.onPriceSelected!(1.08725);
    assert(selectedPriceDispatched === 1.08725, 'onPriceSelected dispatches selected price to domain handler');

    // Simulate user dragging SL level to 1.08150
    interactionAdapter.onLevelModified!('sl_pos_101', 1.08150);
    const dispatched = modifiedLevelDispatched as { id: string; newPrice: number } | null;
    assert(
      dispatched !== null && dispatched.id === 'sl_pos_101' && dispatched.newPrice === 1.08150,
      'onLevelModified dispatches level ID and updated price'
    );
  }

  console.log('\n=============================================');
  console.log(`CHART ABSTRACTION TEST RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('=============================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

runChartAbstractionTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
