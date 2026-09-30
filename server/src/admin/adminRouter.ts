/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * ADMIN & RUNTIME INSPECTION ROUTER
 * Read-only development inspection endpoints.
 */

import { Router, Request, Response } from 'express';
import { TradingRuntime } from '../runtime/TradingRuntime';
import {
  serializeAccountDetail,
  serializeAccounts,
  serializeClientSessions,
  serializeMarket,
  serializeOrders,
  serializePositions,
  serializeRuntimeStats,
} from './adminSerializers';

export function createAdminRouter(runtime: TradingRuntime): Router {
  const router = Router();

  // GET /api/runtime/stats
  router.get('/stats', (_req: Request, res: Response) => {
    res.json(serializeRuntimeStats(runtime));
  });

  // GET /api/runtime/clients
  router.get('/clients', (_req: Request, res: Response) => {
    res.json(serializeClientSessions(runtime));
  });

  // GET /api/runtime/accounts
  router.get('/accounts', (_req: Request, res: Response) => {
    res.json(serializeAccounts(runtime));
  });

  // GET /api/runtime/accounts/:accountId
  router.get('/accounts/:accountId', (req: Request, res: Response) => {
    const detail = serializeAccountDetail(runtime, req.params.accountId);
    if (!detail) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }
    res.json(detail);
  });

  // GET /api/runtime/orders
  router.get('/orders', (_req: Request, res: Response) => {
    res.json(serializeOrders(runtime));
  });

  // GET /api/runtime/positions
  router.get('/positions', (_req: Request, res: Response) => {
    res.json(serializePositions(runtime));
  });

  // GET /api/runtime/market
  router.get('/market', (_req: Request, res: Response) => {
    res.json(serializeMarket(runtime));
  });

  return router;
}
