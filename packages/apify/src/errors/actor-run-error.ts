import { AppError } from '@job-market/errors';
import { createTaggedError } from '@spotsccc/error-as-value';

/**
 * Запуск актора завершился не статусом `SUCCEEDED`: `FAILED`, `ABORTED`, `TIMED-OUT`
 * или ещё идёт, если истёк `waitSecs`. По `runId` запуск можно найти в консоли Apify.
 */
export class ActorRunError extends createTaggedError({
  name: 'ActorRunError',
  message: 'Actor run $runId finished with status $status',
  extends: AppError,
}) {}
