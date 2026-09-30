/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * FULL-STACK DEV & PRODUCTION SERVER ENTRYPOINT
 * Integrates Authoritative Trading Backend with Vite frontend middlewares on port 3000.
 */

import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createAppAndServer } from './server/src/index';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function start() {
  const { app, httpServer, runtime } = createAppAndServer();
  const isProduction = process.env.NODE_ENV === 'production';
  const port = parseInt(process.env.PORT || '3000', 10);

  if (!isProduction) {
    // Development mode: Mount Vite middleware
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Production mode: Serve built static files
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`[Trading Platform] Server listening on http://0.0.0.0:${port}`);
    console.log(`[Trading Platform] WebSocket listening on /ws`);
    console.log(`[Trading Platform] Runtime Admin stats: http://0.0.0.0:${port}/api/runtime/stats`);
  });
}

start().catch((err) => {
  console.error('[Trading Platform] Failed to start server:', err);
  process.exit(1);
});
