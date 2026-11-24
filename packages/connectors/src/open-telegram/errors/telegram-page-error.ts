import { AppError } from '@job-market/errors';
import { createTaggedError } from '@spotsccc/error-as-value';

/**
 * Страница превью скачалась, но не разбирается: у канала выключено превью или
 * Telegram поменял разметку. Причина — в `cause`.
 */
export class TelegramPageError extends createTaggedError({
  name: 'TelegramPageError',
  message: 'Page of channel $channel has unexpected shape',
  extends: AppError,
}) {}
