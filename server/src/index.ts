/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * SERVER ENTRYPOINT
 * Coordinates Express HTTP server, WebSocket server, and Trading Runtime.
 */

import 'dotenv/config';
import express, { Express, Request, Response } from 'express';
import { createServer, Server as HttpServer } from 'http';
import { TradingRuntime } from './runtime/TradingRuntime';
import { TradingWebSocketServer } from './ws/wsServer';
import { createAdminRouter } from './admin/adminRouter';

export interface AppServerContext {
  app: Express;
  httpServer: HttpServer;
  runtime: TradingRuntime;
  wsServer: TradingWebSocketServer;
}

export function createAppAndServer(): AppServerContext {
  const app = express();
  app.use(express.json());

  const runtime = new TradingRuntime();
  runtime.start();

  const httpServer = createServer(app);
  const wsServer = new TradingWebSocketServer(httpServer, runtime, '/ws');

  // Health check endpoint
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'trading-terminal-runtime',
      timestamp: Date.now(),
      uptime: Math.floor((Date.now() - runtime.startedAt) / 1000),
    });
  });

  // Admin & runtime inspection routes
  app.use('/api/runtime', createAdminRouter(runtime));

  return { app, httpServer, runtime, wsServer };
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
