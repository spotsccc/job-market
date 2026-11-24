import { sql } from 'drizzle-orm';
import { check, index, pgTable, primaryKey, smallint, text, uuid } from 'drizzle-orm/pg-core';

import { publications } from './publication.ts';
import { LINK_STATUSES } from './values.ts';

/**
 * Ссылка из текста публикации и что енричер с ней сделал. Нужна для статистики: какие
 * сайты встречаются чаще и для каких добавить читателя, какие ссылки не открываются.
 * Ссылки внутри разделов сюда не входят. Повторная запись публикации перезаписывает её
 * ссылки целиком.
 */
export const publicationLinks = pgTable(
  'publication_links',
  {
    publicationId: uuid()
      .notNull()
      .references(() => publications.id, { onDelete: 'cascade' }),
    /** Номер ссылки в тексте автора, с нуля; повтор той же ссылки номера не получает. */
    position: smallint().notNull(),
    /** Ссылка как в тексте. */
    url: text().notNull(),
    /** Куда ведёт короткая ссылка (lnkd.in); у обычной и не раскрытой — NULL. */
    targetUrl: text(),
    /**
     * Хост `target_url`, а без него — `url`, в нижнем регистре. Почему отдельным столбцом:
     * статистика по сайтам — GROUP BY по нему, без разбора ссылки в SQL.
     */
    host: text().notNull(),
    status: text({ enum: LINK_STATUSES }).notNull(),
    /** Читатель, который узнал ссылку, или `short-link`; ссылка без читателя — NULL. */
    reader: text(),
    /** Ошибка при `failed`: сообщение и причина одной строкой. */
    error: text(),
  },
  (table) => [
    primaryKey({ columns: [table.publicationId, table.position] }),
    check('publication_links_position_check', sql`"position" >= 0`),
    check(
      'publication_links_status_check',
      sql`"status" IN ('read', 'no_data', 'failed', 'unsupported', 'over_limit')`,
    ),
    check('publication_links_error_check', sql`("status" = 'failed') = ("error" IS NOT NULL)`),
    // Статистика по сайтам и статусам.
    index('publication_links_host_status_index').on(table.host, table.status),
  ],
);

export type PublicationLinkRow = typeof publicationLinks.$inferSelect;
export type NewPublicationLinkRow = typeof publicationLinks.$inferInsert;
