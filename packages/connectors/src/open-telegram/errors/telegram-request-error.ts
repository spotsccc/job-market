import { AppError } from '@job-market/errors';
import { createTaggedError } from '@spotsccc/error-as-value';

/** Страница превью не скачалась: сеть, таймаут или статус не 2xx (в `cause`). */
export class TelegramRequestError extends createTaggedError({
  name: 'TelegramRequestError',
  message: 'Request for page of channel $channel failed',
  extends: AppError,
}) {}
