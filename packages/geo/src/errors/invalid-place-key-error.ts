import { AppError } from '@job-market/errors';
import { createTaggedError } from '@spotsccc/error-as-value';

/** Строка не похожа на ключ места: `city:abc`, `country:XX`, `planet:1`. */
export class InvalidPlaceKeyError extends createTaggedError({
  name: 'InvalidPlaceKeyError',
  message: 'Invalid place key $key',
  extends: AppError,
}) {}
