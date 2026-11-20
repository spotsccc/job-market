import { AppError } from '@job-market/errors';
import { createTaggedError } from '@spotsccc/error-as-value';

/**
 * Запрос не дошёл до ответа: сеть, DNS, обрыв соединения или отмена через `signal`.
 * Отмену отличайте через `isAbortError(error)`, таймаут `AbortSignal.timeout` — через
 * `isTimeoutError(error)`: оба ищут причину в цепочке `cause`.
 */
export class HttpNetworkError extends createTaggedError({
  name: 'HttpNetworkError',
  message: 'Request $method $path failed',
  extends: AppError,
}) {}
