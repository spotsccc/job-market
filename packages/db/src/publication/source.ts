import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { platforms } from './platform.ts';
import { CONNECTORS } from './values.ts';

/**
 * Источник вакансий: открытый Telegram-канал, поисковый запрос LinkedIn, доска вакансий
 * компании. Строки заводят импорт источников и коннекторы плана 2, опрашивать их по
 * расписанию начнёт движок плана 3 — его столбцы созданы заранее, чтобы не менять
 * таблицу. Источник с публикациями не удаляется, а выключается: `enabled = false`.
 */
export const sources = pgTable(
  'sources',
  {
    id: uuid().primaryKey().defaultRandom(),
    /** Код, который читает источник и разбирает его публикации: `open-telegram`, `linkedin`. */
    connector: text({ enum: CONNECTORS }).notNull(),
    /** Id источника внутри коннектора: юзернейм канала, имя поискового запроса LinkedIn. */
    key: text().notNull(),
    /**
     * Бренд источника: `geekjobs` у каналов GeekJobs, `linkedin`. Площадка публикации — здесь,
     * у источника: в публикации её нет.
     */
    platform: text()
      .notNull()
      .references(() => platforms.id, { onDelete: 'restrict' }),
    /** Название для людей: «forhr», «React в Европе». */
    name: text().notNull(),
    /** Настройки коннектора для источника; их проверяет zod-схема коннектора. У `open-telegram` — пусто. */
    config: jsonb()
      .$type<Readonly<Record<string, unknown>>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** Через сколько минут после опроса опросить снова. */
    intervalMinutes: integer().notNull().default(1440),
    enabled: boolean().notNull().default(true),
    /** Не раньше какого момента источник опрашивается в следующий раз. */
    nextRunAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** Где остановился прошлый опрос, форма своя у каждого коннектора. `null` — опросов не было. */
    cursor: jsonb(),
    /** Когда закончился последний опрос, успешный или нет. */
    lastFetchedAt: timestamp({ withTimezone: true }),
    lastSuccessAt: timestamp({ withTimezone: true }),
    /** Сколько опросов подряд закончились ошибкой. */
    consecutiveFailures: integer().notNull().default(0),
    /** Текст ошибки последнего неудачного опроса. */
    lastError: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique('sources_connector_key_unique').on(table.connector, table.key),
    // Цель составного ключа из publications: публикация — из коннектора своего источника.
    unique('sources_id_connector_unique').on(table.id, table.connector),
    // Чаще тика расписания опросить нельзя.
    check('sources_interval_minutes_check', sql`"interval_minutes" >= 15`),
    check('sources_consecutive_failures_check', sql`"consecutive_failures" >= 0`),
    // Диспетчер ищет включённые источники, которые пора опросить.
    index('sources_next_run_at_index')
      .on(table.nextRunAt)
      .where(sql`"enabled"`),
  ],
);

export type SourceRow = typeof sources.$inferSelect;
export type NewSourceRow = typeof sources.$inferInsert;
