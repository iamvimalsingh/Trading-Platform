# T0 — TRADING TERMINAL ARCHITECTURE DECISION DOCUMENT
**Document Version:** 1.0.0-T0  
**Status:** APPROVED FOR STAGE-1 IMPLEMENTATION & BENCHMARK SPIKES  
**Project:** Project B — High-Performance Trading Terminal  
**Boundary Isolation:** Decoupled from Project A (CRM Baseline)

---

## EXECUTIVE SUMMARY & MASTER ROADMAP

```
TRADING PLATFORM MASTER ROADMAP
├── T0: Foundation & Architecture Discovery (THIS DOCUMENT)
├── T1: Trading Contracts, Schemas & Core Data Models
├── T2: Market Data Architecture & Feed Ingestion Engine
├── T3: Order Lifecycle & Execution Matching Subsystem
├── T4: Position, Balance & Real-Time Risk Engine
├── T5: Fast-Loading Trading Terminal UI (Progressive Shell + Lightweight Charting)
├── T6: Dealer / Desk Operations & Risk Monitoring
├── T7: CRM Gateway & Secure Identity Handshake
├── T8: Multi-Tenancy, B2B White-Labeling & Theming
└── T9: Production Hardening, Edge Deployment & Broker/LP Adapters
```

---

## SECTION A: PRODUCT DEFINITION

### 1. Vision & Identity
The Trading Terminal is an **independent, execution-first, ultra-responsive financial trading workstation** designed for retail and professional traders. It is **not** a CRM module, an account management portal, or a bloated dashboard with an embedded chart widget.

### 2. Core Tenets
1. **Trading-First Primacy:** The viewport belongs to quotes, charts, order execution, and position management. Account administration (deposits, KYC, document uploads, profile editing) is strictly isolated to CRM boundaries.
2. **Sub-100ms Perceived Readiness:** Zero blocking calls on initial render. The critical path delivers an interactive UI shell and streaming quotes in < 500ms over median 4G networks.
3. **Decoupled Autonomy:** The terminal operates as a standalone distributed system. A total CRM outage must never interrupt active tick streaming, order matching, or margin risk calculations.
4. **B2B / Multi-Tenant Native:** The architecture natively supports multi-tenant symbol configurations, leverage tiers, liquidity bridge routing, and white-label visual themes from day one without codebase divergence.

---

## SECTION B: CORE USER JOURNEY

```
+-----------------------------------------------------------------------------------+
|                              TRADING USER JOURNEY                                 |
+-----------------------------------------------------------------------------------+
|  1. ENTRY / AUTH                                                                  |
|     - Launch terminal URL (direct or via CRM SSO token launch)                    |
|     - Instant shell paint (<150ms) + Parallel Token Exchange & Account Hydration  |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
|  2. MARKET DISCOVERY (WATCHLIST / SYMBOL SELECTOR)                                |
|     - Active symbol subscription to L1 Price Feed                                 |
|     - Instant bid/ask ticker paint with hardware-accelerated flash indicators     |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
|  3. CHART & TECHNICAL CONTEXT                                                     |
|     - Lazy-loaded high-performance Canvas/WebGL chart engine                     |
|     - Parallel fetch of visible historical OHLCV bars                             |
|     - Seamless real-time bar aggregation from streaming ticks                    |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
|  4. ORDER FORMULATION & EXECUTION                                                 |
|     - Instant pre-trade risk check on client (optimistic validation)              |
|     - Direct binary/compact JSON order submit to Execution Gateway                |
|     - Immediate visual receipt + ACK state (<30ms round-trip over WS)             |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
|  5. POSITION & MARGIN LIFECYCLE MANAGEMENT                                        |
|     - Streaming mark-to-market unrealized P/L at tick frequency                   |
|     - One-click close / partial close / SL-TP modification                        |
|     - Continuous real-time margin level & liquidation distance monitoring         |
+-----------------------------------------------------------------------------------+
```

---

## SECTION C & D: RECOMMENDED TECHNOLOGY STACK & SELECTION RATIONALE

| Layer | Recommended Technology | Alternatives Considered | Why Selected | Performance & Complexity Impact | Future Migration Implications |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Frontend Framework** | **React 19 + TypeScript** (Vite Bundler, Rollup, ESM) | Solid.js, Svelte 5, Vue 3, Next.js (SSR) | React 19 provides fine-grained concurrent rendering, compiler optimizations, top-tier financial chart integration libraries, and ecosystem maturity. Client-side Vite SPA completely eliminates SSR overhead for auth-gated trading apps. | Zero SSR latency; bundle size minimized through selective tree-shaking and dynamic import splitting. | Standard React component model allows easy portability into native wrappers (Electron, Tauri, React Native/Capacitor). |
| **State Management** | **Zustand (Slice Architecture) + Transient Subscriptions** | Redux Toolkit, MobX, Jotai, Context API | Zustand allows non-React subscribers (listening to 50-100 ticks/sec without triggering component tree re-renders) while exposing selector hooks for UI nodes. | Sub-millisecond state mutations; zero selector boilerplate; memory footprint < 2MB. | Easily swappable; models are pure TS interfaces. |
| **Chart Engine** | **Lightweight Charts v4 (TradingView Canvas)** with lazy dynamic loader | Full TradingView Charting Library (UDF), Chart.js, Highcharts, D3.js | Canvas-based rendering, ~45KB gzipped footprint (vs 2.5MB for full TradingView library), 60 FPS zoom/pan, native OHLCV & line rendering, zero licensing friction for initial phase. | Minimal initial bundle impact (dynamic import); high GPU-assisted rendering efficiency. | Extension point prepared for swapping to Full TradingView Charting Library via a unified adapter interface if advanced drawing tools/indicators are required in Phase T5. |
| **Data Grid & Virtualization** | **TanStack Virtual (React-Virtual)** | AG Grid Enterprise, React-Window, Virtuoso | Lightweight (<12KB), framework-agnostic core, headless UI flexibility for ultra-dense watchlists and order history books. AG Grid is too heavy (>500KB) for initial load budget. | Constant O(1) DOM node count regardless of 5,000+ symbol watchlist size. | Easy to upgrade to AG-Grid Enterprise later if institutional multi-column pivot grids are mandated. |
| **Realtime Transport** | **WebSocket (Primary) with RFC 6455 + SSE Fallback** | HTTP Polling, gRPC-Web, WebTransport | Bidirectional, low-overhead framing (2-6 bytes per frame), universally supported across corporate firewalls and cloud proxies. | Sub-5ms transport latency; minimal CPU overhead vs polling. | WebTransport can be plugged into the connection abstraction layer when browser/edge support matures. |
| **Wire Protocol (Data)** | **Compact JSON (T0/T1) -> Binary FlatBuffers/MessagePack (T2+)** | Protobuf, XML, Plain Text CSV | Structured JSON allows rapid development and debugging in T0/T1. MessagePack/FlatBuffers provides zero-copy deserialization for high-throughput ticks in T2. | T0: Low dev complexity; T2: 70% bandwidth reduction and 4x faster JS parsing. | Gateway schema versioning is built into the envelope from day one. |
| **Backend Gateway / Service Layer** | **Node.js (TypeScript) + Fastify / Express** with async worker queues | Go (Golang), Rust, Java Netty, Python FastAPI | Unified TypeScript types shared between client and server (`/shared/types`). Event-loop model is ideal for I/O-bound WS routing. | High developer velocity; microsecond routing overhead in Fastify. | High-throughput execution engine components can be isolated and rewritten in Go/Rust if order volume exceeds 50k ops/sec. |
| **In-Memory Cache & Tick Bus** | **Redis (Streams & Pub/Sub) / In-Memory Ring Buffers** | RabbitMQ, Kafka, NATS | Redis Streams provides sub-millisecond Pub/Sub for symbol ticks, fast state snapshots for order books, and lightweight persistence. | <1ms pub/sub latency across distributed cluster nodes. | Drop-in NATS migration if multi-region active-active cluster is deployed. |
| **Persistent Database** | **PostgreSQL (TimescaleDB extension for ticks/candles)** | MongoDB, MySQL, Cassandra | ACID compliance for ledger, balances, orders, and position state; Timescale hypertables for high-speed historical candle compression and time-series querying. | Absolute transactional integrity; zero risk of ledger balance corruption. | Standard SQL dialect enables easy sharding and managed hosting on Cloud SQL, AWS RDS, or Neon. |

---

## SECTION E: FRONTEND ARCHITECTURE

```
                               +---------------------------------------+
                               |         INDEX.HTML (5 KB)             |
                               |  - Critical CSS Inline                |
                               |  - Skeleton Wireframe UI Shell        |
                               |  - Preconnect WS & API Origins        |
                               +---------------------------------------+
                                                   |
                                                   v
                               +---------------------------------------+
                               |     MAIN ENTRY BUNDLE (<75 KB GZ)     |
                               |  - Auth & Session Initializer         |
                               |  - WebSocket Client Core              |
                               |  - Zustand Root Store Engine          |
                               +---------------------------------------+
                                                   |
                        +--------------------------+--------------------------+
                        |                                                     |
                        v                                                     v
        +-------------------------------+                     +-------------------------------+
        |   IMMEDIATE CRITICAL MODULES  |                     |      LAZY-LOADED MODULES      |
        |   - Top Navigation & Balance  |                     |   - Canvas Chart Engine (TV)  |
        |   - Virtualized Watchlist     |                     |   - Order History Modal       |
        |   - Quick Order Entry Ticket  |                     |   - Risk Analytics Modal      |
        |   - Open Positions Table      |                     |   - Settings & Theming Studio |
        +-------------------------------+                     +-------------------------------+
```

### Component Architecture & State Boundary Isolation
To eliminate unwanted re-renders during high-frequency tick updates (e.g., EURUSD fluctuating 40 times per second), the UI does **not** bind high-frequency prices to parent React components.

1. **Direct DOM Ref Price Updates:** Watchlist and Order Ticket quote components use direct DOM refs or isolated atom subscriptions (`useWatchlistPrice(symbol)`) so that only the exact 20-pixel price span re-renders/flashes.
2. **Batching Buffer:** Ticks arriving faster than 60 FPS (16.6ms) are collapsed in a client-side micro-buffer; the UI updates at `requestAnimationFrame` intervals, preventing main-thread UI thrashing.
3. **Web Worker Offloading (Optional for Indicators):** Heavy calculations (e.g., 200-period EMA, Bollinger Bands, ATR) run in a dedicated Web Worker without blocking UI interaction.

---

## SECTION F: BACKEND ARCHITECTURE

```
                                      [ CLIENT BROWSER ]
                                               |
                      +------------------------+------------------------+
                      | HTTPS (REST API)                                | WSS (Bidirectional)
                      v                                                 v
         +--------------------------+                      +--------------------------+
         |      API GATEWAY         |                      |    REALTIME WS GATEWAY   |
         |  - Rate Limiting         |                      |  - Connection Manager    |
         |  - JWT Auth Validation   |                      |  - Channel Subscriptions |
         |  - REST Request Routing  |                      |  - Heartbeat / Ping-Pong |
         +--------------------------+                      +--------------------------+
                      |                                                 |
         +------------+-------------------------------------------------+------------+
         |                                                                           |
         v                                                                           v
+--------------------------+  Order Event   +--------------------------+  Risk ACK  +--------------------------+
|      ORDER SERVICE       | ------------> |    RISK ENGINE (PRE)     | ---------> |     EXECUTION ENGINE     |
|  - Idempotency check     |                |  - Margin verification  |            |  - Internal Matcher /    |
|  - Order validation      | <------------ |  - Leverage limit check  |            |    LP Bridge Router      |
|  - State transitions     |  Reject Event  |  - Max drawdown check    |            |  - Fill state generation |
+--------------------------+                +--------------------------+            +--------------------------+
         |                                                                                       |
         | Position Update                                                                       | Fill Event
         v                                                                                       v
+---------------------------------------------------------------------------------------------------------------+
|                                            POSITION & MARGIN ENGINE                                           |
|  - Real-time mark-to-market valuation                                                                         |
|  - Balance / Equity / Used Margin / Free Margin / Margin Level calculation                                    |
|  - Liquidation trigger monitor                                                                                |
+---------------------------------------------------------------------------------------------------------------+
                                         |                                  |
                                         v                                  v
                            +--------------------------+      +--------------------------+
                            |     REDIS TICK BUS       |      |     POSTGRESQL ACID      |
                            |  - L1/L2 Price cache     |      |  - User Trading Accounts |
                            |  - Pub/Sub delta streams |      |  - Orders, Trades, Fills |
                            |  - Account session state |      |  - Position Ledgers      |
                            +--------------------------+      +--------------------------+
```

---

## SECTION G: FAST-LOADING ARCHITECTURE & STRATEGY

### The "Zero-Blank-Screen" Protocol
1. **Critical Path HTML/CSS:** The raw `index.html` file contains inline CSS for the dark-mode terminal layout grid, header placeholders, and widget skeletons. The user sees a structured layout in < 100ms.
2. **Parallel Handshake:**
   - Script 1: Authenticates token and pulls Account Snapshot (`/api/v1/account/state`).
   - Script 2: Concurrently opens WebSocket connection (`wss://stream...`).
   - Script 3: Loads symbol catalog and top-10 active watchlist prices.
3. **Lazy Chart Engine:** The chart canvas bundle (~45KB) is requested immediately after the shell renders, but never blocks the display of balance, watchlist, or order entry tickets.
4. **Asset Optimization:**
   - Modern Brotli/Gzip compression on all static assets.
   - Zero heavyweight web-font files (use native system typography font stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif`, or `Inter` variable font subsets).
   - All SVG trading icons bundled as inline symbols.

---

## SECTION H & I: REALTIME & MARKET-DATA ARCHITECTURE

```
+--------------------------+
|  EXTERNAL LIQUIDITY /    |
|  MARKET DATA FEEDS (L1)  |
+--------------------------+
             |
             v
+--------------------------+
| MARKET DATA FEED HANDLER |
|  - Normalization engine  |
|  - Spread engine (markup)|
|  - Spike filter / sanity |
+--------------------------+
             |
             v
+--------------------------+
|    REDIS TICK STREAM     |
+--------------------------+
             |
             +---------------------------------------+
             |                                       |
             v                                       v
+--------------------------+           +--------------------------+
|  CANDLE BUILDER SERVICE  |           |   WS STREAM DISPATCHER   |
|  - 1s, 1m, 5m, 1h, 1D    |           |  - Symbol multiplexing   |
|  - TimescaleDB ingestion |           |  - Client subscriptions  |
+--------------------------+           |  - Conflation / Throttler|
                                       +--------------------------+
                                                     |
                                                     v (WSS Frame)
                                       +--------------------------+
                                       |      BROWSER CLIENT      |
                                       |  - L1 Orderbook updates  |
                                       |  - Dynamic chart updates |
                                       |  - Position P/L ticker   |
                                       +--------------------------+
```

### Market-Data Protocols & Throttling
- **L1 Quotes:** Top of book (Symbol, Bid, Ask, Spread, High, Low, Timestamp).
- **Throttling/Conflation:** For extremely fast feeds (crypto/forex during news), ticks are conflated server-side to a max of 20-50ms intervals per symbol to prevent browser thread saturation.
- **Heartbeat Protocol:** Client sends `ping` every 15s; server responds with `pong`. If no `pong` within 5s, client transparently switches to reconnect with exponential backoff and buffer drain.

---

## SECTION J: TRADING DOMAIN BOUNDARIES

```
+----------------------------------------------------------------------------------------------------+
|                                      CRM DOMAIN (PROJECT A)                                        |
|  - Lead capture, KYC, Identity Verification, User Profile                                          |
|  - Payment Gateways, Fiat Deposits, Crypto Wallets, Withdrawals                                    |
|  - Marketing Automation, Affiliate Tracking, Support Tickets                                       |
+----------------------------------------------------------------------------------------------------+
                                                  |
                                (SECURE SIGNED S2S & TOKEN HANDSHAKE)
                                                  v
+----------------------------------------------------------------------------------------------------+
|                                TRADING PLATFORM DOMAIN (PROJECT B)                                 |
|  +------------------------+  +------------------------+  +------------------------+                |
|  |     ACCOUNT DOMAIN     |  |     ORDER DOMAIN       |  |    POSITION DOMAIN     |                |
|  | - Trading Account ID   |  | - Order Creation (New) |  | - Open Positions       |                |
|  | - Leverage & Group Config| - Order Types (MKT/LMT) |  | - Mark-to-Market P/L   |                |
|  | - Balance / Cash Ledger|  | - Order Status Machine |  | - SL / TP triggers     |                |
|  | - Currency denomination|  | - Fill & Trade Records |  | - Liquidation engine   |                |
|  +------------------------+  +------------------------+  +------------------------+                |
|  +------------------------+  +------------------------+  +------------------------+                |
|  |      RISK DOMAIN       |  |   MARKET DATA DOMAIN   |  |    EXECUTION DOMAIN    |                |
|  | - Pre-trade margin check| | - Symbol Catalog       |  | - Internal matching    |                |
|  | - Max exposure limits  |  | - L1 Streaming Tickers |  | - A-Book / B-Book route|                |
|  | - Stop-out threshold   |  | - Historical OHLCV Bars|  | - LP Adapter interface |                |
|  +------------------------+  +------------------------+  +------------------------+                |
+----------------------------------------------------------------------------------------------------+
```

---

## SECTION K: ACCOUNT MODEL DIRECTION

### Account Structure
```typescript
interface TradingAccount {
  id: string;                  // Unique Trading Account UUID
  tenantId: string;            // B2B Multi-tenant identifier
  crmUserId: string;           // External link to CRM User ID
  accountNumber: string;       // Human-readable (e.g., "1008291")
  currency: string;            // "USD", "EUR", "USDT"
  accountType: 'LIVE' | 'DEMO';
  leverage: number;            // e.g., 100 (1:100)
  balance: number;             // Realized cash balance (cents / decimal precision)
  equity: number;              // balance + unrealizedPnL
  usedMargin: number;          // Total margin required for open positions
  freeMargin: number;          // equity - usedMargin
  marginLevel: number;         // (equity / usedMargin) * 100
  marginCallLevel: number;     // Warning threshold (e.g. 100%)
  stopOutLevel: number;        // Liquidation threshold (e.g. 50%)
  status: 'ACTIVE' | 'READ_ONLY' | 'SUSPENDED';
  createdAt: string;
}
```

- **Double-Entry Ledger Principle:** Every financial movement (deposit, withdrawal, trade PnL credit, swap, commission) is stored as a dual-entry debit/credit ledger record. Balance is a computed/validated sum.

---

## SECTION L: ORDER & EXECUTION ARCHITECTURE

### Order Lifecycle State Machine
```
                      +-------------------+
                      |   ORDER PLACED    |
                      +-------------------+
                                |
                                v
                      +-------------------+
                      |  PRE-TRADE RISK   |
                      |  VALIDATION (ACK) |
                      +-------------------+
                                |
                +---------------+---------------+
                | (Pass)                        | (Fail: Insufficient Margin / Off-Market)
                v                               v
      +-------------------+           +-------------------+
      |      PENDING      |           |     REJECTED      |
      |     EXECUTION     |           +-------------------+
      +-------------------+
                |
        +-------+-------+
        | (Market)      | (Limit / Stop)
        v               v
+---------------+ +---------------+
|    FILLED     | |    WORKING    |
| (Open Pos.)   | | (Order Book)  |
+---------------+ +---------------+
                        |
            +-----------+-----------+
            | (Triggered)           | (User Cancel / Expire)
            v                       v
    +---------------+       +---------------+
    |    FILLED     |       |   CANCELLED   |
    +---------------+       +---------------+
```

### Supported Order Types for Phase 1
1. **Market Buy / Market Sell:** Immediate execution at prevailing Best Bid / Best Ask.
2. **Limit Orders (Buy Limit / Sell Limit):** Execution when market reaches target price or better.
3. **Stop Orders (Buy Stop / Sell Stop):** Breakout execution triggered at market price.
4. **Position Protection:** Stop Loss (SL) and Take Profit (TP) parameters bound directly to positions.

---

## SECTION M: POSITION & RISK ARCHITECTURE

### Position State & Real-Time Valuation
- **Position Entity:**
  - `id`: Position UUID
  - `tradingAccountId`: Account reference
  - `symbol`: e.g. "EURUSD", "BTCUSD"
  - `side`: "BUY" | "SELL"
  - `volumeLots`: Lot size / contract count
  - `openPrice`: Weighted average fill price
  - `currentPrice`: Dynamic streaming mark price (Bid for Longs, Ask for Shorts)
  - `unrealizedPnL`: `(currentPrice - openPrice) * volumeLots * contractSize * direction`
  - `stopLoss`: Optional price trigger
  - `takeProfit`: Optional price trigger
  - `marginRequirement`: Margin locked for this position

### Stop-Out & Auto-Liquidation Mechanism
1. The **Risk Engine Worker** continuously monitors all active accounts with open positions.
2. If `marginLevel <= stopOutLevel` (e.g. 50%):
   - Trigger Emergency Liquidation Event.
   - Liquidate largest losing position at current market price.
   - Re-evaluate margin level. Repeat if still below threshold.
   - Emit audit logs and notify client via high-priority WS event.

---

## SECTION N: API ARCHITECTURE

### 1. REST Endpoints (Command & Query)
- `POST /api/v1/auth/session/handshake` — Validates CRM launch token and issues short-lived Trading JWT.
- `GET  /api/v1/account/state` — Initial fast snapshot (Account, Open Positions, Pending Orders).
- `GET  /api/v1/symbols` — Symbol specifications (digits, contract size, min/max lot, trading hours).
- `GET  /api/v1/market/history?symbol=EURUSD&timeframe=1m&limit=500` — Compressed OHLCV bars.
- `POST /api/v1/orders/execute` — Fallback HTTP order entry endpoint.

### 2. WebSocket Real-Time Channel Spec
- **Connect:** `wss://stream.trade.example.com/v1?token=<JWT>`
- **Client Inbound Frames:**
  - `{"action": "subscribe", "channels": ["ticker:EURUSD", "ticker:BTCUSD"]}`
  - `{"action": "unsubscribe", "channels": ["ticker:XAUUSD"]}`
  - `{"action": "order.new", "reqId": "r_101", "data": {...}}`
  - `{"action": "order.cancel", "reqId": "r_102", "orderId": "..."}`
  - `{"action": "position.close", "reqId": "r_103", "positionId": "..."}`
- **Server Outbound Frames:**
  - `{"type": "ticker", "s": "EURUSD", "b": 1.08421, "a": 1.08432, "t": 1774438000000}`
  - `{"type": "account.delta", "equity": 10450.20, "unrealizedPnL": 450.20, "marginLevel": 520.5}`
  - `{"type": "order.ack", "reqId": "r_101", "orderId": "o_99", "status": "FILLED"}`
  - `{"type": "position.update", "position": {...}}`

---

## SECTION O: AUTHENTICATION & CRM INTEGRATION ARCHITECTURE

```
+------------------+                    +------------------+                    +------------------+
|    CRM SYSTEM    |                    |  CLIENT BROWSER  |                    | TRADING TERMINAL |
| (crm.domain.com) |                    |     (USER)       |                    | (trade.domain.com|
+------------------+                    +------------------+                    +------------------+
         |                                       |                                       |
         |  1. User clicks "Open Terminal"       |                                       |
         |-------------------------------------->|                                       |
         |                                       |                                       |
         |  2. CRM generates signed Launch Token |                                       |
         |     (HMAC-SHA256 / RSA Asymmetric)    |                                       |
         |     Payload: {userId, accountId, exp} |                                       |
         |-------------------------------------->|                                       |
         |                                       |                                       |
         |                                       |  3. Redirect or iframe launch with    |
         |                                       |     https://trade.domain.com#token=.. |
         |                                       |-------------------------------------->|
         |                                       |                                       |
         |                                       |                                       |  4. Terminal verifies
         |                                       |                                       |     token signature
         |                                       |                                       |     using Shared Key
         |                                       |                                       |     or JWKS Endpoint
         |                                       |                                       |
         |                                       |  5. Terminal responds with session    |
         |                                       |     JWT & initializes WS stream       |
         |                                       |<--------------------------------------|
```

### Security & Independence Guarantees
- **No Direct DB Access:** The Trading Platform does not connect to the CRM database.
- **Asymmetric Signature (RS256) or Shared Secret (HS256):** The CRM signs a one-time launch token valid for 30 seconds.
- **Independent Session Token:** Upon exchange, the Trading Terminal issues its own scoped, ephemeral session token.

---

## SECTION P: DATABASE ARCHITECTURE DIRECTION

```sql
-- Schema Blueprint (PostgreSQL / TimescaleDB)

-- 1. Tenants Table (Multi-tenancy)
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(32) UNIQUE NOT NULL,
    name VARCHAR(128) NOT NULL,
    domain VARCHAR(255) UNIQUE,
    branding_config JSONB NOT NULL DEFAULT '{}',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Trading Accounts
CREATE TABLE trading_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    crm_user_id VARCHAR(128) NOT NULL,
    account_number VARCHAR(32) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'USD',
    account_type VARCHAR(16) NOT NULL DEFAULT 'LIVE',
    leverage INT NOT NULL DEFAULT 100,
    balance NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
    credit NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
    status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unq_tenant_account UNIQUE (tenant_id, account_number)
);

-- 3. Symbols
CREATE TABLE symbols (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    symbol VARCHAR(32) NOT NULL,
    base_currency VARCHAR(10) NOT NULL,
    quote_currency VARCHAR(10) NOT NULL,
    digits INT NOT NULL DEFAULT 2,
    contract_size NUMERIC(18, 4) NOT NULL DEFAULT 1.0,
    min_volume NUMERIC(18, 4) NOT NULL DEFAULT 0.01,
    max_volume NUMERIC(18, 4) NOT NULL DEFAULT 100.0,
    volume_step NUMERIC(18, 4) NOT NULL DEFAULT 0.01,
    spread_markup_points NUMERIC(18, 4) NOT NULL DEFAULT 0.0,
    is_trading_enabled BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT unq_tenant_symbol UNIQUE (tenant_id, symbol)
);

-- 4. Orders
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    trading_account_id UUID NOT NULL REFERENCES trading_accounts(id),
    symbol VARCHAR(32) NOT NULL,
    side VARCHAR(8) NOT NULL, -- 'BUY', 'SELL'
    order_type VARCHAR(16) NOT NULL, -- 'MARKET', 'LIMIT', 'STOP'
    volume_lots NUMERIC(18, 4) NOT NULL,
    requested_price NUMERIC(18, 6),
    execution_price NUMERIC(18, 6),
    stop_loss NUMERIC(18, 6),
    take_profit NUMERIC(18, 6),
    status VARCHAR(16) NOT NULL, -- 'PENDING', 'FILLED', 'REJECTED', 'CANCELLED'
    reject_reason VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Positions
CREATE TABLE positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    trading_account_id UUID NOT NULL REFERENCES trading_accounts(id),
    symbol VARCHAR(32) NOT NULL,
    side VARCHAR(8) NOT NULL,
    volume_lots NUMERIC(18, 4) NOT NULL,
    open_price NUMERIC(18, 6) NOT NULL,
    current_price NUMERIC(18, 6) NOT NULL,
    stop_loss NUMERIC(18, 6),
    take_profit NUMERIC(18, 6),
    realized_pnl NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
    swap NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
    commission NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
    margin_locked NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
    status VARCHAR(16) NOT NULL DEFAULT 'OPEN', -- 'OPEN', 'CLOSED'
    opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ
);

-- 6. Financial Ledger (Double-Entry Audit)
CREATE TABLE account_ledger_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    trading_account_id UUID NOT NULL REFERENCES trading_accounts(id),
    entry_type VARCHAR(32) NOT NULL, -- 'DEPOSIT', 'WITHDRAWAL', 'TRADE_PNL', 'SWAP', 'COMMISSION'
    amount NUMERIC(18, 4) NOT NULL,
    balance_after NUMERIC(18, 4) NOT NULL,
    reference_id UUID, -- Links to position_id or order_id
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## SECTION Q: CACHING STRATEGY

1. **Static Assets (Client JS/CSS/SVGs):** Immutable cache headers (`Cache-Control: public, max-age=31536000, immutable`) served via global Edge CDN.
2. **Symbol Metadata & Specs:** Cached in client memory & IndexedDB with ETag validation. Updates rarely (daily/weekly).
3. **Historical Candles (Completed bars):** Cached in Redis and CDN edge; historical OHLCV for closed bars is immutable.
4. **Current Quote L1 & Active Order Books:** Held purely in Redis in-memory key-value and local Node.js memory buffers. Never hit PostgreSQL for live tick reading.

---

## SECTION R: PERFORMANCE BUDGET AND MEASURABLE TARGETS

| Metric | Target Budget (Hard Limit) | Optimization Mechanism |
| :--- | :--- | :--- |
| **Initial JS Bundle (Gzipped)** | **< 100 KB** (Critical path) | Aggressive Rollup dynamic imports, zero heavy CSS/icon dependencies |
| **First Contentful Paint (FCP)** | **< 200 ms** | Pre-rendered inline HTML/CSS skeleton UI |
| **Time to Interactive (TTI)** | **< 500 ms** | Parallel async hydration without blocking chart execution |
| **Chart Initial Render Time** | **< 250 ms** (from trigger) | Lightweight Charts canvas engine dynamic chunk |
| **Order Placement Round-Trip (ACK)**| **< 40 ms** (Client to Server WS)| Direct WebSocket binary/compact framing |
| **Price Tick UI Latency** | **< 16 ms** (60 FPS synchronization)| `requestAnimationFrame` tick batching buffer |
| **Memory Consumption (Browser)** | **< 45 MB** during continuous use | Object pooling for tick objects; bounded ring buffers for price charts |

---

## SECTION S & T: DEPLOYMENT ARCHITECTURE & EARLY-STAGE COST CONSIDERATIONS

### Deployment Architecture
- **Frontend SPA:** Deployed as static edge assets (Cloudflare Pages, Vercel, or Cloud Storage CDN).
- **Trading & Market Data Gateway:** Containerized Node.js service running on Google Cloud Run (scale-to-zero capability with minimal min-instance latency) or lightweight Kubernetes cluster.
- **Data Tier:** Managed PostgreSQL (Cloud SQL or Neon/Supabase Postgres) + Managed Redis (Upstash Redis or Cloud Memorystore).

### Early-Stage Free-Tier Feasibility
- Fastify/Node gateway easily stays within free-tier compute limits during development.
- Free-tier Redis / Upstash handles up to 10,000 commands/day.
- PostgreSQL database fits within Developer tier.

---

## SECTION U: MULTI-TENANT FUTURE ARCHITECTURE

1. **Tenant Identification:** Resolved via Subdomain (e.g. `broker-a.terminal.com`), custom CNAME (e.g. `trade.broker-a.com`), or JWT Tenant Claim (`tenantId`).
2. **Dynamic Theming Engine:** CSS Variables injected into document root dynamically at boot time:
   ```css
   :root {
     --color-brand-primary: #3b82f6;
     --color-trade-buy: #10b981;
     --color-trade-sell: #ef4444;
     --color-bg-base: #0b0e14;
   }
   ```
3. **Tenant-Isolated Symbol Configs:** Each tenant defines custom spread markups, available leverage, and allowed symbols without touching core engine logic.

---

## SECTION V: SECURITY ARCHITECTURE

1. **Strict Content Security Policy (CSP):** Disallow inline script injection (`'unsafe-inline'` blocked in production); restrict WS endpoints.
2. **Order Idempotency:** Every order submission carries a client-generated UUID (`clientOrderId`). Duplicates within a 5-minute window are rejected instantly.
3. **Rate Limiting & Anti-DDoS:** WebSocket connection rate limiting (max 10 new connections/min per IP; max 50 order actions/sec per account).
4. **Pre-Trade Risk Sandboxing:** Client-side optimistic risk check prevents malformed requests; server-side authoritative check guarantees solvency.

---

## SECTION W: OBSERVABILITY & LOGGING

1. **Structured JSON Logs:** All services emit structured logs with correlation IDs (`traceId`, `tenantId`, `accountId`).
2. **Metrics:** Real-time collection of:
   - WebSocket active connections & message throughput
   - Order execution latency distribution (p50, p95, p99)
   - Risk calculation tick-to-margin processing delay
3. **Audit Trail:** Immutable order execution logs stored for regulatory compliance.

---

## SECTION X: FUTURE EXTERNAL BROKER / LP ADAPTERS

```typescript
// Extensible Liquidity Provider Adapter Interface
export interface ILiquidityProviderAdapter {
  id: string;
  name: string;
  connect(): Promise<void>;
  subscribeMarketData(symbols: string[]): Promise<void>;
  sendOrder(order: ExecutionOrder): Promise<ExecutionReport>;
  cancelOrder(orderId: string): Promise<boolean>;
  onTick(callback: (tick: NormalizedTick) => void): void;
  onExecutionReport(callback: (report: ExecutionReport) => void): void;
}
```
*Adapters for FIX 4.4, Binance/Bybit API, Interactive Brokers, or MetaTrader Bridge can be introduced without altering internal order or position engine contracts.*

---

## SECTION Y: MAJOR ARCHITECTURAL RISKS & MITIGATION

| Risk | Impact | Mitigation Strategy |
| :--- | :--- | :--- |
| **React Re-render Thrashing** | High CPU, laggy UI on rapid market moves | Decouple streaming tickers from React state tree; use DOM refs & localized selector subscriptions. |
| **Websocket Connection Drops** | Trader blind to active market during volatility | Auto-reconnect with exponential backoff, state resynchronization request, and visual offline banner. |
| **Race Conditions in Margin Checks** | Negative balance on concurrent market orders | Database/Engine level row locking (`SELECT FOR UPDATE`) or single-threaded actor model per account. |
| **Clock Drift on Ticks / Orders** | Inaccurate candle construction | Server-authoritative timestamps on all ingested events. |

---

## SECTION Z: DECISIONS THAT MUST BE LOCKED BEFORE IMPLEMENTATION

### 1. LOCKED DECISIONS
1. **Repository & Build Architecture:** Single standalone Vite + React 19 + TypeScript SPA for Project B (zero shared bundle coupling with CRM).
2. **State Management Paradigm:** Zustand with decoupled transient subscribers for high-frequency market data.
3. **Primary Chart Engine for T0-T5:** TradingView Lightweight Charts (Canvas-based) dynamically loaded.
4. **Communication Protocol:** WebSocket as primary bidirectional streaming channel with structured JSON envelopes.
5. **Account & Risk Model:** Server-authoritative pre-trade risk engine with isolated Double-Entry Ledger.
6. **Authentication Protocol:** Ephemeral signed JWT launch token generated by CRM and exchanged for Trading Platform session.

### 2. OPEN DECISIONS (REQUIRING SPIKES/PROTOTYPES)
1. **[OPEN SPIKE 1] Protocol Serialization:** Evaluate whether JSON is sufficient for initial 100 symbols or if binary MessagePack should be adopted in T1.
2. **[OPEN SPIKE 2] Order Engine Isolation:** Determine whether to run the Matching Engine as an in-process Node.js worker or a separate microservice.
3. **[OPEN SPIKE 3] Chart Canvas FPS Benchmark:** Stress-test Lightweight Charts under 100 ticks/second with 10 active technical indicators.

---

## IMPLEMENTATION ROADMAP & IMMEDIATE NEXT STEPS

### 3. FIRST IMPLEMENTATION PHASE (T1)
- Define universal TypeScript interfaces & data contracts (`/src/types/trading.ts`): Symbol, Quote, Order, Position, Account, RiskRule, Ledger.
- Implement mock WebSocket Market Data Feed generator for reproducible deterministic local testing.

### 4. FIRST PERFORMANCE SPIKE
- Build a lightweight UI shell prototype measuring:
  - FCP and TTI under simulated 3G/4G throttling.
  - 60 FPS price ticker DOM updates with 50 simultaneous updating symbols.

### 5. WHAT WE SHOULD BUILD FIRST
- Core Trading Schema & Contract Types.
- Instant-render UI Shell wireframe with responsive layout grid (Watchlist, Chart container, Order Ticket, Positions Table).
- Mock Market Data WebSocket stream for L1 quotes.
- Local in-memory Order Placement & Position PnL calculator.

### 6. WHAT WE SHOULD NOT BUILD YET
- ❌ Do NOT build CRM UI, user registration, deposit/fiat flows, or profile editors.
- ❌ Do NOT integrate heavy third-party charting libraries (>500KB) before benchmarking.
- ❌ Do NOT connect to real live broker FIX liquidity adapters in this stage.
- ❌ Do NOT implement complex B2B billing or tenant management dashboards.

---
**End of T0 Architecture Decision Document**
