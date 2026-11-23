/**
 * Значения столбцов домена публикаций. В базе это `text`, а не `pgEnum`: новое значение —
 * новая строка здесь, миграция не нужна. Без drizzle и `pg`: их берёт и схема ответа модели
 * через `@job-market/db/values`.
 */

/**
 * Коннектор — код, который читает источник и разбирает его публикации. Это не площадка:
 * коннектор говорит, как читать, а площадка — где опубликовано.
 */
export const CONNECTORS = ['open-telegram', 'linkedin'] as const;

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

/**
 * Почему пост не вакансия. Это обычный результат, а не ошибка.
 * - `job_seeker` — автор ищет работу сам: «open to work», резюме;
 * - `no_specific_role` — про найм, но без конкретной роли: «мы растём», «скоро откроем позиции»;
 * - `not_hiring` — не про найм: статья, мнение, новость, реклама.
 */
export const NOT_VACANCY_REASONS = ['job_seeker', 'no_specific_role', 'not_hiring'] as const;
export type NotVacancyReason = (typeof NOT_VACANCY_REASONS)[number];
