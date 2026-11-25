import { AppError } from '@job-market/errors';
import { createTaggedError } from '@spotsccc/error-as-value';

/**
 * Доска вакансий не прочиталась (П6): статус не 2xx, сбой сети, таймаут или ответ не по схеме.
 * Причина — ошибка http-client в `cause`.
 */
export class GreenhouseRequestError extends createTaggedError({
  name: 'GreenhouseRequestError',
  message: 'Greenhouse board $board request failed',
  extends: AppError,
}) {}
