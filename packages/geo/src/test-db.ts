import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import type { GeoDb } from './resolve.ts';

/**
 * Клиент с закрытым пулом: любой запрос падает. Если функция вернула ответ, а не
 * `GeoQueryError`, — она в базу не ходила.
 */
export async function closedDb(): Promise<GeoDb> {
  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  await pool.end();
  return drizzle({ client: pool, casing: 'snake_case' });
}
