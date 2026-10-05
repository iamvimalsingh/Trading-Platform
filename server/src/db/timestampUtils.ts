/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * POSTGRESQL DATE / TIMESTAMP UTILITIES & SCHEMA INSPECTOR
 * Universal bidirectional converter between JavaScript numeric timestamps (epoch ms)
 * and PostgreSQL TIMESTAMPTZ / TIMESTAMP / BIGINT column representations.
 */

import { IDatabaseClient } from './DatabaseClient';

export class SchemaInspector {
  private static columnTypes = new Map<string, string>();

  public static setColumnType(table: string, column: string, type: string): void {
    this.columnTypes.set(`${table.toLowerCase()}.${column.toLowerCase()}`, type.toLowerCase());
  }

  public static getColumnType(table: string, column: string): string | undefined {
    return this.columnTypes.get(`${table.toLowerCase()}.${column.toLowerCase()}`);
  }

  public static async loadSchema(db: IDatabaseClient): Promise<void> {
    try {
      const res = await db.query(
        `SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public';`
      );
      if (res && res.rows) {
        for (const row of res.rows) {
          if (row.table_name && row.column_name && row.data_type) {
            this.setColumnType(row.table_name, row.column_name, row.data_type);
          }
        }
      }
    } catch {
      // safe fallback if information_schema is restricted
    }
  }

  public static formatDbTimestamp(
    val?: number | Date | string | null,
    table?: string,
    column?: string
  ): any {
    const rawMs = parseDbTimestamp(val);

    if (table && column) {
      const colType = this.getColumnType(table, column);
      if (colType) {
        if (colType.includes('int') || colType.includes('numeric')) {
          return rawMs;
        }
        if (colType.includes('time') || colType.includes('date')) {
          return new Date(rawMs);
        }
        if (colType.includes('char') || colType.includes('text')) {
          return new Date(rawMs).toISOString();
        }
      }

      // Static fallback defaults when information_schema has not yet loaded:
      // trading_accounts.created_at / updated_at in production Supabase are BIGINT
      if (table.toLowerCase() === 'trading_accounts') {
        return rawMs;
      }
    }

    return new Date(rawMs);
  }
}

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

export function toDbTimestamp(
  val?: number | Date | string | null,
  table?: string,
  column?: string
): any {
  return SchemaInspector.formatDbTimestamp(val, table, column);
}

