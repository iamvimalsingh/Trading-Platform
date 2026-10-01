/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * SERVER ENTRYPOINT
 * Coordinates Express HTTP server, WebSocket server, and Trading Runtime.
 */

import 'dotenv/config';
import express, { Express, Request, Response, NextFunction } from 'express';
import { createServer, Server as HttpServer } from 'http';
import { TradingRuntime } from './runtime/TradingRuntime';
import { TradingWebSocketServer } from './ws/wsServer';
import { createAdminRouter } from './admin/adminRouter';
import { createTradingAdminRouter } from './admin/tradingAdminRouter';
import { TradingAdminService } from './admin/TradingAdminService';
import { PostgresAuditRepository } from './repositories/PostgresAuditRepository';
import { PostgresSpreadRepository } from './repositories/PostgresSpreadRepository';
import { PostgresSymbolRepository } from './repositories/PostgresSymbolRepository';
import { AdminSpreadPricingPolicy } from './market/AdminSpreadPricingPolicy';
import { DatabaseClient } from './db/DatabaseClient';
import { HistoricalMarketDataService } from './market/HistoricalMarketDataService';
import { createMarketRouter } from './market/marketRouter';

export interface AppServerContext {
  app: Express;
  httpServer: HttpServer;
  runtime: TradingRuntime;
  wsServer: TradingWebSocketServer;
  adminService: TradingAdminService;
  historicalService: HistoricalMarketDataService;
}

export function createAppAndServer(): AppServerContext {
  const app = express();
  app.use(express.json());

  const runtime = new TradingRuntime();
  runtime.start();

  const db = DatabaseClient.getInstance();
  const auditRepo = new PostgresAuditRepository(db);
  const spreadRepo = new PostgresSpreadRepository(db);
  const symbolRepo = new PostgresSymbolRepository(db);
  const spreadPolicy = new AdminSpreadPricingPolicy();
  const historicalService = HistoricalMarketDataService.getInstance();

  // If market data provider supports pricingPolicy, wire AdminSpreadPricingPolicy into it
  if (runtime.market && (runtime.market as any).setPricingPolicy) {
    (runtime.market as any).setPricingPolicy(spreadPolicy);
  }

  const adminService = new TradingAdminService(runtime, auditRepo, spreadRepo, symbolRepo, spreadPolicy);
  adminService.init().catch((err) => console.warn('[TradingAdminService] Non-fatal startup hydration:', err));

  const httpServer = createServer(app);
  const wsServer = new TradingWebSocketServer(httpServer, runtime, '/ws');

  // Root service status endpoint (Production only; in development, / serves Vite frontend UI)
  if (process.env.NODE_ENV === 'production') {
    app.get('/', (_req: Request, res: Response) => {
      res.json({
        status: 'ok',
        service: 'trading-platform-engine',
        version: '1.0.0',
        websocket: '/ws',
        uptime: Math.floor((Date.now() - runtime.startedAt) / 1000),
        endpoints: {
          health: '/health',
          stats: '/api/runtime/stats',
          market: '/api/market',
          admin: '/api/admin/trading',
        },
      });
    });
  }

  // Health check endpoint
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'trading-terminal-runtime',
      timestamp: Date.now(),
      uptime: Math.floor((Date.now() - runtime.startedAt) / 1000),
    });
  });

  // Read-only runtime inspection routes (backward compatibility)
  app.use('/api/runtime', createAdminRouter(runtime));

  // Authoritative Authenticated CRM Admin Trading API (Step 5)
  app.use('/api/admin/trading', createTradingAdminRouter(adminService));

  // Authoritative Market Data & Historical OHLC API (Step 6)
  app.use('/api/market', createMarketRouter(historicalService, runtime));

  return { app, httpServer, runtime, wsServer, adminService, historicalService };
}

export function startServer(port: number = 3000): Promise<AppServerContext> {
  return new Promise((resolve) => {
    const context = createAppAndServer();
    context.httpServer.listen(port, '0.0.0.0', () => {
      console.log(`[Trading Runtime] Authoritative Server running on http://0.0.0.0:${port}`);
      console.log(`[Trading Runtime] WebSocket endpoint: ws://0.0.0.0:${port}/ws`);
      console.log(`[Trading Runtime] Admin endpoints: http://0.0.0.0:${port}/api/runtime/stats`);
      resolve(context);
    });
  });
}

// Allow direct execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = parseInt(process.env.PORT || '3000', 10);
  startServer(port);
}
