import { gateway } from '@ai-sdk/gateway';
import { formatPublication, skipReason } from '@job-market/publication-text';
import type { PublicationForModel } from '@job-market/publication-text';
import { generateText, Output } from 'ai';
import type { LanguageModel } from 'ai';

import { classificationSchema } from './classification.ts';
import type { Classification } from './classification.ts';
import { ClassificationError, NothingToClassifyError } from './errors/index.ts';
import { CLASSIFIER_INSTRUCTIONS } from './prompt.ts';

/**
 * Модель классификатора через Vercel AI Gateway. Ключ — `AI_GATEWAY_API_KEY`; без него на
 * Vercel gateway берёт OIDC-токен деплоя. Id моделей — из https://ai-gateway.vercel.sh/v1/models.
 * Дешёвая быстрая модель: её зовут на каждую публикацию.
 */
export const CLASSIFIER_MODEL_ID = 'anthropic/claude-haiku-5.5';

export const defaultClassifierModel: LanguageModel = gateway(CLASSIFIER_MODEL_ID);

/**
 * Предел одного вызова модели вместе с повторами AI SDK. Без него зависший вызов
 * держит функцию до `maxDuration`, и Vercel обрывает её посреди работы.
 */
const MODEL_CALL_TIMEOUT_MS = 60_000;

/**
 * Без рассуждений: классификация — простая задача, а токены рассуждений оплачиваются
 * как выход и в разы удорожают вызов.
 */
const REASONING = 'none';

export type ClassifyOptions = {
  readonly model?: LanguageModel;
  /** Предел вызова модели, по умолчанию 60 с. */
  readonly timeoutMs?: number;
};

/**
 * Решает, вакансия ли публикация, и если нет — почему (П1). Публикацию без букв не разбирает
 * и модель не зовёт (П2). Сбой провайдера, таймаут или ответ не по схеме — `ClassificationError` (П3).
 */
export async function classify(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- в публикации `Date`, глубоко readonly его не сделать
  publication: PublicationForModel,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- модель AI SDK — объект провайдера, readonly его не сделать
  options: ClassifyOptions = {},
): Promise<Classification | NothingToClassifyError | ClassificationError> {
  const reason = skipReason(publication.content);
  if (reason !== undefined) return new NothingToClassifyError({ reason });

  const result = await generateText({
    model: options.model ?? defaultClassifierModel,
    abortSignal: AbortSignal.timeout(options.timeoutMs ?? MODEL_CALL_TIMEOUT_MS),
    reasoning: REASONING,
    instructions: CLASSIFIER_INSTRUCTIONS,
    prompt: formatPublication(publication),
    output: Output.object({ schema: classificationSchema }),
  }).catch((cause: unknown) => new ClassificationError({ cause }));
  if (result instanceof Error) return result;
  return result.output;
}
