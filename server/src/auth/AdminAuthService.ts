/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * SERVER-AUTHORITATIVE ADMIN AUTHENTICATION SERVICE (STEP 5)
 * Secure authentication & tenant authorization boundary for future CRM Admin Panel.
 * Validates administrative tokens, API keys, role-based access, and tenant isolation.
 * 
 * Reject:
 * - End-user external session tokens (which lack administrative claims).
 * - preferredAccountId or client-supplied account IDs as proof of administrative authority.
 * - Missing or invalid admin credentials.
 */

import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { AdminContext, AdminRole } from '../types/admin';

export interface AdminTokenPayload {
  iss: string;            // 'crm-admin'
  sub: string;            // Admin User ID (e.g. 'adm_101')
  tenantId: string;       // Tenant / Broker ID
  role: AdminRole;        // 'SUPER_ADMIN' | 'ADMIN' | 'RISK_MANAGER'
  iat: number;
  exp: number;
}

export class AdminAuthService {
  public static getSecret(): string {
    return process.env.ADMIN_API_SECRET || process.env.ADMIN_API_KEY || 'trading_admin_secret_key_default';
  }

  /**
   * Generates a signed Admin token for CRM or automated administrative services.
   */
  public static generateAdminToken(
    params: { adminId: string; tenantId: string; role?: AdminRole; expiresInSec?: number }
  ): string {
    const now = Math.floor(Date.now() / 1000);
    const payload: AdminTokenPayload = {
      iss: 'crm-admin',
      sub: params.adminId,
      tenantId: params.tenantId || 'tenant_default',
      role: params.role || 'ADMIN',
      iat: now,
      exp: now + (params.expiresInSec || 3600),
    };

    const header = { alg: 'HS256', typ: 'ADMIN_JWT' };
    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto
      .createHmac('sha256', this.getSecret())
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest('base64url');

    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }

  /**
   * Verifies an administrative token.
   * Explicitly rejects tokens without typ === 'ADMIN_JWT' or iss === 'crm-admin'
   * to ensure normal client external session tokens can NEVER pass admin authorization.
   */
  public static verifyAdminToken(token: string): { valid: boolean; payload?: AdminTokenPayload; error?: string } {
    if (!token || typeof token !== 'string') {
      return { valid: false, error: 'Missing admin token' };
    }

    const parts = token.trim().split('.');
    if (parts.length !== 3) {
      return { valid: false, error: 'Malformed token structure' };
    }

    const [headerB64, payloadB64, signature] = parts;
    const expectedSig = crypto
      .createHmac('sha256', this.getSecret())
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url');

    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
      return { valid: false, error: 'Invalid token signature' };
    }

    try {
      const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
      const payload: AdminTokenPayload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));

      // Strict check: Normal client session tokens (which use typ 'JWT' and iss 'crm-backend') are rejected
      if (header.typ !== 'ADMIN_JWT' || payload.iss !== 'crm-admin') {
        return { valid: false, error: 'Token is not an authorized administrative token' };
      }

      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < now) {
        return { valid: false, error: 'Admin token expired' };
      }

      return { valid: true, payload };
    } catch {
      return { valid: false, error: 'Invalid token payload' };
    }
  }

  /**
   * Express middleware enforcing server-side admin authentication & tenant extraction.
   */
  public static middleware(allowedRoles?: AdminRole[]) {
    return (req: Request, res: Response, next: NextFunction): void => {
      let adminId: string | undefined;
      let tenantId: string | undefined;
      let role: AdminRole = 'ADMIN';

      // 1. Check Bearer Token
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7).trim();
        const verification = AdminAuthService.verifyAdminToken(token);
        if (!verification.valid || !verification.payload) {
          res.status(401).json({
            error: 'Unauthorized',
            message: verification.error || 'Invalid admin token',
          });
          return;
        }

        adminId = verification.payload.sub;
        tenantId = verification.payload.tenantId;
        role = verification.payload.role;
      }
      // 2. Check Direct Admin API Key Header (for trusted backend-to-backend CRM communication)
      else if (req.headers['x-admin-key']) {
        const key = String(req.headers['x-admin-key']).trim();
        if (key !== AdminAuthService.getSecret()) {
          res.status(401).json({
            error: 'Unauthorized',
            message: 'Invalid X-Admin-Key',
          });
          return;
        }

        adminId = (req.headers['x-admin-user-id'] as string) || 'adm_system';
        tenantId = (req.headers['x-tenant-id'] as string) || 'tenant_default';
        role = ((req.headers['x-admin-role'] as string) as AdminRole) || 'SUPER_ADMIN';
      } else {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Missing administrative credentials (Authorization Bearer or X-Admin-Key required)',
        });
        return;
      }

      // Check role permissions if specified
      if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(role) && role !== 'SUPER_ADMIN') {
        res.status(403).json({
          error: 'Forbidden',
          message: `Admin role '${role}' has insufficient privileges for this operation`,
        });
        return;
      }

      // Enforce tenant resolution
      if (!tenantId) {
        tenantId = 'tenant_default';
      }

      const adminContext: AdminContext = {
        adminId,
        tenantId,
        role,
      };

      (req as any).adminContext = adminContext;
      next();
    };
  }
}
