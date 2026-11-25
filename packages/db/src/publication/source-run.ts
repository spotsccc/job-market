import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { sources } from './source.ts';

/** Итоги прохода `drain`: те же значения, что у `DrainResult.status` коннекторов. */
export const SOURCE_RUN_STATUSES = ['done', 'more', 'failed'] as const;

/**
 * История опросов: один проход `drain` одного источника с итогом (П9 в packages/db/src/monitoring/README.md). У
 * источника лежит только последняя ошибка и счётчик ошибок подряд — сколько опросов упало за
 * день, считается по этой таблице. Строку пишет `recordDrain` вместе с расписанием источника.
 */
export const sourceRuns = pgTable(
  'source_runs',
  {
    id: uuid().primaryKey().defaultRandom(),
    sourceId: uuid()
      .notNull()
      // История удалённого источника не нужна; источник с публикациями и так не удаляется.
      .references(() => sources.id, { onDelete: 'cascade' }),
    /** `done` — дочитан, `more` — продолжение в очереди, `failed` — сбой сервиса. */
    status: text({ enum: SOURCE_RUN_STATUSES }).notNull(),
    /** Сколько новых публикаций записал проход; у `failed` бывает больше нуля. */
    inserted: integer().notNull(),
    /** Текст ошибки прохода — та же строка, что `sources.last_error` (П10); есть только у `failed`. */
    error: text(),
    /** Когда задание начало проход: `now` задания. */
    startedAt: timestamp({ withTimezone: true }).notNull(),
    /** Когда записан итог: по нему проход попадает в сутки на дашборде. */
    finishedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('source_runs_status_check', sql`"status" IN ('done', 'more', 'failed')`),
    check('source_runs_inserted_check', sql`"inserted" >= 0`),
    check('source_runs_error_check', sql`("status" = 'failed') = ("error" IS NOT NULL)`),
    // Период дашборда.
    index('source_runs_finished_at_index').on(table.finishedAt),
    // Каскадное удаление источника и выбор по источнику.
    index('source_runs_source_id_index').on(table.sourceId),
  ],
);

export type SourceRunRow = typeof sourceRuns.$inferSelect;
export type NewSourceRunRow = typeof sourceRuns.$inferInsert;

/** Строка истории до записи: `finished_at` ставит база. */
export type SourceRunToSave = Readonly<
  Pick<NewSourceRunRow, 'status' | 'inserted' | 'error' | 'startedAt'>
>;
