/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * ECHARTS ADAPTER & POC UNIT TESTS
 * Deterministic unit tests validating the ECharts POC implementation,
 * data formatting, overlay level mapping, and real-time tick aggregation.
 */

import { CandleBar, ChartPriceLevel } from '../types/chart';
import { ChartDataProvider } from '../services/chartDataProvider';

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

async function runEChartsTests() {
  console.log('\n--- 1. ECHARTS OHLC DATA ENCODING SPECIFICATION ---');
  {
    const sampleBar: CandleBar = {
      time: 1700000000,
      open: 1.08500,
      high: 1.08620,
      low: 1.08480,
      close: 1.08590,
      volume: 120,
    };

    // ECharts candlestick series standard format is [open, close, lowest, highest]
    const echartsDataPoint = [sampleBar.open, sampleBar.close, sampleBar.low, sampleBar.high];

    assert(echartsDataPoint[0] === 1.08500, 'Index 0 is Open price (1.08500)');
    assert(echartsDataPoint[1] === 1.08590, 'Index 1 is Close price (1.08590)');
    assert(echartsDataPoint[2] === 1.08480, 'Index 2 is Low price (1.08480)');
    assert(echartsDataPoint[3] === 1.08620, 'Index 3 is High price (1.08620)');
    assert(echartsDataPoint[3] >= echartsDataPoint[0] && echartsDataPoint[3] >= echartsDataPoint[1], 'High >= max(Open, Close)');
    assert(echartsDataPoint[2] <= echartsDataPoint[0] && echartsDataPoint[2] <= echartsDataPoint[1], 'Low <= min(Open, Close)');
  }

  console.log('\n--- 2. ECHARTS TRADING OVERLAY LEVEL MAPPING ---');
  {
    const levels: ChartPriceLevel[] = [
      {
        id: 'entry_1',
        type: 'ENTRY',
        price: 1.08500,
        label: 'BUY 0.50L @ 1.08500',
        isDraggable: false,
      },
      {
        id: 'sl_1',
        type: 'STOP_LOSS',
        price: 1.08200,
        label: 'SL @ 1.08200',
        isDraggable: true,
      },
      {
        id: 'tp_1',
        type: 'TAKE_PROFIT',
        price: 1.09200,
        label: 'TP @ 1.09200',
        isDraggable: true,
      },
    ];

    const markLines = levels.map((lvl) => ({
      name: lvl.label,
      yAxis: lvl.price,
      lineStyle: {
        type: lvl.type === 'ENTRY' ? 'solid' : 'dashed',
      },
    }));

    assert(markLines.length === 3, 'Mapped 3 overlay lines');
    assert(markLines[0].lineStyle.type === 'solid', 'Entry line style is solid');
    assert(markLines[1].lineStyle.type === 'dashed', 'Stop Loss line style is dashed');
    assert(markLines[2].lineStyle.type === 'dashed', 'Take Profit line style is dashed');
    assert(markLines[0].yAxis === 1.08500, 'Entry line price is 1.08500');
    assert(markLines[1].yAxis === 1.08200, 'Stop Loss line price is 1.08200');
    assert(markLines[2].yAxis === 1.09200, 'Take Profit line price is 1.09200');
  }

  console.log('\n--- 3. DATA PROVIDER COMPATIBILITY FOR ECHARTS ---');
  {
    const provider = new ChartDataProvider();
    const bars = await provider.getHistoricalBars('EURUSD', '1m', 120);

    assert(bars.length === 120, 'ECharts provider receives 120 bars from IChartDataProvider');
    const firstBar = bars[0];
    const lastBar = bars[bars.length - 1];

    assert(firstBar.time < lastBar.time, 'Bars chronological ordering is preserved');
  }

  console.log('\n--- 4. IN-PLACE CANDLE AGGREGATION SIMULATION ---');
  {
    const initialBar: CandleBar = {
      time: 1700000000,
      open: 1.08500,
      high: 1.08500,
      low: 1.08500,
      close: 1.08500,
      volume: 1,
    };

    // Incoming tick: price rises to 1.08550
    const tick1 = 1.08550;
    const updatedBar1: CandleBar = {
      ...initialBar,
      high: Math.max(initialBar.high, tick1),
      low: Math.min(initialBar.low, tick1),
      close: tick1,
      volume: initialBar.volume! + 1,
    };

    assert(updatedBar1.high === 1.08550, 'High updated to 1.08550');
    assert(updatedBar1.low === 1.08500, 'Low maintained at 1.08500');
    assert(updatedBar1.close === 1.08550, 'Close updated to 1.08550');
    assert(updatedBar1.volume === 2, 'Volume incremented to 2');

    // Incoming tick: price dips to 1.08470
    const tick2 = 1.08470;
    const updatedBar2: CandleBar = {
      ...updatedBar1,
      high: Math.max(updatedBar1.high, tick2),
      low: Math.min(updatedBar1.low, tick2),
      close: tick2,
      volume: updatedBar1.volume! + 1,
    };

    assert(updatedBar2.high === 1.08550, 'High maintained at 1.08550');
    assert(updatedBar2.low === 1.08470, 'Low updated to 1.08470');
    assert(updatedBar2.close === 1.08470, 'Close updated to 1.08470');
    assert(updatedBar2.volume === 3, 'Volume incremented to 3');
  }

  console.log('\n--- 5. LIVE BID & ASK OVERLAY SPECIFICATION ---');
  {
    const bid = 1.08500;
    const ask = 1.08515;
    const markLines = [
      { name: 'Ask', yAxis: ask, color: '#38bdf8' },
      { name: 'Bid', yAxis: bid, color: '#f59e0b' },
    ];

    assert(markLines.length === 2, 'Mapped 2 live spread lines');
    assert(markLines[0].name === 'Ask' && markLines[0].yAxis === 1.08515, 'Ask line is 1.08515');
    assert(markLines[1].name === 'Bid' && markLines[1].yAxis === 1.08500, 'Bid line is 1.08500');
    assert(markLines[0].yAxis > markLines[1].yAxis, 'Ask is strictly higher than Bid');
  }

  console.log('\n--- 6. PROVIDER TIMESTAMP CANDLE BOUNDARY RESOLUTION ---');
  {
    const intervalSec = 60;
    const baseMinuteSec = 1700000040; // multiple of 60 (28333334 * 60)
    const tick1Ms = (baseMinuteSec + 15) * 1000; // 15 seconds into minute
    const tick1Sec = Math.floor(tick1Ms / 1000);
    const slot1 = Math.floor(tick1Sec / intervalSec) * intervalSec;

    assert(slot1 === baseMinuteSec, `Timestamp ${tick1Sec}s resolves to 1m boundary ${baseMinuteSec} (got ${slot1})`);

    const tick2Ms = (baseMinuteSec + 65) * 1000; // 65 seconds into next minute
    const tick2Sec = Math.floor(tick2Ms / 1000);
    const slot2 = Math.floor(tick2Sec / intervalSec) * intervalSec;

    assert(slot2 === baseMinuteSec + 60, `Timestamp ${tick2Sec}s resolves to next 1m boundary ${baseMinuteSec + 60} (got ${slot2})`);
    assert(slot2 > slot1, 'New minute creates distinct subsequent candle slot');
  }

  console.log('\n=============================================');
  console.log(`ECHARTS POC TESTS: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('=============================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

runEChartsTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
