import { AppError } from '@job-market/errors';
import { createTaggedError } from '@spotsccc/error-as-value';

/**
 * Ошибка в `regions.ts` или `manual-aliases.ts` (П4): код страны не из справочника,
 * повтор кода региона, регион без стран. Миграция не пишется.
 */
export class ManualDataError extends createTaggedError({
  name: 'ManualDataError',
  message: '$entry: $problem',
  extends: AppError,
}) {}
