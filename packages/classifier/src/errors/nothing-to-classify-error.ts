import { AppError } from '@job-market/errors';
import { createTaggedError } from '@spotsccc/error-as-value';

/**
 * В тексте публикации нет ни одной буквы (П2): `reason` — `empty` или `no_words` из
 * `skipReason`. Такую публикацию код разбора отсекает до классификатора, так что эта
 * ошибка значит, что вызывающий пропустил проверку.
 */
export class NothingToClassifyError extends createTaggedError({
  name: 'NothingToClassifyError',
  message: 'Nothing to classify: $reason',
  extends: AppError,
}) {}
