import { gateway } from '@ai-sdk/gateway';
import { formatPublication } from '@job-market/publication-text';
import type { PublicationForModel } from '@job-market/publication-text';
import { generateText, Output } from 'ai';
import type { LanguageModel } from 'ai';

import { EXTRACTOR_INSTRUCTIONS } from './prompt.ts';
import { vacancyExtractionSchema } from './vacancy.ts';
import type { ExtractedVacancy } from './vacancy.ts';

/**
 * Модель экстрактора через Vercel AI Gateway. Ключ — `AI_GATEWAY_API_KEY`; без него на
 * Vercel gateway берёт OIDC-токен деплоя. Id моделей — из https://ai-gateway.vercel.sh/v1/models.
 * Haiku: в 20 раз дешевле Sonnet 5.5 при тех же structured outputs.
 */
export const EXTRACTOR_MODEL_ID = 'anthropic/claude-haiku-5.5';

export const defaultExtractorModel: LanguageModel = gateway(EXTRACTOR_MODEL_ID);

/**
 * Предел одного вызова модели вместе с повторами AI SDK. Без него зависший вызов
 * держит функцию до `maxDuration`, и Vercel обрывает её посреди работы.
 */
const MODEL_CALL_TIMEOUT_MS = 60_000;

/**
 * Без рассуждений: извлечение полей — простая задача, а токены рассуждений
 * оплачиваются как выход и в разы удорожают вызов.
 */
const REASONING = 'none';

/**
 * Достаёт роли из публикации, которая уже признана вакансией. Роли — в порядке ответа
 * модели, то есть в порядке текста. Ответ не по схеме или сбой провайдера — `Error`.
 */
export async function extract(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- в публикации `Date`, глубоко readonly его не сделать
  publication: PublicationForModel,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- модель AI SDK — объект провайдера, readonly его не сделать
  model: LanguageModel = defaultExtractorModel,
): Promise<Error | readonly ExtractedVacancy[]> {
  const result = await generateText({
    model,
    abortSignal: AbortSignal.timeout(MODEL_CALL_TIMEOUT_MS),
    reasoning: REASONING,
    instructions: EXTRACTOR_INSTRUCTIONS,
    prompt: formatPublication(publication),
    output: Output.object({ schema: vacancyExtractionSchema }),
  }).catch((cause: unknown) => new Error('Vacancy extraction failed', { cause }));
  if (result instanceof Error) return result;
  return result.output.vacancies;
}
