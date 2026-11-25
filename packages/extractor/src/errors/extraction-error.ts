import { AppError } from '@job-market/errors';
import { createTaggedError } from '@spotsccc/error-as-value';

/**
 * Модель не дала роли: сбой провайдера, таймаут или ответ не по схеме — в том числе ноль ролей
 * (П5) и профессия не из дерева (E3). Исходная ошибка — в `cause`. Повторять ли вызов, решает
 * вызывающий; id публикации добавляет он же.
 */
export class ExtractionError extends createTaggedError({
  name: 'ExtractionError',
  message: 'Vacancy extraction failed',
  extends: AppError,
}) {}
