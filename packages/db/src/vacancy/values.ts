/**
 * Значения столбцов домена вакансий. В базе это `text`, а не `pgEnum`: новое значение —
 * новая строка здесь, миграция не нужна. Без drizzle и `pg`: их берёт и схема ответа модели
 * через `@job-market/db/values`.
 */

export const WORKPLACES = ['remote', 'hybrid', 'onsite'] as const;
export type Workplace = (typeof WORKPLACES)[number];

/** Кто нанимает: сама компания или агентство/внешний рекрутёр. */
export const HIRING_PARTIES = ['employer', 'agency', 'unknown'] as const;

export const SENIORITIES = ['intern', 'junior', 'middle', 'senior', 'lead', 'principal'] as const;
export type Seniority = (typeof SENIORITIES)[number];

export const EMPLOYMENT_TYPES = [
  'full_time',
  'part_time',
  'contract',
  'freelance',
  'internship',
] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const SALARY_PERIODS = ['year', 'month', 'day', 'hour'] as const;

/** Уровень языка по CEFR или родной. */
export const LANGUAGE_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'native'] as const;
export type LanguageLevel = (typeof LANGUAGE_LEVELS)[number];

/**
 * Версия схемы экстрактора, которой записана вакансия: `1` — без полей подробной
 * вакансии (профессии, мест, опыта, языков, разделов описания), `2` — с ними.
 */
export const VACANCY_SCHEMA_VERSIONS = [1, 2] as const;
export type VacancySchemaVersion = (typeof VACANCY_SCHEMA_VERSIONS)[number];

/** Роль места вакансии: `office` — где офис, `hiring` — откуда можно работать. */
export const LOCATION_ROLES = ['office', 'hiring'] as const;

/**
 * Итог сведения места вакансии к гео-справочнику:
 * - `resolved` — место найдено;
 * - `partial` — найдена страна, город нет;
 * - `not_found` — ничего не найдено;
 * - `ambiguous` — подходит несколько мест, выбрать нельзя.
 */
export const RESOLUTIONS = ['resolved', 'partial', 'not_found', 'ambiguous'] as const;
