import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { companies } from '../company/company.ts';
import { occupations } from '../occupation/occupation.ts';
import { publications } from '../publication/publication.ts';
import {
  EMPLOYMENT_TYPES,
  HIRING_PARTIES,
  SALARY_PERIODS,
  SENIORITIES,
  VACANCY_SCHEMA_VERSIONS,
  WORKPLACES,
} from './values.ts';
import type { LanguageLevel, VacancySchemaVersion } from './values.ts';

/** Тип Postgres `tsvector`: в TypeScript — строка, читать его приложению не нужно. */
export const tsvector = customType<{ data: string }>({
  dataType: () => 'tsvector',
});

/**
 * Текст для полнотекстового поиска: название — вес A; компания и навыки, обязательные и
 * «будет плюсом», — B; описание, места, зарплата, обязанности и требования — C, чтобы
 * слово из названия стояло выше. Условий (`benefits`) в поиске нет. Конфигурация
 * `russian` стеммит кириллицу русским стеммером, а латиницу — английским. Массивы
 * склеивает `immutable_array_to_string` из миграции `0001_vacancy_search`: обычный
 * `array_to_string` не immutable, и генерируемый столбец его не принимает.
 */
const searchVector = sql`setweight(to_tsvector('russian', "title"), 'A')
  || setweight(to_tsvector('russian', coalesce("company", '') || ' ' || immutable_array_to_string("skills", ' ') || ' ' || immutable_array_to_string("nice_skills", ' ')), 'B')
  || setweight(to_tsvector('russian', "summary" || ' ' || immutable_array_to_string("locations", ' ') || ' ' || coalesce("salary_raw", '') || ' ' || immutable_array_to_string("responsibilities", ' ') || ' ' || immutable_array_to_string("requirements", ' ')), 'C')`;

/** Как откликнуться. Все пустые и `directMessage: false` — способ в публикации не указан. */
export type VacancyApply = {
  readonly urls: readonly string[];
  readonly emails: readonly string[];
  /** Просят написать автору публикации в личку или в комментарии. */
  readonly directMessage: boolean;
};

/** Язык вакансии: `code` — ISO 639-1, `level` — уровень; `null` — уровень не назван. */
export type VacancyLanguage = {
  readonly code: string;
  readonly level: LanguageLevel | null;
};

const emptyTextArray = sql`'{}'::text[]`;

/**
 * Вакансия — одна роль, извлечённая из публикации: `position` — номер роли в ответе
 * экстрактора, повторный разбор перезаписывает строки по `(publicationId, position)`.
 * Места вакансии — строки `vacancy_locations`. Перечисления — `text` со списком
 * значений из `values.ts`, а не `pgEnum`: новое значение не требует миграции.
 */
export const vacancies = pgTable(
  'vacancies',
  {
    id: uuid().primaryKey().defaultRandom(),
    publicationId: uuid()
      .notNull()
      .references(() => publications.id, { onDelete: 'cascade' }),
    position: integer().notNull(),
    /**
     * Версия схемы экстрактора: `1` — без полей подробной вакансии, `2` — с ними. Без
     * версии у строки `1` «в тексте нет» не отличить от «не извлекали». Без DEFAULT:
     * версию ставит тот, кто пишет строку, и забытая версия — ошибка, а не тихая `1`.
     */
    schemaVersion: smallint().$type<VacancySchemaVersion>().notNull(),
    /** Название роли как в тексте. */
    title: text().notNull(),
    company: text(),
    /** Сайт компании или её страница. */
    companyUrl: text(),
    hiringParty: text({ enum: HIRING_PARTIES }).notNull(),
    /**
     * Компания из справочника: её находит сопоставление по `company` и `companyUrl` (П3,
     * packages/db/src/company/README.md).
     * `null` — у вакансии нет ни одного ключа компании.
     */
    companyId: uuid().references(() => companies.id, { onDelete: 'restrict' }),
    /**
     * Самый конкретный узел дерева профессий, который подтверждает текст; `root` — отнести
     * никуда не удалось. `null` — у строки версии `1`.
     */
    occupationId: text().references(() => occupations.id, { onDelete: 'restrict' }),
    /**
     * Профессия, которой нет в дереве, словами модели: заполнено, только если модель
     * остановилась на внутреннем узле или `root`, потому что подходящего листа нет.
     */
    suggestedOccupation: text(),
    seniority: text({ enum: SENIORITIES }),
    /** Сколько лет опыта нужно как минимум; `null` — число не названо. */
    experienceYearsMin: smallint(),
    workplace: text({ enum: WORKPLACES }),
    /** Можно работать из любой страны: «откуда угодно» — не место справочника, а отсутствие ограничения. */
    isRemoteFromAnywhere: boolean().notNull(),
    /**
     * Места как в тексте. С версии `2` — `raw` мест вакансии по порядку, включая «откуда
     * угодно»: копия нужна поиску, генерируемый столбец не видит других таблиц.
     */
    locations: text().array().notNull().default(emptyTextArray),
    employmentTypes: text({ enum: EMPLOYMENT_TYPES }).array().notNull().default(emptyTextArray),
    salaryMin: numeric({ mode: 'number' }),
    salaryMax: numeric({ mode: 'number' }),
    /** Код ISO 4217: `EUR`, `USD`. */
    salaryCurrency: text(),
    salaryPeriod: text({ enum: SALARY_PERIODS }),
    /** Зарплата дословно. `null` — зарплаты нет. */
    salaryRaw: text(),
    /** `true` — до налогов, `false` — на руки; `null` — не сказано. */
    salaryGross: boolean(),
    /** Предлагают долю или опционы; `null` — не сказано. */
    equity: boolean(),
    /** Навыки и технологии; с версии `2` — только обязательные. */
    skills: text().array().notNull().default(emptyTextArray),
    /** Навыки «будет плюсом». */
    niceSkills: text().array().notNull().default(emptyTextArray),
    /** Языки; jsonb, а не два параллельных массива, чтобы язык и уровень не разъехались. */
    languages: jsonb()
      .$type<readonly VacancyLanguage[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    relocation: boolean(),
    visaSponsorship: boolean(),
    apply: jsonb().$type<VacancyApply>().notNull(),
    /** Одно-два предложения на русском: чем занимается команда и что делать на роли. */
    summary: text().notNull(),
    /** Обязанности пунктами. */
    responsibilities: text().array().notNull().default(emptyTextArray),
    /** Требования пунктами, кроме навыков-тегов. */
    requirements: text().array().notNull().default(emptyTextArray),
    /** Условия и бонусы пунктами. */
    benefits: text().array().notNull().default(emptyTextArray),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    /** Поисковый вектор; Postgres пересчитывает его сам при каждой записи строки. */
    searchVector: tsvector().notNull().generatedAlwaysAs(searchVector),
  },
  (table) => [
    unique('vacancies_publication_id_position_unique').on(table.publicationId, table.position),
    check(
      'vacancies_schema_version_check',
      sql`"schema_version" IN (${sql.raw(VACANCY_SCHEMA_VERSIONS.join(', '))})`,
    ),
    // У строки версии 2 профессия есть всегда, хотя бы root.
    check('vacancies_occupation_check', sql`"schema_version" = 1 OR "occupation_id" IS NOT NULL`),
    // Больше 30 лет — ошибка разбора, а не требование.
    check('vacancies_experience_years_min_check', sql`"experience_years_min" BETWEEN 0 AND 30`),
    check('vacancies_languages_check', sql`jsonb_typeof("languages") = 'array'`),
    index('vacancies_created_at_index').on(table.createdAt),
    index('vacancies_search_vector_index').using('gin', table.searchVector),
    // Фильтр по поддереву профессий и пересчёт по узлу.
    index('vacancies_occupation_id_index').on(table.occupationId),
    // Вакансии компании: фильтр и слияние.
    index('vacancies_company_id_index').on(table.companyId),
  ],
);

export type VacancyRow = typeof vacancies.$inferSelect;
export type NewVacancyRow = typeof vacancies.$inferInsert;
