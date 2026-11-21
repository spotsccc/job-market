import { gateway } from '@ai-sdk/gateway';
import type { LanguageModel } from 'ai';

/**
 * Модели разбора постов, через Vercel AI Gateway. Ключ — `AI_GATEWAY_API_KEY`;
 * без него на Vercel gateway берёт OIDC-токен деплоя. Id моделей — из
 * https://ai-gateway.vercel.sh/v1/models.
 */
export const CLASSIFIER_MODEL_ID = 'anthropic/claude-haiku-5.5';
/** Haiku и для извлечения: в 20 раз дешевле Sonnet 5.5 при тех же structured outputs. */
export const EXTRACTOR_MODEL_ID = 'anthropic/claude-haiku-5.5';

export type PostProcessingModels = {
  /** Решает, вакансия ли пост: дешёвая быстрая модель, её зовём на каждый пост. */
  readonly classifier: LanguageModel;
  /** Разбирает вакансию в поля: зовём только для постов-вакансий. */
  readonly extractor: LanguageModel;
};

export const defaultPostProcessingModels: PostProcessingModels = {
  classifier: gateway(CLASSIFIER_MODEL_ID),
  extractor: gateway(EXTRACTOR_MODEL_ID),
};
