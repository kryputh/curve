import { mkdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';

export async function openDatabase({ dataDir, databaseUrl }) {
  if (!databaseUrl) {
    if (dataDir !== 'memory://') await mkdir(dataDir, { recursive: true });
    return PGlite.create(dataDir);
  }

  const pool = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  return {
    query: (sql, params) => pool.query(sql, params),
    exec: sql => pool.query(sql),
    close: () => pool.end(),
    async transaction(work) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await work(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
