/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * SERVER-SIDE AUTHENTICATED TRADING ADMIN ROUTER (STEP 5)
 * Protected REST boundary for future CRM Admin Panel.
 * Enforces admin authorization, tenant isolation, parameter validation, and audit logging.
 * 
 * Endpoints:
 * GET    /api/admin/trading/accounts/:id
 * PATCH  /api/admin/trading/accounts/:id
 * GET    /api/admin/trading/symbols
 * GET    /api/admin/trading/symbols/:symbol
 * PATCH  /api/admin/trading/symbols/:symbol
 * GET    /api/admin/trading/spreads
 * POST   /api/admin/trading/spreads
 * PATCH  /api/admin/trading/spreads/:id
 * GET    /api/admin/trading/audit
 */

import { Router, Request, Response } from 'express';
import { TradingAdminService } from './TradingAdminService';
import { AdminAuthService } from '../auth/AdminAuthService';
import { AdminContext } from '../types/admin';

export function createTradingAdminRouter(adminService: TradingAdminService): Router {
  const router = Router();

  // All endpoints require verified administrative credentials
  router.use(AdminAuthService.middleware());

  // Helper to extract typed AdminContext
  const getContext = (req: Request): AdminContext => {
    return (req as any).adminContext as AdminContext;
  };

  // ---------------------------------------------------------------------------
  // 1. ACCOUNT ADMIN CONTROLS
  // ---------------------------------------------------------------------------

  // POST /api/admin/trading/accounts
  router.post('/accounts', async (req: Request, res: Response) => {
    try {
      const ctx = getContext(req);
      const created = await adminService.createAccount(ctx.tenantId, req.body, ctx);
      res.status(201).json(created);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Failed to provision account' });
    }
  });

  // GET /api/admin/trading/accounts/:id
  router.get('/accounts/:id', async (req: Request, res: Response) => {
    try {
      const ctx = getContext(req);
      const account = await adminService.getAccount(ctx.tenantId, req.params.id);
      if (!account) {
        res.status(404).json({ error: 'Account not found or access denied in tenant' });
        return;
      }
      res.json(account);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to fetch account' });
    }
  });

  // PATCH /api/admin/trading/accounts/:id
  router.patch('/accounts/:id', async (req: Request, res: Response) => {
    try {
      const ctx = getContext(req);
      const updated = await adminService.updateAccount(ctx.tenantId, req.params.id, req.body, ctx);
      res.json(updated);
    } catch (err: any) {
      const isNotFound = err?.message?.includes('not found');
      res.status(isNotFound ? 404 : 400).json({ error: err?.message || 'Failed to update account' });
    }
  });

  // DELETE /api/admin/trading/accounts/:id
  router.delete('/accounts/:id', async (req: Request, res: Response) => {
    try {
      const ctx = getContext(req);
      const result = await adminService.deleteAccount(ctx.tenantId, req.params.id, ctx);
      res.json(result);
    } catch (err: any) {
      const isNotFound = err?.message?.includes('not found');
      const isBlocked = err?.message?.includes('Cannot delete');
      res.status(isNotFound ? 404 : isBlocked ? 409 : 400).json({ error: err?.message || 'Failed to delete account' });
    }
  });

  // ---------------------------------------------------------------------------
  // 2. SYMBOL / INSTRUMENT ADMIN CONTROLS
  // ---------------------------------------------------------------------------

  // GET /api/admin/trading/symbols
  router.get('/symbols', (req: Request, res: Response) => {
    try {
      const ctx = getContext(req);
      const symbols = adminService.getAllSymbols(ctx.tenantId);
      res.json(symbols);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to fetch symbols' });
    }
  });

  // GET /api/admin/trading/symbols/:symbol
  router.get('/symbols/:symbol', (req: Request, res: Response) => {
    try {
      const ctx = getContext(req);
      const symbol = adminService.getSymbol(ctx.tenantId, req.params.symbol);
      if (!symbol) {
        res.status(404).json({ error: 'Symbol not found' });
        return;
      }
      res.json(symbol);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to fetch symbol' });
    }
  });

  // PATCH /api/admin/trading/symbols/:symbol
  router.patch('/symbols/:symbol', async (req: Request, res: Response) => {
    try {
      const ctx = getContext(req);
      const updated = await adminService.updateSymbol(ctx.tenantId, req.params.symbol, req.body, ctx);
      res.json(updated);
    } catch (err: any) {
      const isNotFound = err?.message?.includes('not found');
      res.status(isNotFound ? 404 : 400).json({ error: err?.message || 'Failed to update symbol' });
    }
  });

  // ---------------------------------------------------------------------------
  // 3. PAIR-WISE SPREAD CONTROLS
  // ---------------------------------------------------------------------------

  // GET /api/admin/trading/spreads
  router.get('/spreads', async (req: Request, res: Response) => {
    try {
      const ctx = getContext(req);
      const symbol = req.query.symbol as string | undefined;
      const configs = await adminService.getSpreadConfigs(ctx.tenantId, symbol);
      res.json(configs);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to fetch spread configurations' });
    }
  });

  // POST /api/admin/trading/spreads
  router.post('/spreads', async (req: Request, res: Response) => {
    try {
      const ctx = getContext(req);
      const created = await adminService.createSpreadConfig(ctx.tenantId, req.body, ctx);
      res.status(201).json(created);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Failed to create spread configuration' });
    }
  });

  // PATCH /api/admin/trading/spreads/:id
  router.patch('/spreads/:id', async (req: Request, res: Response) => {
    try {
      const ctx = getContext(req);
      const updated = await adminService.updateSpreadConfig(ctx.tenantId, req.params.id, req.body, ctx);
      res.json(updated);
    } catch (err: any) {
      const isNotFound = err?.message?.includes('not found');
      res.status(isNotFound ? 404 : 400).json({ error: err?.message || 'Failed to update spread configuration' });
    }
  });

  // ---------------------------------------------------------------------------
  // 4. AUDIT LOGS
  // ---------------------------------------------------------------------------

  // GET /api/admin/trading/audit
  router.get('/audit', async (req: Request, res: Response) => {
    try {
      const ctx = getContext(req);
      const filter = {
        resourceType: req.query.resourceType as string | undefined,
        resourceId: req.query.resourceId as string | undefined,
        adminId: req.query.adminId as string | undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 50,
      };
      const logs = await adminService.getAuditLogs(ctx.tenantId, filter);
      res.json(logs);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to query audit logs' });
    }
  });

  return router;
}
