import { z } from 'zod';

/**
 * Итог классификатора (П1, П2). `empty` — в тексте нет ни одной буквы, модель не звалась.
 * `trash` — модель решила, что это не вакансия; `note` — её пояснение. Значения причин
 * совпадают с `NOT_VACANCY_REASONS` базы: совпадение проверяет компилятор там, где итог пишется.
 */
export type Classification =
  | { readonly kind: 'vacancy' }
  | { readonly kind: 'not_vacancy'; readonly reason: 'empty' }
  | { readonly kind: 'not_vacancy'; readonly reason: 'trash'; readonly note: string };

/** Что отвечает модель: до неё доходит только публикация с буквами, поэтому `empty` здесь нет. */
export const MODEL_VERDICTS = ['vacancy', 'not_vacancy'] as const;
export type ModelVerdict = (typeof MODEL_VERDICTS)[number];

/**
 * Схема ответа модели. Ограничения structured outputs — в шапке `vacancy.ts` пакета
 * `@job-market/extractor`: корень — объект, без `min`/`max`/`transform`, вместо `oneOf` — плоский `enum`.
 */
export const modelAnswerSchema = z.strictObject({
  verdict: z
    .enum(MODEL_VERDICTS)
    .describe('vacancy — пост нанимает хотя бы на одну конкретную роль; иначе not_vacancy'),
  note: z
    .string()
    .describe(
      'Для not_vacancy — одно-два предложения на русском: что это за пост и почему он не вакансия. Для vacancy — пустая строка',
    ),
});
