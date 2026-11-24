export { db, getDb } from './client.ts';
export type { Database, DbExecutor } from './client.ts';
export * from './schema.ts';
// Операторы запросов, чтобы приложению не нужна была своя зависимость от drizzle-orm.
export {
  and,
  arrayOverlaps,
  asc,
  count,
  desc,
  eq,
  exists,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  like,
  lte,
  ne,
  not,
  notExists,
  or,
  sql,
} from 'drizzle-orm';
export type { SQL } from 'drizzle-orm';
