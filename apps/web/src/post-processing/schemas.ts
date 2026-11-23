import { NOT_VACANCY_REASONS } from '@job-market/db/values';
import { z } from 'zod';

/**
 * Схемы ответов моделей. Ограничения structured outputs — в шапке `vacancy.ts` пакета `@job-market/extractor`:
 * корень — объект, без `min`/`max`/`transform`, вместо `oneOf` — плоский `enum`.
 */

/** Вердикт классификатора: `vacancy` или причина, почему пост не вакансия. */
export const POST_VERDICTS = ['vacancy', ...NOT_VACANCY_REASONS] as const;

export const postClassificationSchema = z.strictObject({
  verdict: z
    .enum(POST_VERDICTS)
    .describe(
      'vacancy — пост предлагает хотя бы одну конкретную открытую роль; иначе причина, почему нет',
    ),
  note: z.string().describe('Одно предложение на русском: почему такой вердикт'),
});

export type PostClassification = z.infer<typeof postClassificationSchema>;
