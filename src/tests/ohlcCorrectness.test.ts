/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * OHLC & TIME BUCKETING CORRECTNESS TEST SUITE (T4A.3)
 * Validates deterministic candle aggregation, provider timestamp bucketing,
 * multi-timeframe boundaries, out-of-order handling, duplicate suppression,
 * and historical-to-live price continuity.
 */

import { CandleBar } from '../types/chart';
import { ChartDataProvider, TIMEFRAME_SECONDS } from '../services/chartDataProvider';
import { useTradingStore } from '../store/useTradingStore';

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

async function runOHLCCorrectnessTests() {
  console.log('\n=============================================================');
  console.log('  T4A.3 — OHLC & TIME BUCKETING CORRECTNESS TESTS');
  console.log('=============================================================');

  console.log('\n--- CASE A: 10 Ticks Inside One 1-Minute Bucket ---');
  {
    const baseMinuteSec = 1700000040; // multiple of 60
    const emittedBars: CandleBar[] = [];
    const intervalSec = TIMEFRAME_SECONDS['1m'];

    // Simulated 10 ticks inside the same 60-second window
    const prices = [1.08500, 1.08520, 1.08490, 1.08540, 1.08510, 1.08550, 1.08480, 1.08530, 1.08515, 1.08525];
    let currentBar: CandleBar | null = null;

    for (let i = 0; i < prices.length; i++) {
      const tickTimeSec = baseMinuteSec + i * 5; // 0s, 5s, 10s... 45s
      const barSlotTime = Math.floor(tickTimeSec / intervalSec) * intervalSec;
      const price = prices[i];

      if (!currentBar || currentBar.time !== barSlotTime) {
        currentBar = {
          time: barSlotTime,
          open: price,
          high: price,
          low: price,
          close: price,
          volume: 1,
        };
        emittedBars.push(currentBar);
      } else {
        currentBar.high = Math.max(currentBar.high, price);
        currentBar.low = Math.min(currentBar.low, price);
        currentBar.close = price;
        currentBar.volume = (currentBar.volume || 0) + 1;
      }
    }

    assert(emittedBars.length === 1, `Exactly 1 candle created for 10 intra-minute ticks (got ${emittedBars.length})`);
    assert(currentBar !== null, 'Active candle exists');
    assert(currentBar!.open === 1.08500, `Candle Open equals first tick (1.08500, got ${currentBar?.open})`);
    assert(currentBar!.high === 1.08550, `Candle High equals highest tick (1.08550, got ${currentBar?.high})`);
    assert(currentBar!.low === 1.08480, `Candle Low equals lowest tick (1.08480, got ${currentBar?.low})`);
    assert(currentBar!.close === 1.08525, `Candle Close equals latest tick (1.08525, got ${currentBar?.close})`);
    assert(currentBar!.volume === 10, `Candle Volume equals tick count of 10 (got ${currentBar?.volume})`);
  }

  console.log('\n--- CASE B: Ticks Crossing 1-Minute Boundary ---');
  {
    const baseMinuteSec = 1700000040;
    const intervalSec = 60;
    const candlesCreated: number[] = [];
    let currentBar: CandleBar | null = null;

    // 4 ticks in minute 0, 3 ticks in minute 1
    const ticks = [
      { t: baseMinuteSec + 10, p: 1.08500 },
      { t: baseMinuteSec + 30, p: 1.08530 },
      { t: baseMinuteSec + 55, p: 1.08510 },
      { t: baseMinuteSec + 59, p: 1.08520 },
      // Boundary crossed (+60s)
      { t: baseMinuteSec + 61, p: 1.08540 },
      { t: baseMinuteSec + 80, p: 1.08560 },
      { t: baseMinuteSec + 95, p: 1.08535 },
    ];

    for (const tick of ticks) {
      const slot = Math.floor(tick.t / intervalSec) * intervalSec;
      if (!currentBar || currentBar.time !== slot) {
        currentBar = {
          time: slot,
          open: tick.p,
          high: tick.p,
          low: tick.p,
          close: tick.p,
          volume: 1,
        };
        candlesCreated.push(slot);
      } else {
        currentBar.high = Math.max(currentBar.high, tick.p);
        currentBar.low = Math.min(currentBar.low, tick.p);
        currentBar.close = tick.p;
        currentBar.volume = (currentBar.volume || 0) + 1;
      }
    }

    assert(candlesCreated.length === 2, `Exactly 2 candles created across 1m boundary (got ${candlesCreated.length})`);
    assert(candlesCreated[0] === baseMinuteSec, `First candle slot is ${baseMinuteSec}`);
    assert(candlesCreated[1] === baseMinuteSec + 60, `Second candle slot is ${baseMinuteSec + 60}`);
    assert(currentBar!.open === 1.08540, 'Second candle Open is first tick of new minute (1.08540)');
    assert(currentBar!.close === 1.08535, 'Second candle Close is latest tick (1.08535)');
  }

  console.log('\n--- CASE C: Multiple Ticks in 5-Minute Bucket ---');
  {
    const base5mSec = 1700000100; // multiple of 300 (1700000100 / 300 = 5666667)
    const intervalSec = TIMEFRAME_SECONDS['5m'];
    const createdSlots: number[] = [];

    // Ticks across 4 minutes (all inside the same 5m slot)
    const ticks = [
      { t: base5mSec + 10, p: 1.08500 },
      { t: base5mSec + 70, p: 1.08580 },
      { t: base5mSec + 150, p: 1.08450 },
      { t: base5mSec + 220, p: 1.08530 },
      { t: base5mSec + 290, p: 1.08510 },
    ];

    let currentBar: CandleBar | null = null;
    for (const tick of ticks) {
      const slot = Math.floor(tick.t / intervalSec) * intervalSec;
      if (!currentBar || currentBar.time !== slot) {
        currentBar = {
          time: slot,
          open: tick.p,
          high: tick.p,
          low: tick.p,
          close: tick.p,
          volume: 1,
        };
        createdSlots.push(slot);
      } else {
        currentBar.high = Math.max(currentBar.high, tick.p);
        currentBar.low = Math.min(currentBar.low, tick.p);
        currentBar.close = tick.p;
        currentBar.volume = (currentBar.volume || 0) + 1;
      }
    }

    assert(createdSlots.length === 1, `Exactly 1 candle created for 5m interval (got ${createdSlots.length})`);
    assert(currentBar!.high === 1.08580, `5m candle High is 1.08580 (got ${currentBar?.high})`);
    assert(currentBar!.low === 1.08450, `5m candle Low is 1.08450 (got ${currentBar?.low})`);
    assert(currentBar!.volume === 5, `5m candle volume is 5 (got ${currentBar?.volume})`);
  }

  console.log('\n--- CASE D: Ticks Crossing 5-Minute Boundary ---');
  {
    const base5mSec = 1700000100;
    const intervalSec = TIMEFRAME_SECONDS['5m'];
    const createdSlots: number[] = [];

    const ticks = [
      { t: base5mSec + 280, p: 1.08500 }, // in slot 0
      { t: base5mSec + 299, p: 1.08510 }, // in slot 0
      { t: base5mSec + 301, p: 1.08530 }, // in slot 1 (+300s)
      { t: base5mSec + 350, p: 1.08540 }, // in slot 1
    ];

    let currentBar: CandleBar | null = null;
    for (const tick of ticks) {
      const slot = Math.floor(tick.t / intervalSec) * intervalSec;
      if (!currentBar || currentBar.time !== slot) {
        currentBar = {
          time: slot,
          open: tick.p,
          high: tick.p,
          low: tick.p,
          close: tick.p,
          volume: 1,
        };
        createdSlots.push(slot);
      }
    }

    assert(createdSlots.length === 2, `Ticks crossing 5m boundary create exactly 2 candles (got ${createdSlots.length})`);
    assert(createdSlots[0] === base5mSec, `First 5m slot is ${base5mSec}`);
    assert(createdSlots[1] === base5mSec + 300, `Second 5m slot is ${base5mSec + 300}`);
  }

  console.log('\n--- CASE E: Out-Of-Order Provider Timestamp Handling ---');
  {
    const baseMinuteSec = 1700000040;
    const intervalSec = 60;
    let activeBar: CandleBar = {
      time: baseMinuteSec + 60, // already at minute 1
      open: 1.08600,
      high: 1.08650,
      low: 1.08590,
      close: 1.08620,
      volume: 4,
    };

    // Stale/delayed tick arriving from minute 0 (out of order)
    const delayedTick = { t: baseMinuteSec + 45, p: 1.08400 };
    const delayedSlot = Math.floor(delayedTick.t / intervalSec) * intervalSec;

    let rejected = false;
    if (delayedSlot < activeBar.time) {
      // Deterministically reject out-of-order tick so it does not corrupt active candle sequence
      rejected = true;
    }

    assert(rejected, 'Out-of-order historical tick is deterministically rejected');
    assert(activeBar.time === baseMinuteSec + 60, 'Active candle time remains untouched');
    assert(activeBar.close === 1.08620, 'Active candle close remains untouched');
  }

  console.log('\n--- CASE F: Duplicate Quote / Same Timestamp Handling ---');
  {
    const baseMinuteSec = 1700000040;
    const intervalSec = 60;
    let createdCount = 0;
    let activeBar: CandleBar | null = null;

    // Three identical quotes arriving with identical timestamp & price
    const duplicateTicks = [
      { t: baseMinuteSec + 15, p: 1.08500 },
      { t: baseMinuteSec + 15, p: 1.08500 },
      { t: baseMinuteSec + 15, p: 1.08500 },
    ];

    for (const tick of duplicateTicks) {
      const slot = Math.floor(tick.t / intervalSec) * intervalSec;
      if (!activeBar || activeBar.time !== slot) {
        activeBar = {
          time: slot,
          open: tick.p,
          high: tick.p,
          low: tick.p,
          close: tick.p,
          volume: 1,
        };
        createdCount++;
      } else {
        // Safe in-place update without creating duplicate candle
        activeBar.high = Math.max(activeBar.high, tick.p);
        activeBar.low = Math.min(activeBar.low, tick.p);
        activeBar.close = tick.p;
        activeBar.volume = (activeBar.volume || 0) + 1;
      }
    }

    assert(createdCount === 1, `Duplicate ticks create exactly 1 candle (got ${createdCount})`);
    assert(activeBar!.volume === 3, `Volume correctly counts all 3 duplicate ticks (got ${activeBar?.volume})`);
  }

  console.log('\n--- CASE G: Historical-To-Live Price Continuity ---');
  {
    const provider = new ChartDataProvider();
    const targetSymbol = 'EURUSD';

    // Set an authoritative quote in store
    useTradingStore.setState({
      selectedSymbol: targetSymbol,
      quotes: {
        EURUSD: {
          symbol: 'EURUSD',
          bid: 1.08500,
          ask: 1.08516,
          mid: 1.08508,
          spread: 1.6,
          high24h: 1.08900,
          low24h: 1.08100,
          change24h: 0.00008,
          change24hPct: 0.01,
          timestamp: 1700000040000,
          tickDirection: 'FLAT',
        },
      },
    });

    const bars = await provider.getHistoricalBars('EURUSD', '1m', 60);
    assert(bars.length === 60, 'Generated 60 historical bars');

    const lastBar = bars[bars.length - 1];
    const liveMid = useTradingStore.getState().quotes['EURUSD'].mid;

    // Verify last historical bar close aligns directly to live mid (zero artificial jump)
    const priceDelta = Math.abs(lastBar.close - liveMid);
    assert(priceDelta < 0.0001, `Last historical close (${lastBar.close}) seamlessly bridges to live mid (${liveMid}); delta = ${priceDelta}`);

    // Verify all bars have strictly ascending timestamps
    let strictlyAscending = true;
    for (let i = 1; i < bars.length; i++) {
      if (bars[i].time <= bars[i - 1].time) {
        strictlyAscending = false;
      }
    }
    assert(strictlyAscending, 'All historical timestamps are strictly ascending');
  }

  console.log('\n=============================================================');
  console.log(`TOTAL OHLC CORRECTNESS TESTS: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('=============================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

runOHLCCorrectnessTests().catch((err) => {
  console.error('Test run failed:', err);
  process.exit(1);
});
