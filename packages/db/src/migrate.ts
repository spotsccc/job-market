import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

/** Папка с SQL-миграциями, которые пишет `drizzle-kit generate`. */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url));

/**
 * Применяет к базе ещё не применённые миграции из `MIGRATIONS_FOLDER`. Повторный
 * запуск ничего не делает: применённые миграции drizzle помнит в таблице
 * `drizzle.__drizzle_migrations`. Подключение нужно прямое, не через пулер.
 */
export async function migrateDatabase(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 1 });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
}
