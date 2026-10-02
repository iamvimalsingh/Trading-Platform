/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * SERVER-AUTHORITATIVE SESSION TOKEN SERVICE
 * Cryptographically verifies and generates short-lived HMAC-SHA256 launch tokens
 * for secure CRM -> Trading Platform handoffs.
 * 
 * Boundary: Server-side only. Never import into browser/Vite bundle.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { ExternalSessionTokenPayload } from '../types/trading';

export type TokenVerificationError =
  | 'INVALID_FORMAT'
  | 'INVALID_SIGNATURE'
  | 'SESSION_EXPIRED'
  | 'MALFORMED_CLAIMS'
  | 'MISSING_SECRET';

export interface TokenVerificationResult {
  valid: boolean;
  claims?: ExternalSessionTokenPayload;
  error?: TokenVerificationError;
  errorMessage?: string;
}

export class SessionTokenService {
  /**
   * Retrieves server signing secret from environment.
   * Default fallback provided only for local development/testing.
   */
  public static getSecret(): string {
    return (
      process.env.CRM_LAUNCH_SECRET?.trim() ||
      process.env.JWT_SECRET?.trim() ||
      'dev_crm_launch_secret_key_change_in_prod'
    );
  }

  /**
   * Base64URL string encoder
   */
  private static base64UrlEncode(str: string): string {
    return Buffer.from(str, 'utf8')
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  }

  /**
   * Base64URL string decoder
   */
  private static base64UrlDecode(str: string): string {
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
      base64 += '=';
    }
    return Buffer.from(base64, 'base64').toString('utf8');
  }

  /**
   * Generates a signed, short-lived external launch token.
   * Intended for CRM backend issuance and test suites.
   */
  public static createLaunchToken(
    claims: Omit<ExternalSessionTokenPayload, 'iat' | 'exp'>,
    expiresInSeconds: number = 300,
    secret?: string
  ): string {
    const signingKey = secret || this.getSecret();
    const nowSec = Math.floor(Date.now() / 1000);

    const fullPayload: ExternalSessionTokenPayload = {
      ...claims,
      iat: nowSec,
      exp: nowSec + expiresInSeconds,
    };

    const header = { alg: 'HS256', typ: 'JWT' };
    const headerB64 = this.base64UrlEncode(JSON.stringify(header));
    const payloadB64 = this.base64UrlEncode(JSON.stringify(fullPayload));

    const signature = createHmac('sha256', signingKey)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url');

    return `${headerB64}.${payloadB64}.${signature}`;
  }

  /**
   * Authoritatively verifies an incoming launch token.
   * Checks structure, signature, expiration, and required claim semantics.
   */
  public static verifyLaunchToken(
    token: string,
    secret?: string
  ): TokenVerificationResult {
    if (!token || typeof token !== 'string') {
      return { valid: false, error: 'INVALID_FORMAT', errorMessage: 'Empty or non-string token provided' };
    }

    const parts = token.trim().split('.');
    if (parts.length !== 3) {
      return { valid: false, error: 'INVALID_FORMAT', errorMessage: 'Malformed token structure (expected 3 dot-separated segments)' };
    }

    const [headerB64, payloadB64, signatureB64] = parts;
    const signingKey = secret || this.getSecret();

    // 1. Verify cryptographic signature
    const expectedSignature = createHmac('sha256', signingKey)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url');

    const sigBufferA = Buffer.from(signatureB64, 'utf8');
    const sigBufferB = Buffer.from(expectedSignature, 'utf8');

    if (sigBufferA.length !== sigBufferB.length || !timingSafeEqual(sigBufferA, sigBufferB)) {
      return { valid: false, error: 'INVALID_SIGNATURE', errorMessage: 'Cryptographic signature verification failed' };
    }

    // 2. Parse payload claims
    let rawClaims: any;
    try {
      const decodedJson = this.base64UrlDecode(payloadB64);
      rawClaims = JSON.parse(decodedJson);
    } catch {
      return { valid: false, error: 'MALFORMED_CLAIMS', errorMessage: 'Unable to parse token payload JSON' };
    }

    // 3. Verify expiration
    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof rawClaims.exp !== 'number' || rawClaims.exp <= nowSec) {
      return {
        valid: false,
        claims: rawClaims,
        error: 'SESSION_EXPIRED',
        errorMessage: `Launch token expired at ${rawClaims.exp ? new Date(rawClaims.exp * 1000).toISOString() : 'unknown'}`,
      };
    }

    // 4. Validate and normalize mandatory domain identity claims
    const sub = rawClaims.sub || rawClaims.userId || rawClaims.user_id || rawClaims.clientId || rawClaims.client_id;
    const accountId = rawClaims.accountId || rawClaims.account_id || rawClaims.accountNumber || rawClaims.account_number;
    const accountNumber = rawClaims.accountNumber || rawClaims.account_number || rawClaims.accountId || rawClaims.account_id;

    if (!sub || !accountId || !accountNumber) {
      return {
        valid: false,
        claims: rawClaims,
        error: 'MALFORMED_CLAIMS',
        errorMessage: 'Token payload missing mandatory claims (sub, accountId, accountNumber)',
      };
    }

    const claims: ExternalSessionTokenPayload = {
      iss: rawClaims.iss || 'crm-backend',
      sub: String(sub),
      aud: rawClaims.aud || 'trading-terminal',
      accountId: String(accountId),
      accountNumber: String(accountNumber),
      tenantId: rawClaims.tenantId || rawClaims.tenant_id || 'tenant_default',
      platform: rawClaims.platform || 'MT5',
      currency: rawClaims.currency || 'USD',
      accountType: rawClaims.accountType || rawClaims.account_type || 'LIVE',
      leverage: rawClaims.leverage ? Number(rawClaims.leverage) : 100,
      initialBalance: typeof (rawClaims.initialBalance ?? rawClaims.initial_balance ?? rawClaims.balance) === 'number'
        ? (rawClaims.initialBalance ?? rawClaims.initial_balance ?? rawClaims.balance)
        : (rawClaims.initialBalance !== undefined && rawClaims.initialBalance !== null && !isNaN(Number(rawClaims.initialBalance)))
        ? Number(rawClaims.initialBalance)
        : (rawClaims.initial_balance !== undefined && rawClaims.initial_balance !== null && !isNaN(Number(rawClaims.initial_balance)))
        ? Number(rawClaims.initial_balance)
        : (rawClaims.balance !== undefined && rawClaims.balance !== null && !isNaN(Number(rawClaims.balance)))
        ? Number(rawClaims.balance)
        : undefined,
      balance: typeof (rawClaims.balance ?? rawClaims.initialBalance ?? rawClaims.initial_balance) === 'number'
        ? (rawClaims.balance ?? rawClaims.initialBalance ?? rawClaims.initial_balance)
        : (rawClaims.balance !== undefined && rawClaims.balance !== null && !isNaN(Number(rawClaims.balance)))
        ? Number(rawClaims.balance)
        : undefined,
      iat: rawClaims.iat || nowSec,
      exp: rawClaims.exp,
    };

    return {
      valid: true,
      claims,
    };
  }
}
