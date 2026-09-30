/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * SERVER POSTGRESQL DATABASE CLIENT
 * Unified interface supporting:
 * 1. Production managed PostgreSQL (Cloud SQL, Neon, Supabase) via pg.Pool (DATABASE_URL).
 * 2. Embedded WASM PostgreSQL via @electric-sql/pglite with filesystem persistence (local/dev/testing).
 */

import path from 'path';
import fs from 'fs';
import { Pool, PoolClient } from 'pg';
import { PGlite } from '@electric-sql/pglite';

export interface QueryResult<T = any> {
  rows: T[];
  rowCount?: number;
}

export interface IDatabaseClient {
  query<T = any>(sql: string, params?: any[]): Promise<QueryResult<T>>;
  transaction<T>(callback: (client: IDatabaseClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  isReady(): boolean;
}

export class DatabaseClient implements IDatabaseClient {
  private static instance: DatabaseClient | null = null;
  private pgPool: Pool | null = null;
  private pglite: PGlite | null = null;
  private ready: boolean = false;
  private storagePath: string;

  private constructor(storageDir?: string) {
    this.storagePath = storageDir || process.env.DATABASE_STORAGE_PATH || path.resolve(process.cwd(), 'data', 'trading_postgres');
  }

  public static getInstance(storageDir?: string): DatabaseClient {
    if (!DatabaseClient.instance) {
      DatabaseClient.instance = new DatabaseClient(storageDir);
    }
    return DatabaseClient.instance;
  }

  public static resetInstance(): void {
    if (DatabaseClient.instance) {
      DatabaseClient.instance = null;
    }
  }

  public isReady(): boolean {
    return this.ready;
  }

  public async init(): Promise<void> {
    if (this.ready) return;

    const databaseUrl = process.env.DATABASE_URL?.trim();

    if (databaseUrl) {
      // Connect to remote PostgreSQL via pg.Pool
      this.pgPool = new Pool({
        connectionString: databaseUrl,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      });

      // Verify connection
      const client = await this.pgPool.connect();
      try {
        await client.query('SELECT 1');
      } finally {
        client.release();
      }
    } else {
      // Use persistent embedded PostgreSQL engine
      try {
        if (!fs.existsSync(this.storagePath)) {
          fs.mkdirSync(this.storagePath, { recursive: true });
        }

        this.pglite = new PGlite(this.storagePath);
        await this.pglite.query('SELECT 1');
      } catch {
        // Fall back to in-memory PGlite if disk storage directory is locked or busy
        this.pglite = new PGlite();
        await this.pglite.query('SELECT 1');
      }
    }

    this.ready = true;
  }

  public async query<T = any>(sql: string, params?: any[]): Promise<QueryResult<T>> {
    if (!this.ready) {
      await this.init();
    }

    if (this.pgPool) {
      const res = await this.pgPool.query(sql, params);
      return { rows: res.rows as T[], rowCount: res.rowCount ?? 0 };
    }

    if (this.pglite) {
      const res = await this.pglite.query<T>(sql, params);
      return { rows: res.rows, rowCount: res.rows.length };
    }

    throw new Error('DatabaseClient not initialized');
  }

  public async transaction<T>(callback: (client: IDatabaseClient) => Promise<T>): Promise<T> {
    if (!this.ready) {
      await this.init();
    }

    if (this.pgPool) {
      const client: PoolClient = await this.pgPool.connect();
      try {
        await client.query('BEGIN');
        const txClient: IDatabaseClient = {
          query: async <R = any>(q: string, p?: any[]): Promise<QueryResult<R>> => {
            const res = await client.query(q, p);
            return { rows: res.rows as R[], rowCount: res.rowCount ?? 0 };
          },
          transaction: async () => {
            throw new Error('Nested transactions not supported');
          },
          close: async () => {},
          isReady: () => true,
        };
        const result = await callback(txClient);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    if (this.pglite) {
      // PGlite transaction
      return await this.pglite.transaction(async (tx) => {
        const txClient: IDatabaseClient = {
          query: async <R = any>(q: string, p?: any[]): Promise<QueryResult<R>> => {
            const res = await tx.query<R>(q, p);
            return { rows: res.rows, rowCount: res.rows.length };
          },
          transaction: async () => {
            throw new Error('Nested transactions not supported');
          },
          close: async () => {},
          isReady: () => true,
        };
        return await callback(txClient);
      });
    }

    throw new Error('DatabaseClient not initialized');
  }

  public async close(): Promise<void> {
    if (this.pgPool) {
      await this.pgPool.end();
      this.pgPool = null;
    }
    if (this.pglite) {
      await this.pglite.close();
      this.pglite = null;
    }
    this.ready = false;
  }
}
