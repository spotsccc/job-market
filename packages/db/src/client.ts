import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from './schema.ts';

export type Database = NodePgDatabase<typeof schema> & { $client: Pool };

/**
 * Один пул на процесс. Лежит в `globalThis`, чтобы горячая перезагрузка `next dev`
 * не плодила пулы при каждом пересборе модуля.
 */
const store = globalThis as typeof globalThis & { jobMarketDb?: Database };

function readDatabaseUrl(): string {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url === '') {
    throw new Error(
      'DATABASE_URL is not set: add it to apps/web/.env.local (see apps/web/.env.example)',
    );
  }
  return url;
}

/**
 * Клиент базы. Создаётся при первом обращении, а не при импорте: `next build`
 * импортирует серверные модули и не должен требовать базу.
 */
export function getDb(): Database {
  store.jobMarketDb ??= drizzle({
    client: new Pool({ connectionString: readDatabaseUrl() }),
    schema,
    casing: 'snake_case',
  });
  return store.jobMarketDb;
}

/**
 * Готовый клиент: `db.select().from(vacancies)`, `db.query.vacancies.findMany()`,
 * `db.insert(...)`, `db.transaction(...)`. Подключается при первом запросе: это
 * прокси, который каждое обращение передаёт в `getDb()`.
 */
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- пустая цель прокси: все обращения уходят в getDb()
export const db = new Proxy({} as Database, {
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- сигнатура ловушки Proxy
  get(_target, property) {
    const instance = getDb();
    const value: unknown = Reflect.get(instance, property, instance);
    if (typeof value !== 'function') return value;
    return (...args: readonly unknown[]): unknown => {
      const result: unknown = Reflect.apply(value, instance, args);
      return result;
    };
  },
});
