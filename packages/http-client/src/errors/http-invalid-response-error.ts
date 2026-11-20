import { AppError } from '@job-market/errors';
import { createTaggedError } from '@spotsccc/error-as-value';

/** Тело ответа не JSON или не прошло `parse`. Исходная причина лежит в `cause`. */
export class HttpInvalidResponseError extends createTaggedError({
  name: 'HttpInvalidResponseError',
  message: 'Invalid response for $method $path',
  extends: AppError,
}) {}
