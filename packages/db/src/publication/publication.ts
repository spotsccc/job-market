import { relations, sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import { authors } from './author.ts';
import { sources } from './source.ts';
import { CONNECTORS, NOT_VACANCY_REASONS, PUBLICATION_STATUSES } from './values.ts';

/**
 * Одна публикация на площадке: сообщение Telegram-канала, пост LinkedIn. Вакансия или
 * пост LinkedIn по ссылке — не отдельная публикация, а раздел в конце `content` той, где
 * ссылка. Публикация определяется `(connector, externalId)` и записывается один раз, какой
 * бы источник её ни нашёл. Пишут сюда и публикации, которые не вакансии.
 */
export const publications = pgTable(
  'publications',
  {
    id: uuid().primaryKey().defaultRandom(),
    /** Источник, который нашёл публикацию первым; другие источники её уже не записывают. */
    sourceId: uuid().notNull(),
    /**
     * Коннектор публикации — копия коннектора источника: UNIQUE и ON CONFLICT видят только
     * столбцы своей таблицы, а id публикации уникален внутри коннектора. Составной ключ на
     * `sources (id, connector)` не даёт копии разойтись с источником. Платформы здесь нет —
     * она у источника.
     */
    connector: text({ enum: CONNECTORS }).notNull(),
    /** Id публикации внутри коннектора: `forhr/9120` у open-telegram, id поста у linkedin. */
    externalId: text().notNull(),
    url: text().notNull(),
    /**
     * Текст в Markdown со ссылками. Пустая строка — текста нет. Если в тексте есть ссылки
     * на LinkedIn, в конце — разделы с прочитанным по ним.
     */
    content: text().notNull(),
    /** Когда опубликована; площадка не сообщает дату — когда найдена. */
    postedAt: timestamp({ withTimezone: true }).notNull(),
    /** Поля, которые парсер отдаёт обработчику своего коннектора; форма своя у каждого. */
    payload: jsonb(),
    /** Хэш текста до разделов по ссылкам: по нему ищутся копии одной вакансии. */
    contentHash: text().notNull(),
    status: text({ enum: PUBLICATION_STATUSES }).notNull().default('pending'),
    /** Сколько раз публикацию брали в разбор. */
    attempts: integer().notNull().default(0),
    /** Когда публикацию последний раз взяли в разбор. */
    claimedAt: timestamp({ withTimezone: true }),
    /** Когда разбор закончился, с любым итогом. */
    processedAt: timestamp({ withTimezone: true }),
    /** Ошибка последнего неудачного разбора. */
    lastError: text(),
    notVacancyReason: text({ enum: NOT_VACANCY_REASONS }),
    /** Пояснение классификатора, почему не вакансия. */
    note: text(),
    /** Публикация с тем же текстом, которая разобрана вместо этой. */
    duplicateOfId: uuid().references((): AnyPgColumn => publications.id, {
      onDelete: 'set null',
    }),
    /** Автор публикации. `null` — площадка автора не сообщает. */
    authorId: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Источник с публикациями не удаляется, только выключается.
    foreignKey({
      columns: [table.sourceId, table.connector],
      foreignColumns: [sources.id, sources.connector],
    }).onDelete('restrict'),
    // Автор — из коннектора публикации; при `author_id` NULL ключ не проверяется (MATCH SIMPLE).
    foreignKey({
      columns: [table.authorId, table.connector],
      foreignColumns: [authors.id, authors.connector],
    }).onDelete('restrict'),
    unique('publications_connector_external_id_unique').on(table.connector, table.externalId),
    check(
      'publications_status_check',
      sql`"status" IN ('pending', 'processing', 'vacancy', 'not_vacancy', 'duplicate', 'empty', 'failed')`,
    ),
    // Поиск копии по тексту.
    index('publications_content_hash_index').on(table.contentHash),
    // Застрявшие в разборе публикации.
    index('publications_status_claimed_at_index')
      .on(table.status, table.claimedAt)
      .where(sql`"status" IN ('pending', 'processing')`),
    // Счётчики найденного по источникам.
    index('publications_source_id_index').on(table.sourceId),
    // Публикации и вакансии одного автора.
    index('publications_author_id_index')
      .on(table.authorId)
      .where(sql`"author_id" IS NOT NULL`),
  ],
);

export type PublicationRow = typeof publications.$inferSelect;
export type NewPublicationRow = typeof publications.$inferInsert;

/** `db.query.sources.findMany({ with: { publications: true } })` — что нашёл источник. */
export const sourcePublicationsRelations = relations(sources, ({ many }) => ({
  publications: many(publications),
}));

/** `db.query.authors.findMany({ with: { publications: true } })` — что написал автор. */
export const authorPublicationsRelations = relations(authors, ({ many }) => ({
  publications: many(publications),
}));
