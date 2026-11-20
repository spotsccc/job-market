import {
  EMPLOYMENT_TYPES,
  HIRING_PARTIES,
  SALARY_PERIODS,
  SENIORITIES,
  WORKPLACES,
} from '@job-market/core';
import type { Workplace } from '@job-market/core';
import { z } from 'zod';

/**
 * Вакансия, которую модель извлекает из текста поста. Схема одна на всё: из неё
 * AI SDK строит JSON-схему для structured outputs и ею же проверяет ответ, а
 * типы ниже выводятся из неё. Правило для всех полей: если в посте этого нет —
 * `null` или пустой список, модель не угадывает.
 *
 * Ограничения structured outputs Claude: без `min`/`max`/`length` у чисел, строк
 * и массивов — такие проверки пишем через `refine`, он в JSON-схему не попадает.
 * Без `transform`: его нельзя выразить JSON-схемой.
 */

const httpUrl = z.url({ protocol: /^https?$/u });

export const salarySchema = z
  .strictObject({
    min: z.number().nullable().describe('Нижняя граница вилки; «от 5000» — только min'),
    max: z.number().nullable().describe('Верхняя граница вилки; «до 5000» — только max'),
    currency: z.string().nullable().describe('Код ISO 4217 заглавными: EUR, USD'),
    period: z.enum(SALARY_PERIODS).nullable(),
    raw: z.string().describe('Зарплата дословно как в посте: «€80–95k + equity»'),
  })
  .refine(
    (salary: Readonly<{ min: number | null; max: number | null }>) =>
      salary.min === null || salary.max === null || salary.min <= salary.max,
    {
      message: 'min больше max',
      path: ['min'],
    },
  );

export const applySchema = z.strictObject({
  urls: z.array(httpUrl).describe('Ссылки на отклик или описание вакансии'),
  // Не `z.email()`: он пишет в JSON-схему `pattern`, который structured outputs не принимают.
  emails: z.array(
    z
      .string()
      .refine((email) => z.email().safeParse(email).success, 'Invalid email')
      .describe('Адрес почты'),
  ),
  directMessage: z.boolean().describe('Просят написать автору в личку или в комментарии'),
});

export const extractedVacancySchema = z
  .strictObject({
    title: z.string().describe('Название роли как в посте, без эмодзи и хэштегов'),
    company: z.string().nullable().describe('Компания, в которую нанимают; null, если не названа'),
    companyUrl: httpUrl
      .nullable()
      .describe(
        'Сайт компании или её страница в LinkedIn, если ссылка есть в посте; не ссылка на отклик',
      ),
    hiringParty: z.enum(HIRING_PARTIES).describe('Нанимает сама компания или агентство/рекрутёр'),
    seniority: z.enum(SENIORITIES).nullable(),
    workplace: z.enum(WORKPLACES).nullable().describe('Формат работы; null, если не сказано'),
    isRemoteFromAnywhere: z
      .boolean()
      .describe(
        'true, только если прямо сказано, что работать можно из любой страны; тогда workplace — remote. Удалёнка с регионом найма — false',
      ),
    locations: z
      .array(z.string())
      .describe('Города и страны офиса или регионы найма для удалёнки, как в посте'),
    employmentTypes: z.array(z.enum(EMPLOYMENT_TYPES)),
    salary: salarySchema.nullable(),
    skills: z.array(z.string()).describe('Технологии и навыки из требований или стека'),
    relocation: z.boolean().nullable().describe('Помогают с переездом; null, если не сказано'),
    visaSponsorship: z.boolean().nullable(),
    apply: applySchema,
    summary: z
      .string()
      .describe('Одно-два предложения на русском: чем занимается команда и что делать на роли'),
  })
  .refine((vacancy: Readonly<{ title: string }>) => vacancy.title.trim() !== '', {
    message: 'Пустое название роли',
    path: ['title'],
  })
  .refine(
    (vacancy: Readonly<{ isRemoteFromAnywhere: boolean; workplace: Workplace | null }>) =>
      !vacancy.isRemoteFromAnywhere || vacancy.workplace === 'remote',
    {
      message: 'isRemoteFromAnywhere требует workplace = remote',
      path: ['workplace'],
    },
  );

export type Salary = z.infer<typeof salarySchema>;
export type ApplyChannels = z.infer<typeof applySchema>;
export type ExtractedVacancy = z.infer<typeof extractedVacancySchema>;
