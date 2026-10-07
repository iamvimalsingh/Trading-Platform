/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * FULL-STACK DEV & PRODUCTION SERVER ENTRYPOINT
 * Integrates Authoritative Trading Backend with Vite frontend middlewares on port 3000.
 */

import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createAppAndServer } from './server/src/index';
import { DatabaseClient } from './server/src/db/DatabaseClient';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function start() {
  const { app, httpServer, runtime } = createAppAndServer();
  const isProduction = process.env.NODE_ENV === 'production';
  const port = parseInt(process.env.PORT || '3000', 10);

  if (!isProduction) {
    // Development mode: Mount Vite middleware
    try {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } catch (err) {
      console.warn('[Trading Platform] Vite dev server middleware not loaded:', err);
    }
  } else {
    // Production mode: Backend-oriented server serving static files ONLY if pre-built
    const distPath = path.resolve(__dirname, 'dist');
    const indexPath = path.resolve(distPath, 'index.html');
    if (fs.existsSync(indexPath)) {
      app.use(express.static(distPath));
      app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api') || req.path.startsWith('/ws') || req.path === '/health') {
          return next();
        }
        res.sendFile(indexPath);
      });
    } else {
      // Backend/API-only deployment: Fallback for undefined non-API routes
      app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api') || req.path.startsWith('/ws') || req.path === '/health' || req.path === '/') {
          return next();
        }
        res.status(404).json({
          error: 'NOT_FOUND',
          message: `Route ${req.path} not found on Trading Engine backend.`,
          websocket: '/ws',
          endpoints: {
            root: '/',
            health: '/health',
            stats: '/api/runtime/stats',
          },
        });
      });
    }
  }

  const server = httpServer.listen(port, '0.0.0.0', () => {
    console.log(`[Trading Platform] Server listening on http://0.0.0.0:${port}`);
    console.log(`[Trading Platform] WebSocket listening on /ws`);
    console.log(`[Trading Platform] Runtime Admin stats: http://0.0.0.0:${port}/api/runtime/stats`);
  });

  const shutdown = async (signal: string) => {
    console.log(`[Trading Platform] Received ${signal}, closing server and releasing database pool...`);
    server.close(async () => {
      try {
        await DatabaseClient.getInstance().close();
        console.log('[Trading Platform] Database pool released cleanly.');
      } catch (err) {
        console.error('[Trading Platform] Error during database pool shutdown:', err);
      }
      process.exit(0);
    });
    setTimeout(() => {
      console.warn('[Trading Platform] Force terminating after shutdown timeout');
      process.exit(0);
    }, 5000).unref();
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

start().catch((err) => {
  console.error('[Trading Platform] Failed to start server:', err);
  process.exit(1);
});
