import { AppError } from '@job-market/errors';
import { createTaggedError } from '@spotsccc/error-as-value';

/** Компанию сливают саму с собой (П7): ничего не меняется. */
export class SameCompanyError extends createTaggedError({
  name: 'SameCompanyError',
  message: 'Company $id cannot be merged into itself',
  extends: AppError,
}) {}
