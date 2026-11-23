import { AppError } from '@job-market/errors';
import { createTaggedError } from '@spotsccc/error-as-value';

/**
 * Запрос к Apify не удался после повторов `apify-client`: сеть, неверный токен,
 * кончились кредиты (402), актор не найден. `ApifyApiError` с `statusCode` и `type` лежит в `cause`.
 */
export class ApifyRequestError extends createTaggedError({
  name: 'ApifyRequestError',
  message: 'Apify request for actor $actorId failed',
  extends: AppError,
}) {}
