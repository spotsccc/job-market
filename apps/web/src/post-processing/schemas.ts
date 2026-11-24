import { z } from 'zod';

/**
 * Схемы ответов моделей. Ограничения structured outputs — в шапке `vacancy.ts` пакета `@job-market/extractor`:
 * корень — объект, без `min`/`max`/`transform`, вместо `oneOf` — плоский `enum`.
 */

/**
 * Причины «не вакансия» старого разбора. У публикаций причин теперь две (`empty` и `trash`,
 * `NOT_VACANCY_REASONS` базы), а этот разбор удаляется после сверки переноса и остаётся как был.
 */
export const POST_NOT_VACANCY_REASONS = ['job_seeker', 'no_specific_role', 'not_hiring'] as const;
export type PostNotVacancyReason = (typeof POST_NOT_VACANCY_REASONS)[number];

/** Вердикт классификатора: `vacancy` или причина, почему пост не вакансия. */
export const POST_VERDICTS = ['vacancy', ...POST_NOT_VACANCY_REASONS] as const;

export const postClassificationSchema = z.strictObject({
  verdict: z
    .enum(POST_VERDICTS)
    .describe(
      'vacancy — пост предлагает хотя бы одну конкретную открытую роль; иначе причина, почему нет',
    ),
  note: z.string().describe('Одно предложение на русском: почему такой вердикт'),
});

export type PostClassification = z.infer<typeof postClassificationSchema>;
