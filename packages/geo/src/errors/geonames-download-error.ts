import { AppError } from '@job-market/errors';
import { createTaggedError } from '@spotsccc/error-as-value';

/**
 * Дамп GeoNames не скачался: сеть, статус не 200 или длина файла не совпала с
 * `Content-Length` (оборванная загрузка). Кэш не меняется, миграция не пишется.
 */
export class GeonamesDownloadError extends createTaggedError({
  name: 'GeonamesDownloadError',
  message: 'Download of GeoNames file $file failed',
  extends: AppError,
}) {}
