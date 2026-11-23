import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Платформа — бренд источника, под которым его знают люди: `geekjobs` у 14 каналов GeekJobs,
 * `linkedin`. Это не сервис: каналы GeekJobs живут в Telegram, но их платформа — geekjobs, а
 * как их читать, говорит коннектор. Справочник: строки заводит миграция, потом — админка.
 * Платформу с источниками удалить нельзя.
 */
export const platforms = pgTable(
  'platforms',
  {
    /** Короткое имя латиницей: `geekjobs`, `linkedin`. Читаемый id не требует JOIN. Не меняется. */
    id: text().primaryKey(),
    /** Название для людей: «GeekJobs», «LinkedIn». */
    name: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  () => [check('platforms_id_check', sql`"id" ~ '^[a-z0-9-]+$'`)],
);

export type PlatformRow = typeof platforms.$inferSelect;
export type NewPlatformRow = typeof platforms.$inferInsert;
