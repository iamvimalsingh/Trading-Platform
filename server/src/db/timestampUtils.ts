/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * POSTGRESQL DATE / TIMESTAMP UTILITIES
 * Universal bidirectional converter between JavaScript numeric timestamps (epoch ms)
 * and PostgreSQL TIMESTAMPTZ / TIMESTAMP / BIGINT column representations.
 */

export function parseDbTimestamp(val: any): number {
  if (val === null || val === undefined) return Date.now();
  if (val instanceof Date) return val.getTime();
  if (typeof val === 'number') {
    if (val < 10000000000) return val * 1000; // Convert epoch seconds to ms
    return val;
  }
  if (typeof val === 'string') {
    const num = Number(val);
    if (!isNaN(num) && num > 100000000000) return num;
    const d = new Date(val).getTime();
    if (!isNaN(d)) return d;
  }
  return Date.now();
}

export function toDbTimestamp(val?: number | Date | string | null): Date {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val === 'number') {
    if (val < 10000000000) return new Date(val * 1000);
    return new Date(val);
  }
  const d = new Date(val);
  return isNaN(d.getTime()) ? new Date() : d;
}
