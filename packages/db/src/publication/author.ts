import { pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { CONNECTORS } from './values.ts';

/**
 * Автор публикаций: человек или компания в LinkedIn, канал в Telegram. Один
 * автор — одна строка, сколько бы публикаций он ни написал. Хранятся последние имя,
 * ссылка и подпись, а не те, что были в день публикации.
 */
export const authors = pgTable(
  'authors',
  {
    id: uuid().primaryKey().defaultRandom(),
    /**
     * Коннектор, который читает публикации автора. Id автора уникален только внутри
     * коннектора, как id публикации: у одной площадки бывает несколько коннекторов с разными id.
     */
    connector: text({ enum: CONNECTORS }).notNull(),
    /**
     * Id автора внутри коннектора: юзернейм канала у Telegram, путь профиля `in/jane-doe` или
     * `company/acme` у LinkedIn — у компаний LinkedIn нет handle, а путь профиля есть у всех.
     */
    externalId: text().notNull(),
    /** Имя человека, компании или канала. */
    name: text().notNull(),
    /** Ссылка на профиль или канал. */
    url: text().notNull(),
    /** Подпись в профиле: должность, «Hiring at Acme». Есть только у LinkedIn. */
    headline: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique('authors_connector_external_id_unique').on(table.connector, table.externalId),
    // Цель составного ключа из publications: автор — из коннектора своей публикации.
    unique('authors_id_connector_unique').on(table.id, table.connector),
  ],
);

export type AuthorRow = typeof authors.$inferSelect;
export type NewAuthorRow = typeof authors.$inferInsert;
