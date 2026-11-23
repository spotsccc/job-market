/**
 * Значения полей поста и вакансии. Общие для схемы ответа модели (`apps/web`) и
 * таблиц базы (`@job-market/db`): новое значение добавляется здесь и попадает в обе.
 */

/** Откуда пост. Новый источник — новое значение здесь, миграция не нужна. */
export const POST_SOURCES = ['linkedin', 'telegram'] as const;
export type PostSource = (typeof POST_SOURCES)[number];

export const WORKPLACES = ['remote', 'hybrid', 'onsite'] as const;
export type Workplace = (typeof WORKPLACES)[number];

export function isWorkplace(value: string): value is Workplace {
  return WORKPLACES.some((workplace) => workplace === value);
}

/** Кто нанимает: сама компания или агентство/внешний рекрутёр. */
export const HIRING_PARTIES = ['employer', 'agency', 'unknown'] as const;
export type HiringParty = (typeof HIRING_PARTIES)[number];

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
export type SalaryPeriod = (typeof SALARY_PERIODS)[number];

/**
 * Почему пост не вакансия. Это обычный результат, а не ошибка.
 * - `job_seeker` — автор ищет работу сам: «open to work», резюме;
 * - `no_specific_role` — про найм, но без конкретной роли: «мы растём», «скоро откроем позиции»;
 * - `not_hiring` — не про найм: статья, мнение, новость, реклама.
 */
export const NOT_VACANCY_REASONS = ['job_seeker', 'no_specific_role', 'not_hiring'] as const;
export type NotVacancyReason = (typeof NOT_VACANCY_REASONS)[number];

/**
 * Коннектор — код, который читает источник и разбирает его публикации. Это не площадка:
 * коннектор говорит, как читать, а площадка — где опубликовано. Новый коннектор —
 * новое значение здесь, миграция не нужна.
 */
export const CONNECTORS = ['open-telegram', 'linkedin'] as const;
export type Connector = (typeof CONNECTORS)[number];

/**
 * Где публикация в разборе:
 * - `pending` — ждёт разбора, `processing` — разбирается;
 * - `vacancy`, `not_vacancy` — итог классификатора;
 * - `duplicate` — копия уже разобранной публикации с тем же текстом;
 * - `empty` — текста нет, разбирать нечего;
 * - `failed` — разбор упал, ошибка в `last_error`.
 */
export const PUBLICATION_STATUSES = [
  'pending',
  'processing',
  'vacancy',
  'not_vacancy',
  'duplicate',
  'empty',
  'failed',
] as const;
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];

/** Роль места вакансии: `office` — где офис, `hiring` — откуда можно работать. */
export const LOCATION_ROLES = ['office', 'hiring'] as const;
export type LocationRole = (typeof LOCATION_ROLES)[number];

/**
 * Итог сведения места вакансии к гео-справочнику:
 * - `resolved` — место найдено;
 * - `partial` — найдена страна, город нет;
 * - `not_found` — ничего не найдено;
 * - `ambiguous` — подходит несколько мест, выбрать нельзя.
 */
export const RESOLUTIONS = ['resolved', 'partial', 'not_found', 'ambiguous'] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

/** Уровень языка по CEFR или родной. */
export const LANGUAGE_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'native'] as const;
export type LanguageLevel = (typeof LANGUAGE_LEVELS)[number];

/**
 * Версия схемы экстрактора, которой записана вакансия: `1` — без полей подробной
 * вакансии (профессии, мест, опыта, языков, разделов описания), `2` — с ними.
 */
export const VACANCY_SCHEMA_VERSIONS = [1, 2] as const;
export type VacancySchemaVersion = (typeof VACANCY_SCHEMA_VERSIONS)[number];
