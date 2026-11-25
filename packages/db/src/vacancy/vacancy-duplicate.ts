import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { publications } from '../publication/publication.ts';

/**
 * Дубль вакансии: роль, которую разбор публикации извлёк, но не записал вакансией — она уже
 * сохранена из другой публикации (П18–П20, packages/db/src/publication/README.md). Строки пишет
 * `saveVacancies` с `skipDuplicates` вместе с вакансиями (П13 в packages/db/src/monitoring/README.md); по ним дашборд
 * считает дубли вакансий.
 */
export const vacancyDuplicates = pgTable(
  'vacancy_duplicates',
  {
    id: uuid().primaryKey().defaultRandom(),
    /** Публикация, при разборе которой роль оказалась дублем: по ней — источник и площадка. */
    publicationId: uuid()
      .notNull()
      .references(() => publications.id, { onDelete: 'cascade' }),
    /**
     * Публикация, из которой роль уже сохранена вакансией: элемент `SaveSummary.duplicateOf`.
     * Без оригинала роль уже не дубль.
     */
    originalId: uuid()
      .notNull()
      .references(() => publications.id, { onDelete: 'cascade' }),
    /** Название роли, как его извлекла модель. */
    title: text().notNull(),
    /** Когда записан разбор, который нашёл дубль. */
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Стереть дубли публикации при повторной записи ролей.
    index('vacancy_duplicates_publication_id_index').on(table.publicationId),
    // Период дашборда.
    index('vacancy_duplicates_created_at_index').on(table.createdAt),
  ],
);

export type VacancyDuplicateRow = typeof vacancyDuplicates.$inferSelect;
export type NewVacancyDuplicateRow = typeof vacancyDuplicates.$inferInsert;
