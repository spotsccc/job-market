import { AppError } from '@job-market/errors';
import { createTaggedError } from '@spotsccc/error-as-value';

/**
 * Запрос к справочнику не выполнился: нет связи с базой, пул закрыт, ошибка SQL.
 * Ненайденное место этой ошибкой не считается (П12).
 */
export class GeoQueryError extends createTaggedError({
  name: 'GeoQueryError',
  message: 'Geo directory query failed',
  extends: AppError,
}) {}
