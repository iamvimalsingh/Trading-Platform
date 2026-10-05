/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * SERVER-AUTHORITATIVE M2M FUNDING ROUTER (STEP 3)
 * Handles machine-to-machine funding operations from CRM with HMAC-SHA256 authentication.
 * 
 * Endpoints:
 * POST /api/v1/admin/trading/funding/credit
 */

import { Router, Request, Response } from 'express';
import { FundingService } from '../funding/FundingService';
import { M2MAuthService } from '../auth/M2MAuthService';

export function createFundingRouter(fundingService: FundingService): Router {
  const router = Router();

  // Enforce M2M HMAC-SHA256 signature authentication across all funding routes
  router.use(M2MAuthService.middleware());

  // POST /credit (Mounted at /api/v1/admin/trading/funding/credit)
  router.post('/credit', async (req: Request, res: Response) => {
    try {
      const result = await fundingService.creditAccount({
        accountId: req.body?.accountId,
        amount: req.body?.amount,
        currency: req.body?.currency,
        transactionId: req.body?.transactionId,
        idempotencyKey: req.body?.idempotencyKey,
        note: req.body?.note,
        tenantId: req.body?.tenantId,
      });

      if (!result.success) {
        res.status(result.statusCode).json({
          error: result.error,
          code: result.code,
        });
        return;
      }

      res.status(result.statusCode).json(result.data);
    } catch (err: any) {
      console.error('[FundingRouter] Unhandled error processing funding credit:', err);
      res.status(500).json({
        error: 'Internal server error while processing funding credit',
        message: err?.message,
      });
    }
  });

  return router;
}
