import {
  createConnectors,
  createGreenhouseChannel,
  createLinkedinChannel,
  createTelegramChannel,
} from '@job-market/connectors';
import type { Connector } from '@job-market/connectors';
import { createReaders } from '@job-market/enricher';

import { defaultPostProcessingModels } from '../post-processing/models.ts';

const APIFY_TOKEN_ENV = 'APIFY_TOKEN';

let registry: ReadonlyMap<string, Connector> | undefined;

/**
 * Реестр коннекторов движка с ключами из окружения: Apify — `APIFY_TOKEN`, модели — AI Gateway
 * (`AI_GATEWAY_API_KEY` или OIDC-токен деплоя). Создаётся один раз на процесс. `Error` — нет
 * `APIFY_TOKEN`.
 */
export function engineConnectors(): Error | ReadonlyMap<string, Connector> {
  if (registry !== undefined) return registry;
  const apifyToken = process.env[APIFY_TOKEN_ENV];
  if (apifyToken === undefined || apifyToken === '') {
    return new Error(`${APIFY_TOKEN_ENV} is not set`);
  }
  registry = createConnectors({
    telegram: createTelegramChannel(),
    linkedin: createLinkedinChannel({ token: apifyToken }),
    greenhouse: createGreenhouseChannel(),
    models: defaultPostProcessingModels,
    readers: createReaders({ apifyToken }),
  });
  return registry;
}
