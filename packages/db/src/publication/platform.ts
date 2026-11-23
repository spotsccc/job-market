import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Площадка, на которой публикуют вакансии: `telegram`, `linkedin`. Справочник: строки
 * заводит миграция, потом — админка. Площадку с источниками или авторами удалить нельзя.
 */
export const platforms = pgTable(
  'platforms',
  {
    /**
     * Короткое имя латиницей: `telegram`, `linkedin`. Читаемый id не требует JOIN, чтобы
     * понять площадку публикации, и сразу годится в ключ публикации. Не меняется.
     */
    id: text().primaryKey(),
    /** Название для людей: «Telegram», «LinkedIn». */
    name: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  () => [check('platforms_id_check', sql`"id" ~ '^[a-z0-9-]+$'`)],
);

export type PlatformRow = typeof platforms.$inferSelect;
export type NewPlatformRow = typeof platforms.$inferInsert;
