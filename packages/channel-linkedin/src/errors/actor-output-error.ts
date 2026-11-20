import { AppError } from '@job-market/errors';
import { createTaggedError } from '@spotsccc/error-as-value';

/** Элемент датасета не прошёл `parseItem`: актор поменял формат вывода. Причина лежит в `cause`. */
export class ActorOutputError extends createTaggedError({
  name: 'ActorOutputError',
  message: 'Item $index of run $runId has unexpected shape',
  extends: AppError,
}) {}
