/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * SERVER-AUTHORITATIVE M2M AUTHENTICATION SERVICE (STEP 3)
 * Secure authentication boundary for CRM -> Trading Engine Machine-to-Machine integrations.
 * Validates HMAC-SHA256 signatures over timestamp and raw request payload.
 * 
 * Contract:
 * - Header: X-CRM-Timestamp (Unix timestamp in seconds or milliseconds)
 * - Header: X-CRM-Signature (Base64 HMAC-SHA256 digest of `${timestamp}.${rawBody}`)
 * - Secret: process.env.CRM_M2M_SECRET
 */

import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';

export interface M2MAuthResult {
  valid: boolean;
  timestamp?: number;
  error?: string;
  errorCode?: 'MISSING_SECRET' | 'MISSING_HEADERS' | 'INVALID_TIMESTAMP' | 'TIMESTAMP_EXPIRED' | 'FUTURE_TIMESTAMP' | 'INVALID_SIGNATURE' | 'MALFORMED_SIGNATURE';
}

export class M2MAuthService {
  /**
   * Maximum allowed age of a request timestamp in milliseconds (5 minutes).
   */
  public static readonly MAX_TIMESTAMP_AGE_MS = 300_000;

  /**
   * Maximum allowed future clock skew in milliseconds (60 seconds).
   */
  public static readonly MAX_FUTURE_SKEW_MS = 60_000;

  /**
   * Retrieves the CRM M2M signing secret.
   * Fails closed if missing in production.
   */
  public static getSecret(): string {
    const secret = process.env.CRM_M2M_SECRET?.trim();
    if (!secret) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('[M2MAuthService] FATAL: CRM_M2M_SECRET is required in production environment.');
      }
      return '';
    }
    return secret;
  }

  /**
   * Computes an HMAC-SHA256 signature in Base64 for the given timestamp and raw body.
   */
  public static computeSignature(timestamp: string | number, rawBody: string, secret?: string): string {
    const signingKey = secret || this.getSecret();
    if (!signingKey) {
      throw new Error('[M2MAuthService] Cannot compute signature: CRM_M2M_SECRET is not configured.');
    }
    const message = `${timestamp}.${rawBody}`;
    return crypto
      .createHmac('sha256', signingKey)
      .update(message, 'utf8')
      .digest('base64');
  }

  /**
   * Verifies an incoming M2M request with timestamp freshness and HMAC-SHA256 signature verification.
   */
  public static verifyRequest(
    timestampHeader: string | undefined,
    signatureHeader: string | undefined,
    rawBody: string,
    secret?: string
  ): M2MAuthResult {
    const signingKey = secret || this.getSecret();
    if (!signingKey) {
      return {
        valid: false,
        error: 'M2M authentication is not configured on the server (CRM_M2M_SECRET missing)',
        errorCode: 'MISSING_SECRET',
      };
    }

    // 1. Header presence checks
    if (!timestampHeader || !signatureHeader) {
      return {
        valid: false,
        error: 'Missing required M2M authentication headers (X-CRM-Timestamp and X-CRM-Signature required)',
        errorCode: 'MISSING_HEADERS',
      };
    }

    const trimmedTimestamp = String(timestampHeader).trim();
    const trimmedSignature = String(signatureHeader).trim();

    if (!trimmedTimestamp || !trimmedSignature) {
      return {
        valid: false,
        error: 'X-CRM-Timestamp and X-CRM-Signature must be non-empty',
        errorCode: 'MISSING_HEADERS',
      };
    }

    // 2. Timestamp validation & freshness check
    const tsNumber = Number(trimmedTimestamp);
    if (!Number.isFinite(tsNumber) || tsNumber <= 0) {
      return {
        valid: false,
        error: 'Invalid X-CRM-Timestamp format: must be a positive unix timestamp',
        errorCode: 'INVALID_TIMESTAMP',
      };
    }

    // Normalize seconds vs milliseconds: if < 1e11 (year 1973 - 5138 in seconds), convert to ms
    const tsMs = tsNumber < 1e11 ? tsNumber * 1000 : tsNumber;
    const now = Date.now();

    if (tsMs < now - this.MAX_TIMESTAMP_AGE_MS) {
      return {
        valid: false,
        error: `Request timestamp is expired (stale by > ${this.MAX_TIMESTAMP_AGE_MS / 1000}s)`,
        errorCode: 'TIMESTAMP_EXPIRED',
        timestamp: tsMs,
      };
    }

    if (tsMs > now + this.MAX_FUTURE_SKEW_MS) {
      return {
        valid: false,
        error: `Request timestamp is in the future (> ${this.MAX_FUTURE_SKEW_MS / 1000}s clock skew)`,
        errorCode: 'FUTURE_TIMESTAMP',
        timestamp: tsMs,
      };
    }

    // 3. Compute expected HMAC signature
    let expectedSignature: string;
    try {
      expectedSignature = this.computeSignature(trimmedTimestamp, rawBody, signingKey);
    } catch (err: any) {
      return {
        valid: false,
        error: err?.message || 'Failed to compute HMAC signature',
        errorCode: 'MALFORMED_SIGNATURE',
      };
    }

    // 4. Constant-time signature comparison
    const sigBufferA = Buffer.from(trimmedSignature, 'utf8');
    const sigBufferB = Buffer.from(expectedSignature, 'utf8');

    if (sigBufferA.length !== sigBufferB.length) {
      return {
        valid: false,
        error: 'Cryptographic signature verification failed',
        errorCode: 'INVALID_SIGNATURE',
        timestamp: tsMs,
      };
    }

    if (!crypto.timingSafeEqual(sigBufferA, sigBufferB)) {
      return {
        valid: false,
        error: 'Cryptographic signature verification failed',
        errorCode: 'INVALID_SIGNATURE',
        timestamp: tsMs,
      };
    }

    return {
      valid: true,
      timestamp: tsMs,
    };
  }

  /**
   * Express middleware for protecting M2M routes with HMAC-SHA256 signature verification.
   */
  public static middleware(secretOverride?: string) {
    return (req: Request, res: Response, next: NextFunction): void => {
      const timestamp = (req.headers['x-crm-timestamp'] as string) || (req.headers['x-timestamp'] as string);
      const signature = (req.headers['x-crm-signature'] as string) || (req.headers['x-signature'] as string);
      
      // Extract rawBody captured by express.json verify callback, or fallback to serialized body
      const rawBody = (req as any).rawBody !== undefined
        ? (req as any).rawBody
        : JSON.stringify(req.body || {});

      const result = M2MAuthService.verifyRequest(timestamp, signature, rawBody, secretOverride);

      if (!result.valid) {
        res.status(401).json({
          error: 'Unauthorized',
          code: result.errorCode,
          message: result.error,
        });
        return;
      }

      (req as any).m2mContext = {
        timestamp: result.timestamp,
        authenticated: true,
      };

      next();
    };
  }
}
