import {
  EMPLOYMENT_TYPES,
  HIRING_PARTIES,
  SALARY_PERIODS,
  SENIORITIES,
  WORKPLACES,
} from '@job-market/core';
import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  customType,
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

import { posts } from './post.ts';

/** Тип Postgres `tsvector`: в TypeScript — строка, читать его приложению не нужно. */
const tsvector = customType<{ data: string }>({
  dataType: () => 'tsvector',
});

/**
 * Текст для полнотекстового поиска. Конфигурация `russian` стеммит кириллицу
 * русским стеммером, а латиницу — английским, поэтому подходит постам на обоих
 * языках: «разработчик» находит «разработчиков», «developer» — «Developers».
 * Массивы склеиваем функцией `immutable_array_to_string` из миграции: обычный
 * `array_to_string` не immutable, и генерируемый столбец его не принимает.
 */
const searchVector = sql`setweight(to_tsvector('russian', "title"), 'A')
  || setweight(to_tsvector('russian', coalesce("company", '') || ' ' || immutable_array_to_string("skills", ' ')), 'B')
  || setweight(to_tsvector('russian', "summary" || ' ' || immutable_array_to_string("locations", ' ') || ' ' || coalesce("salary_raw", '')), 'C')`;

/** Как откликнуться. Все пустые и `directMessage: false` — способ в посте не указан. */
export type VacancyApply = {
  readonly urls: readonly string[];
  readonly emails: readonly string[];
  /** Просят написать автору поста в личку или в комментарии. */
  readonly directMessage: boolean;
};

/**
 * Вакансия, извлечённая моделью из поста. В одном посте бывает несколько ролей:
 * `position` — номер роли в ответе модели, повторный разбор поста перезаписывает
 * строки по `(postId, position)`. Перечисления — `text` со списком значений из
 * `@job-market/core`, а не `pgEnum`: новое значение не требует миграции.
 */
export const vacancies = pgTable(
  'vacancies',
  {
    id: uuid().primaryKey().defaultRandom(),
    postId: uuid()
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
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
    unique('vacancies_post_id_position_unique').on(table.postId, table.position),
    index().on(table.createdAt),
    index().using('gin', table.searchVector),
  ],
);

export type VacancyRow = typeof vacancies.$inferSelect;
export type NewVacancyRow = typeof vacancies.$inferInsert;

/** `db.query.vacancies.findMany({ with: { post: true } })`. */
export const vacanciesRelations = relations(vacancies, ({ one }) => ({
  post: one(posts, { fields: [vacancies.postId], references: [posts.id] }),
}));

/**
 * Обратная сторона: `db.query.posts.findMany({ with: { vacancies: true } })`. Лежит
 * здесь, а не в `post.ts`: пост не знает о вакансиях, связь объявляет тот, кто на
 * него ссылается. Drizzle сливает все `relations()` одной таблицы, так что другие
 * домены добавляют свои связи поста так же.
 */
export const postVacanciesRelations = relations(posts, ({ many }) => ({
  vacancies: many(vacancies),
}));
