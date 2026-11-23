export { db, getDb } from './client.ts';
export type { Database, DbExecutor } from './client.ts';
export * from './schema.ts';
// Операторы запросов, чтобы приложению не нужна была своя зависимость от drizzle-orm.
export {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  like,
  ne,
  not,
  or,
  sql,
} from 'drizzle-orm';
