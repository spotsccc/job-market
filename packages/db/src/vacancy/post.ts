import { POST_SOURCES } from '@job-market/core';
import { pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

/**
 * Пост из источника (LinkedIn и другие), из которого извлекаем вакансии. Таблица
 * общая для всех источников: `source` говорит, откуда пост, `externalId` — его id
 * в источнике. Повторный сбор того же поста — upsert по `(source, externalId)`.
 * Связи поста с вакансиями — в `vacancy.ts`, рядом с таблицей, которая на него ссылается.
 */
export const posts = pgTable(
  'posts',
  {
    id: uuid().primaryKey().defaultRandom(),
    source: text({ enum: POST_SOURCES }).notNull(),
    /** Id поста в источнике строкой. LinkedIn — числовой id активности: `7330988768578920448`. */
    externalId: text().notNull(),
    url: text().notNull(),
    /** Текст поста. Пустая строка — репост или пост из одних картинок. */
    content: text().notNull(),
    postedAt: timestamp({ withTimezone: true }).notNull(),
    authorName: text().notNull(),
    /** Ссылка на профиль человека или страницу компании. */
    authorUrl: text().notNull(),
    /** Подпись автора в профиле: должность, «Hiring at Acme». */
    authorHeadline: text(),
    /** Имя пользователя автора в источнике. LinkedIn — часть ссылки профиля после `/in/`, у компаний её нет. */
    authorHandle: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('posts_source_external_id_unique').on(table.source, table.externalId)],
);

export type PostRow = typeof posts.$inferSelect;
export type NewPostRow = typeof posts.$inferInsert;
