export { db, getDb } from './client.ts';
export type { Database } from './client.ts';
export * from './schema.ts';
// Операторы запросов, чтобы приложению не нужна была своя зависимость от drizzle-orm.
export {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  ne,
  not,
  or,
  sql,
} from 'drizzle-orm';
