import { NOT_VACANCY_REASONS } from '@job-market/db/values';
import { z } from 'zod';

/**
 * Схема ответа классификатора. Ограничения structured outputs — в шапке `vacancy.ts` пакета
 * `@job-market/extractor`: корень — объект, без `min`/`max`/`transform`, вместо `oneOf` — плоский `enum`.
 */

/** Вердикт классификатора: `vacancy` или причина, почему публикация не вакансия (П1). */
export const VERDICTS = ['vacancy', ...NOT_VACANCY_REASONS] as const;
export type Verdict = (typeof VERDICTS)[number];

export const classificationSchema = z.strictObject({
  verdict: z
    .enum(VERDICTS)
    .describe(
      'vacancy — пост предлагает хотя бы одну конкретную открытую роль; иначе причина, почему нет',
    ),
  note: z.string().describe('Одно предложение на русском: почему такой вердикт'),
});

export type Classification = z.infer<typeof classificationSchema>;
