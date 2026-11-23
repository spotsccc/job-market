import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { tsvector } from '../vacancy/vacancy.ts';
import type { VacancyApply } from '../vacancy/vacancy.ts';
import {
  EMPLOYMENT_TYPES,
  HIRING_PARTIES,
  SALARY_PERIODS,
  SENIORITIES,
  WORKPLACES,
} from '../vacancy/values.ts';
import { legacyPosts } from './legacy-post.ts';

/**
 * Текст для полнотекстового поиска: название — вес A, компания и навыки — B, описание,
 * локации и зарплата — C. Массивы склеивает `immutable_array_to_string` из миграции
 * `0001_vacancy_search`: обычный `array_to_string` генерируемый столбец не принимает.
 */
const searchVector = sql`setweight(to_tsvector('russian', "title"), 'A')
  || setweight(to_tsvector('russian', coalesce("company", '') || ' ' || immutable_array_to_string("skills", ' ')), 'B')
  || setweight(to_tsvector('russian', "summary" || ' ' || immutable_array_to_string("locations", ' ') || ' ' || coalesce("salary_raw", '')), 'C')`;

/**
 * Вакансия старой модели: таблица `legacy_vacancies`, бывшая `vacancies`. Её заменит
 * новая `vacancies` из `../vacancy`: строки перенесёт план 1 после нового экстрактора.
 *
 * Вакансия, извлечённая моделью из поста. В одном посте бывает несколько ролей:
 * `position` — номер роли в ответе модели, повторный разбор поста перезаписывает
 * строки по `(postId, position)`. Перечисления — `text` со списком значений из
 * `../vacancy/values.ts`, а не `pgEnum`: новое значение не требует миграции.
 */
export const legacyVacancies = pgTable(
  'legacy_vacancies',
  {
    id: uuid().primaryKey().defaultRandom(),
    postId: uuid()
      .notNull()
      .references(() => legacyPosts.id, { onDelete: 'cascade' }),
    position: integer().notNull(),
    title: text().notNull(),
    company: text(),
    companyUrl: text(),
    hiringParty: text({ enum: HIRING_PARTIES }).notNull(),
    seniority: text({ enum: SENIORITIES }),
    workplace: text({ enum: WORKPLACES }),
    isRemoteFromAnywhere: boolean().notNull(),
    /** Города и страны офиса или регионы найма для удалёнки, как в посте. */
    locations: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    employmentTypes: text({ enum: EMPLOYMENT_TYPES })
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    salaryMin: numeric({ mode: 'number' }),
    salaryMax: numeric({ mode: 'number' }),
    /** Код ISO 4217: `EUR`, `USD`. */
    salaryCurrency: text(),
    salaryPeriod: text({ enum: SALARY_PERIODS }),
    /** Зарплата дословно как в посте. `null` — зарплаты в посте нет. */
    salaryRaw: text(),
    skills: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    relocation: boolean(),
    visaSponsorship: boolean(),
    apply: jsonb().$type<VacancyApply>().notNull(),
    summary: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    /**
     * Поисковый вектор по названию (вес A), компании и навыкам (B), описанию,
     * локациям и зарплате (C). Postgres пересчитывает его сам при каждой записи
     * строки. Текста поста в нём нет: генерируемый столбец не видит другие таблицы.
     */
    searchVector: tsvector().notNull().generatedAlwaysAs(searchVector),
  },
  (table) => [
    unique('legacy_vacancies_post_id_position_unique').on(table.postId, table.position),
    index().on(table.createdAt),
    index().using('gin', table.searchVector),
  ],
);

export type LegacyVacancyRow = typeof legacyVacancies.$inferSelect;
export type NewLegacyVacancyRow = typeof legacyVacancies.$inferInsert;

/** `db.query.legacyVacancies.findMany({ with: { post: true } })`. */
export const legacyVacanciesRelations = relations(legacyVacancies, ({ one }) => ({
  post: one(legacyPosts, { fields: [legacyVacancies.postId], references: [legacyPosts.id] }),
}));

/**
 * Обратная сторона: `db.query.legacyPosts.findMany({ with: { vacancies: true } })`. Лежит
 * здесь, а не в `legacy-post.ts`: пост не знает о вакансиях, связь объявляет тот, кто на
 * него ссылается. Drizzle сливает все `relations()` одной таблицы, так что другие
 * домены добавляют свои связи поста так же.
 */
export const legacyPostVacanciesRelations = relations(legacyPosts, ({ many }) => ({
  vacancies: many(legacyVacancies),
}));
