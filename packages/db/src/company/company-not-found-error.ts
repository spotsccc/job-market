import { AppError } from '@job-market/errors';
import { createTaggedError } from '@spotsccc/error-as-value';

/** Компании для слияния нет (П7): ничего не меняется. */
export class CompanyNotFoundError extends createTaggedError({
  name: 'CompanyNotFoundError',
  message: 'Company $id not found',
  extends: AppError,
}) {}
