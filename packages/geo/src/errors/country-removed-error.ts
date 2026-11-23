import { AppError } from '@job-market/errors';
import { createTaggedError } from '@spotsccc/error-as-value';

/**
 * Страны из прошлого `src/generated/countries.ts` нет в новом `countryInfo`. Страны не
 * удаляются (П7): на них ссылаются города, названия и данные вакансий, поэтому
 * такую выгрузку разбирает человек.
 */
export class CountryRemovedError extends createTaggedError({
  name: 'CountryRemovedError',
  message: 'Countries $codes are missing from the new countryInfo',
  extends: AppError,
}) {}
