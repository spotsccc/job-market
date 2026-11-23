import { AppError } from '@job-market/errors';
import { createTaggedError } from '@spotsccc/error-as-value';

/**
 * Строка дампа GeoNames не в том формате, который ждёт генератор: другое число
 * столбцов или нечисловое значение. Значит, GeoNames поменял формат — генератор
 * надо поправить, а не пропускать строки.
 */
export class GeonamesParseError extends createTaggedError({
  name: 'GeonamesParseError',
  message: 'GeoNames file $file, line $line: $problem',
  extends: AppError,
}) {}
