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
export type Connector = (typeof CONNECTORS)[number];

/**
 * Где публикация в разборе:
 * - `pending` — ждёт разбора, `processing` — разбирается;
 * - `vacancy`, `not_vacancy` — итог разбора; почему не вакансия — в `not_vacancy_reason`;
 * - `duplicate` — копия уже разобранной публикации с тем же текстом;
 * - `failed` — разбор упал, ошибка в `last_error`.
 */
export const PUBLICATION_STATUSES = [
  'pending',
  'processing',
  'vacancy',
  'not_vacancy',
  'duplicate',
  'failed',
] as const;

/**
 * Что енричер сделал со ссылкой из текста публикации:
 * - `read` — прочитана, раздел есть в `content`;
 * - `no_data` — читатель ответил, но читать нечего: вакансия закрыта, пост удалён, короткая
 *   ссылка никуда не ведёт;
 * - `failed` — сбой чтения или раскрытия, ошибка в `error`;
 * - `unsupported` — ни один читатель её не узнал;
 * - `over_limit` — читатель узнал, но в тексте уже три читаемые ссылки, или короткая ссылка
 *   сверх десяти раскрываемых.
 */
export const LINK_STATUSES = ['read', 'no_data', 'failed', 'unsupported', 'over_limit'] as const;
export type LinkStatus = (typeof LINK_STATUSES)[number];

/**
 * Почему публикация не вакансия. Это обычный результат, а не ошибка. По причинам видно, какие
 * источники приносят пустое и мусор.
 * - `empty` — в тексте нет ни одной буквы: картинка без подписи, одни эмодзи; модель не звалась;
 * - `trash` — текст есть, но это не вакансия: резюме, «мы растём», статья, реклама. Что именно —
 *   в `note`.
 */
export const NOT_VACANCY_REASONS = ['empty', 'trash'] as const;
export type NotVacancyReason = (typeof NOT_VACANCY_REASONS)[number];
