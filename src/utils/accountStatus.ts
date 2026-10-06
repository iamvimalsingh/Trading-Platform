/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * CANONICAL ACCOUNT STATUS NORMALIZATION & CONTRACT (FRONTEND)
 * Universal normalization utility for Trading Account lifecycle states.
 */

export type AccountStatus = 'ACTIVE' | 'READ_ONLY' | 'SUSPENDED' | 'DISABLED';

export const VALID_ACCOUNT_STATUSES: readonly AccountStatus[] = [
  'ACTIVE',
  'READ_ONLY',
  'SUSPENDED',
  'DISABLED',
] as const;

/**
 * Checks whether an incoming raw status string represents a valid known AccountStatus.
 */
export function isValidAccountStatus(status: unknown): status is AccountStatus {
  if (typeof status !== 'string') return false;
  const normalized = status.trim().toUpperCase();
  return (
    normalized === 'ACTIVE' ||
    normalized === 'READ_ONLY' ||
    normalized === 'READONLY' ||
    normalized === 'READ-ONLY' ||
    normalized === 'SUSPENDED' ||
    normalized === 'DISABLED'
  );
}

/**
 * Universally normalizes an incoming status value into canonical uppercase AccountStatus.
 * Trims whitespace, case-folds, and strictly maps only recognized values.
 * Unknown strings are never silently converted into ACTIVE.
 */
export function normalizeAccountStatus(
  status: unknown,
  fallback: AccountStatus = 'DISABLED'
): AccountStatus {
  if (typeof status !== 'string') return fallback;
  const normalized = status.trim().toUpperCase();
  if (normalized === 'ACTIVE') return 'ACTIVE';
  if (normalized === 'READ_ONLY' || normalized === 'READONLY' || normalized === 'READ-ONLY') return 'READ_ONLY';
  if (normalized === 'SUSPENDED') return 'SUSPENDED';
  if (normalized === 'DISABLED') return 'DISABLED';
  return fallback;
}
