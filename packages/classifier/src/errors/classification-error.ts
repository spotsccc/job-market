import { AppError } from '@job-market/errors';
import { createTaggedError } from '@spotsccc/error-as-value';

/**
 * Модель не дала вердикт: сбой провайдера, таймаут или ответ не по схеме (П3). Исходная
 * ошибка — в `cause`. Повторять ли вызов, решает вызывающий; id публикации добавляет он же.
 */
export class ClassificationError extends createTaggedError({
  name: 'ClassificationError',
  message: 'Classification failed',
  extends: AppError,
}) {}
