/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * TRADING PASSWORD UTILITIES
 * Secure password hashing with scrypt and random salt, and timing-safe verification.
 */

import crypto from 'node:crypto';

/**
 * Hashes a plaintext password using scrypt with a random 16-byte salt.
 * Returns formatted string: `${saltHex}:${derivedKeyHex}`.
 */
export function hashTradingPassword(password: string): string {
  if (!password || typeof password !== 'string') {
    throw new Error('Password cannot be empty');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `${salt}:${derivedKey.toString('hex')}`;
}

/**
 * Verifies a provided plaintext password against a stored credential.
 * Supports:
 * 1. Secure salt:hash format (scrypt)
 * 2. Plaintext string fallback (for legacy/demo accounts) using timingSafeEqual
 */
export function verifyTradingPassword(providedPassword: string, storedCredential?: string): boolean {
  if (!providedPassword || !storedCredential) return false;

  // 1. Scrypt Salt:Hash format
  if (storedCredential.includes(':')) {
    try {
      const [salt, key] = storedCredential.split(':');
      if (!salt || !key) return false;
      const keyBuffer = Buffer.from(key, 'hex');
      const derivedKey = crypto.scryptSync(providedPassword, salt, 64);
      return crypto.timingSafeEqual(keyBuffer, derivedKey);
    } catch {
      return false;
    }
  }

  // 2. Plaintext constant-time comparison
  try {
    const a = Buffer.from(providedPassword);
    const b = Buffer.from(storedCredential);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return providedPassword === storedCredential;
  }
}
