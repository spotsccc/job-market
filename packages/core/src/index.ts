/**
 * Значения полей поста и вакансии. Общие для схемы ответа модели (`apps/web`) и
 * таблиц базы (`@job-market/db`): новое значение добавляется здесь и попадает в обе.
 */

/** Откуда пост. Новый источник — новое значение здесь, миграция не нужна. */
export const POST_SOURCES = ['linkedin'] as const;
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
