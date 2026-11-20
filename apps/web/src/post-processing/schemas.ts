import { NOT_VACANCY_REASONS } from '@job-market/core';
import { z } from 'zod';

import { extractedVacancySchema } from '../vacancy/vacancy.ts';

/**
 * Схемы ответов моделей. Ограничения structured outputs — в шапке `vacancy/vacancy.ts`:
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

export const vacancyExtractionSchema = z.strictObject({
  vacancies: z
    .array(extractedVacancySchema)
    .refine((vacancies: readonly unknown[]) => vacancies.length > 0, 'Вакансия без единой роли')
    .describe('Каждая отдельная роль из поста — отдельный элемент'),
});

export type PostClassification = z.infer<typeof postClassificationSchema>;
