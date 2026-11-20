import { AppError } from '@job-market/errors';
import { createTaggedError } from '@spotsccc/error-as-value';

/** Сервер ответил статусом вне 2xx. По `status` вызывающий решает, повторять ли запрос. */
export class HttpStatusError extends createTaggedError({
  name: 'HttpStatusError',
  message: 'Request $method $path failed with status $status',
  extends: AppError,
}) {}
