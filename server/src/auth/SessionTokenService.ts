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
    let claims: ExternalSessionTokenPayload;
    try {
      const decodedJson = this.base64UrlDecode(payloadB64);
      claims = JSON.parse(decodedJson);
    } catch {
      return { valid: false, error: 'MALFORMED_CLAIMS', errorMessage: 'Unable to parse token payload JSON' };
    }

    // 3. Verify expiration
    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof claims.exp !== 'number' || claims.exp <= nowSec) {
      return {
        valid: false,
        claims,
        error: 'SESSION_EXPIRED',
        errorMessage: `Launch token expired at ${new Date(claims.exp * 1000).toISOString()}`,
      };
    }

    // 4. Validate mandatory domain identity claims
    if (!claims.sub || !claims.accountId || !claims.accountNumber) {
      return {
        valid: false,
        claims,
        error: 'MALFORMED_CLAIMS',
        errorMessage: 'Token payload missing mandatory claims (sub, accountId, accountNumber)',
      };
    }

    return {
      valid: true,
      claims,
    };
  }
}
