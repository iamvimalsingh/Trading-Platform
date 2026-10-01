/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * T3B SERVER-AUTHORITATIVE EXECUTION & RISK CORRECTNESS TEST SUITE
 * Verifies:
 * 1. Trigger-time risk revalidation (insufficient free margin / account status).
 * 2. Multi-order same-tick margin race protection.
 * 3. Atomicity and duplicate trigger protection.
 * 4. Pending order SL/TP semantics (all 16 combinations: 4 order types x 4 SL/TP configs).
 * 5. Lifecycle consistency and invalid operation rejection on terminal states.
 */

import { WebSocket } from 'ws';
import { createAppAndServer } from '../index';
import { Quote, SymbolConfig, TradingAccount } from '../types/trading';
import { WsEnvelope } from '../ws/wsProtocol';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testNum: number, name: string, detail?: string) {
  if (condition) {
    console.log(`  \x1b[32m✔ PASS [T3B-${testNum.toString().padStart(2, '0')}]\x1b[0m ${name}`);
    passed++;
  } else {
    console.error(`  \x1b[31m✖ FAIL [T3B-${testNum.toString().padStart(2, '0')}]\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

async function runT3BTests() {
  process.env.USE_REAL_MARKET_DATA = 'false';
  console.log('\n=============================================================');
  console.log('  RUNNING T3B EXECUTION & RISK CORRECTNESS HARDENING SUITE');
  console.log('=============================================================\n');

  const { app, httpServer, runtime, wsServer } = createAppAndServer();
  let serverPort = 0;

  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => {
      const address = httpServer.address() as any;
      serverPort = address.port;
      resolve();
    });
  });

  const wsUrl = `ws://127.0.0.1:${serverPort}/ws`;
  const clientWs = new WebSocket(wsUrl);
  const messagesReceived: WsEnvelope[] = [];

  clientWs.on('message', (data) => {
    try {
      messagesReceived.push(JSON.parse(data.toString()));
    } catch {
      // ignore
    }
  });

  await new Promise<void>((resolve) => {
    clientWs.on('open', () => resolve());
  });
  await new Promise((r) => setTimeout(r, 60));

  const demoAccount = runtime.accounts.getAccount('DEMO-1001')!;
  const eurCfg = runtime.market.getSymbolConfig('EURUSD')!;
  const eurQuote = runtime.market.getQuote('EURUSD')!;

  // =========================================================================
  // 1. TRIGGER-TIME RISK REVALIDATION: INSUFFICIENT FREE MARGIN
  // =========================================================================
  console.log('\n--- 1. TRIGGER-TIME RISK REVALIDATION (MARGIN AVAILABILITY) ---');
  
  // Place BUY LIMIT 20 pips below market with 2.0 lots (~$2,160 margin required)
  const buyLimitPrice = Number((eurQuote.ask - 0.0020).toFixed(5));
  const placeRes1 = runtime.orders.executeOrder(
    {
      accountId: demoAccount.id,
      symbol: 'EURUSD',
      side: 'BUY',
      type: 'LIMIT',
      volume: 2.0,
      requestedPrice: buyLimitPrice,
      clientOrderId: 'cli_t3b_risk_deplete',
    },
    demoAccount,
    eurQuote,
    eurCfg
  );
  const riskOrder1 = placeRes1.result.order;
  assert(riskOrder1.status === 'WORKING', 1, 'BUY LIMIT placed in WORKING state with valid pre-trade margin');

  // Deplete account free margin while order is still WORKING
  const originalFreeMargin = demoAccount.freeMargin;
  demoAccount.freeMargin = 50.00; // Drop available free margin to only $50.00
  runtime.accounts.updateAccount(demoAccount);

  // Market moves down to trigger price (Ask reaches buyLimitPrice)
  const triggerTick1: Quote = {
    ...eurQuote,
    bid: buyLimitPrice - 0.00010,
    ask: buyLimitPrice,
  };

  const triggerOutcomes1 = runtime.orders.checkWorkingOrderTriggers(
    'EURUSD',
    triggerTick1,
    eurCfg,
    (accId) => runtime.accounts.getAccount(accId)
  );
  const triggeredItem1 = triggerOutcomes1.find((t) => t.triggeredOrder.id === riskOrder1.id);

  assert(
    !!triggeredItem1 && triggeredItem1.triggeredOrder.status === 'REJECTED',
    2,
    'Trigger-time risk revalidation detects insufficient free margin and transitions order to REJECTED',
    `Status: ${triggeredItem1?.triggeredOrder.status}, Reason: ${triggeredItem1?.triggeredOrder.rejectReason}`
  );

  assert(
    !triggeredItem1?.positionTemplate,
    3,
    'No position template materialized when trigger risk validation fails'
  );

  assert(
    runtime.positions.getOpenPositionsForAccount(demoAccount.id).length === 0,
    4,
    'No position was created on the account when trigger risk validation failed'
  );

  assert(
    runtime.orders.getWorkingOrdersForAccount(demoAccount.id).every((o) => o.id !== riskOrder1.id),
    5,
    'Rejected order is cleanly removed from active working orders registry'
  );

  // Restore demo account free margin
  demoAccount.freeMargin = originalFreeMargin;
  runtime.accounts.updateAccount(demoAccount);

  // =========================================================================
  // 2. TRIGGER-TIME RISK REVALIDATION: ACCOUNT SUSPENDED
  // =========================================================================
  console.log('\n--- 2. TRIGGER-TIME RISK REVALIDATION (ACCOUNT STATUS) ---');
  
  const sellLimitPrice = Number((eurQuote.bid + 0.0020).toFixed(5));
  const placeRes2 = runtime.orders.executeOrder(
    {
      accountId: demoAccount.id,
      symbol: 'EURUSD',
      side: 'SELL',
      type: 'LIMIT',
      volume: 1.0,
      requestedPrice: sellLimitPrice,
      clientOrderId: 'cli_t3b_suspended_test',
    },
    demoAccount,
    eurQuote,
    eurCfg
  );
  const suspendedOrder = placeRes2.result.order;
  assert(suspendedOrder.status === 'WORKING', 6, 'SELL LIMIT placed in WORKING state while ACTIVE');

  // Change account status to SUSPENDED while order is pending
  demoAccount.status = 'SUSPENDED';
  runtime.accounts.updateAccount(demoAccount);

  // Market moves up to trigger price (Bid reaches sellLimitPrice)
  const triggerTick2: Quote = {
    ...eurQuote,
    bid: sellLimitPrice,
    ask: sellLimitPrice + 0.00010,
  };

  const triggerOutcomes2 = runtime.orders.checkWorkingOrderTriggers(
    'EURUSD',
    triggerTick2,
    eurCfg,
    (accId) => runtime.accounts.getAccount(accId)
  );
  const triggeredItem2 = triggerOutcomes2.find((t) => t.triggeredOrder.id === suspendedOrder.id);

  assert(
    !!triggeredItem2 && triggeredItem2.triggeredOrder.status === 'REJECTED' && (triggeredItem2.triggeredOrder.rejectReason?.includes('SUSPENDED') ?? false),
    7,
    'Trigger-time risk revalidation rejects order when account status is SUSPENDED',
    `Reason: ${triggeredItem2?.triggeredOrder.rejectReason}`
  );

  // Restore account status
  demoAccount.status = 'ACTIVE';
  runtime.accounts.updateAccount(demoAccount);

  // =========================================================================
  // 3. ATOMICITY & DUPLICATE TRIGGER PROTECTION
  // =========================================================================
  console.log('\n--- 3. ATOMICITY & DUPLICATE TRIGGER PROTECTION ---');

  const buyStopPrice = Number((eurQuote.ask + 0.0025).toFixed(5));
  const placeRes3 = runtime.orders.executeOrder(
    {
      accountId: demoAccount.id,
      symbol: 'EURUSD',
      side: 'BUY',
      type: 'STOP',
      volume: 0.50,
      requestedPrice: buyStopPrice,
      clientOrderId: 'cli_t3b_atomicity_test',
    },
    demoAccount,
    eurQuote,
    eurCfg
  );
  const stopOrder = placeRes3.result.order;
  assert(stopOrder.status === 'WORKING', 8, 'BUY STOP placed in WORKING state');

  const triggerTick3: Quote = {
    ...eurQuote,
    bid: buyStopPrice,
    ask: buyStopPrice + 0.00010,
  };

  // First trigger execution
  const triggerOutcomes3a = runtime.orders.checkWorkingOrderTriggers(
    'EURUSD',
    triggerTick3,
    eurCfg,
    (accId) => runtime.accounts.getAccount(accId)
  );
  const triggeredItem3a = triggerOutcomes3a.find((t) => t.triggeredOrder.id === stopOrder.id);
  assert(
    !!triggeredItem3a && triggeredItem3a.triggeredOrder.status === 'FILLED',
    9,
    'First trigger tick cleanly fills BUY STOP order'
  );

  // Second trigger attempt on identical quote (consecutive tick around trigger boundary)
  const triggerOutcomes3b = runtime.orders.checkWorkingOrderTriggers(
    'EURUSD',
    triggerTick3,
    eurCfg,
    (accId) => runtime.accounts.getAccount(accId)
  );
  const triggeredItem3b = triggerOutcomes3b.find((t) => t.triggeredOrder.id === stopOrder.id);
  assert(
    !triggeredItem3b,
    10,
    'Second trigger attempt is harmless and returns no trigger execution'
  );

  // Third trigger attempt on even higher quote
  const higherTick: Quote = {
    ...eurQuote,
    bid: buyStopPrice + 0.00100,
    ask: buyStopPrice + 0.00110,
  };
  const triggerOutcomes3c = runtime.orders.checkWorkingOrderTriggers(
    'EURUSD',
    higherTick,
    eurCfg,
    (accId) => runtime.accounts.getAccount(accId)
  );
  const triggeredItem3c = triggerOutcomes3c.find((t) => t.triggeredOrder.id === stopOrder.id);
  assert(
    !triggeredItem3c,
    11,
    'Subsequent higher tick does not trigger already-filled order'
  );

  // =========================================================================
  // 4. MULTI-ORDER SAME-TICK MARGIN RACE PROTECTION
  // =========================================================================
  console.log('\n--- 4. MULTI-ORDER SAME-TICK MARGIN RACE PROTECTION ---');

  // Account has $10,000 balance. Temporarily set freeMargin to $1,500.
  demoAccount.freeMargin = 1500.00;
  runtime.accounts.updateAccount(demoAccount);

  // Place Order A (requires ~$1,080 margin at 1.08000 for 1.0 lot at 1:100)
  const commonTriggerPrice = 1.08000;
  const placeA = runtime.orders.executeOrder(
    {
      accountId: demoAccount.id,
      symbol: 'EURUSD',
      side: 'BUY',
      type: 'LIMIT',
      volume: 1.0,
      requestedPrice: commonTriggerPrice,
      clientOrderId: 'cli_t3b_multi_a',
    },
    demoAccount,
    eurQuote,
    eurCfg
  );
  assert(placeA.result.order.status === 'WORKING', 12, 'Multi-order A placed in WORKING state');

  // Place Order B (also requires ~$1,080 margin at 1.08000 for 1.0 lot at 1:100)
  const placeB = runtime.orders.executeOrder(
    {
      accountId: demoAccount.id,
      symbol: 'EURUSD',
      side: 'BUY',
      type: 'LIMIT',
      volume: 1.0,
      requestedPrice: commonTriggerPrice,
      clientOrderId: 'cli_t3b_multi_b',
    },
    demoAccount,
    eurQuote,
    eurCfg
  );
  assert(placeB.result.order.status === 'WORKING', 13, 'Multi-order B placed in WORKING state');

  // Tick moves below 1.08000 triggering BOTH orders on the exact same tick
  const multiTriggerTick: Quote = {
    ...eurQuote,
    bid: 1.07980,
    ask: 1.07990,
  };

  const multiOutcomes = runtime.orders.checkWorkingOrderTriggers(
    'EURUSD',
    multiTriggerTick,
    eurCfg,
    (accId) => runtime.accounts.getAccount(accId)
  );

  const outcomeA = multiOutcomes.find((o) => o.triggeredOrder.id === placeA.result.order.id);
  const outcomeB = multiOutcomes.find((o) => o.triggeredOrder.id === placeB.result.order.id);

  assert(
    !!outcomeA && outcomeA.triggeredOrder.status === 'FILLED',
    14,
    'Order A consumes available margin and transitions to FILLED'
  );

  assert(
    !!outcomeB && outcomeB.triggeredOrder.status === 'REJECTED',
    15,
    'Order B is deterministically REJECTED on same tick due to depleted margin from Order A'
  );

  assert(
    !outcomeB?.positionTemplate,
    16,
    'Order B did not materialize a position template, preventing negative free margin'
  );

  // Clean up and reset demo account
  runtime.accounts.resetAccount(demoAccount.id);
  const freshDemoAccount = runtime.accounts.getAccount(demoAccount.id)!;

  // =========================================================================
  // 5. PENDING ORDER SL/TP SEMANTICS (ALL 16 COMBINATIONS)
  // =========================================================================
  console.log('\n--- 5. PENDING ORDER SL/TP SEMANTICS (16 COMBINATIONS) ---');

  const orderTypes: Array<'BUY LIMIT' | 'SELL LIMIT' | 'BUY STOP' | 'SELL STOP'> = [
    'BUY LIMIT',
    'SELL LIMIT',
    'BUY STOP',
    'SELL STOP',
  ];

  const slTpConfigs = [
    { name: 'No SL / No TP', slOffset: 0, tpOffset: 0 },
    { name: 'SL only', slOffset: 0.0030, tpOffset: 0 },
    { name: 'TP only', slOffset: 0, tpOffset: 0.0030 },
    { name: 'SL + TP', slOffset: 0.0030, tpOffset: 0.0030 },
  ];

  let comboIndex = 16;
  for (const oType of orderTypes) {
    const isBuy = oType.startsWith('BUY');
    const isLimit = oType.endsWith('LIMIT');
    const side = isBuy ? 'BUY' : 'SELL';
    const type = isLimit ? 'LIMIT' : 'STOP';

    for (const cfg of slTpConfigs) {
      comboIndex++;
      const currentRefQuote = runtime.market.getQuote('EURUSD')!;

      // Determine requested price that does not immediately trigger
      let requestedPrice: number;
      if (isLimit) {
        // BUY LIMIT below Ask, SELL LIMIT above Bid
        requestedPrice = isBuy
          ? Number((currentRefQuote.ask - 0.0050).toFixed(5))
          : Number((currentRefQuote.bid + 0.0050).toFixed(5));
      } else {
        // BUY STOP above Ask, SELL STOP below Bid
        requestedPrice = isBuy
          ? Number((currentRefQuote.ask + 0.0050).toFixed(5))
          : Number((currentRefQuote.bid - 0.0050).toFixed(5));
      }

      let stopLoss: number | undefined;
      let takeProfit: number | undefined;

      if (cfg.slOffset > 0) {
        stopLoss = isBuy
          ? Number((requestedPrice - cfg.slOffset).toFixed(5))
          : Number((requestedPrice + cfg.slOffset).toFixed(5));
      }
      if (cfg.tpOffset > 0) {
        takeProfit = isBuy
          ? Number((requestedPrice + cfg.tpOffset).toFixed(5))
          : Number((requestedPrice - cfg.tpOffset).toFixed(5));
      }

      // 1. Place order
      const clientOrderId = `cli_combo_${comboIndex}_${type}_${side}`;
      const placeOutcome = runtime.orders.executeOrder(
        {
          accountId: freshDemoAccount.id,
          symbol: 'EURUSD',
          side,
          type,
          volume: 0.10,
          requestedPrice,
          stopLoss,
          takeProfit,
          clientOrderId,
        },
        freshDemoAccount,
        currentRefQuote,
        eurCfg
      );

      const placedOrder = placeOutcome.result.order;
      const passWorking = placedOrder.status === 'WORKING';
      const passSLStored = placedOrder.stopLoss === stopLoss;
      const passTPStored = placedOrder.takeProfit === takeProfit;

      // 2. Simulate intermediate quote that crosses SL level while order is still WORKING
      // Must NOT trigger SL or position!
      if (stopLoss !== undefined) {
        const intermediateQuote: Quote = {
          ...currentRefQuote,
          bid: stopLoss,
          ask: stopLoss + 0.00010,
        };
        // PositionEngine should have 0 open positions for this order
        const openPosBefore = runtime.positions.getOpenPositionsForAccount(freshDemoAccount.id);
        const { triggeredCloses } = runtime.positions.updateMarkPriceAndCheckTriggers('EURUSD', intermediateQuote, eurCfg);
        assert(
          triggeredCloses.length === 0,
          comboIndex,
          `Pending order SL does not trigger while order is WORKING (${oType} - ${cfg.name})`
        );
      }

      // 3. Trigger the pending order
      let triggerQuote: Quote;
      if (isLimit) {
        triggerQuote = isBuy
          ? { ...currentRefQuote, bid: requestedPrice - 0.00010, ask: requestedPrice }
          : { ...currentRefQuote, bid: requestedPrice, ask: requestedPrice + 0.00010 };
      } else {
        triggerQuote = isBuy
          ? { ...currentRefQuote, bid: requestedPrice, ask: requestedPrice + 0.00010 }
          : { ...currentRefQuote, bid: requestedPrice - 0.00010, ask: requestedPrice };
      }

      const triggerOutcomes = runtime.orders.checkWorkingOrderTriggers(
        'EURUSD',
        triggerQuote,
        eurCfg,
        (accId) => runtime.accounts.getAccount(accId)
      );

      const executedItem = triggerOutcomes.find((t) => t.triggeredOrder.id === placedOrder.id);
      const passFilled = executedItem?.triggeredOrder.status === 'FILLED';
      const passSLTransferred = executedItem?.positionTemplate?.stopLoss === stopLoss;
      const passTPTransferred = executedItem?.positionTemplate?.takeProfit === takeProfit;

      assert(
        passWorking && passSLStored && passTPStored && passFilled && passSLTransferred && passTPTransferred,
        comboIndex,
        `SL/TP lifecycle invariant verified for ${oType} with ${cfg.name}`,
        `SL: ${executedItem?.positionTemplate?.stopLoss}, TP: ${executedItem?.positionTemplate?.takeProfit}`
      );

      // Clean up order and any positions for clean state in next iteration
      if (executedItem?.positionTemplate) {
        const openedPos = runtime.positions.openPosition(executedItem.positionTemplate);
        runtime.positions.closePosition(openedPos.id, currentRefQuote, eurCfg, 'MANUAL');
      }
    }
  }

  // =========================================================================
  // 6. INVALID OPERATIONS ON REJECTED ORDERS
  // =========================================================================
  console.log('\n--- 6. INVALID OPERATIONS REJECTION ON TERMINAL STATES ---');

  const cancelRejectedOutcome = runtime.orders.cancelWorkingOrder(riskOrder1.id, demoAccount.id);
  assert(
    cancelRejectedOutcome.success === false,
    33,
    'OrderEngine deterministically rejects CANCEL on REJECTED order',
    `Error: ${cancelRejectedOutcome.error}`
  );

  const replaceRejectedOutcome = runtime.orders.replaceWorkingOrder(
    { orderId: riskOrder1.id, requestedPrice: 1.09 },
    demoAccount.id,
    demoAccount,
    eurQuote,
    eurCfg
  );
  assert(
    replaceRejectedOutcome.success === false,
    34,
    'OrderEngine deterministically rejects REPLACE on REJECTED order',
    `Error: ${replaceRejectedOutcome.error}`
  );

  // Teardown
  clientWs.close();
  wsServer.close();
  httpServer.close();
  runtime.stop();

  console.log('\n-------------------------------------------------------------');
  console.log(`TOTAL T3B TESTS: ${passed + failed} | PASSED: \x1b[32m${passed}\x1b[0m | FAILED: \x1b[31m${failed}\x1b[0m`);
  console.log('-------------------------------------------------------------\n');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runT3BTests().catch((err) => {
  console.error('Fatal T3B test error:', err);
  process.exit(1);
});
