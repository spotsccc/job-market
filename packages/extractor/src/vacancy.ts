import {
  EMPLOYMENT_TYPES,
  HIRING_PARTIES,
  LANGUAGE_LEVELS,
  LOCATION_ROLES,
  SALARY_PERIODS,
  SENIORITIES,
  WORKPLACES,
} from '@job-market/db/values';
import { z } from 'zod';

import { occupationEnum } from './occupations.ts';
import type { OccupationNode } from './occupations.ts';

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
    gross: z
      .boolean()
      .nullable()
      .describe('true — сумма до налогов (gross), false — на руки (net); null — текст не говорит'),
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

const placeSchema = z.strictObject({
  role: z
    .enum(LOCATION_ROLES)
    .describe(
      'office — где офис или где работать на месте; hiring — откуда можно работать удалённо',
    ),
  city: z.string().nullable().describe('Город словами текста; null, если не назван'),
  country: z.string().nullable().describe('Страна словами текста; null, если не названа'),
  region: z
    .string()
    .nullable()
    .describe(
      'Регион найма из списка регионов или словами текста: «ЕС», «Europe», «worldwide»; null, если не назван',
    ),
  raw: z.string().describe('Фрагмент текста, из которого взято место: «Remote from EU»'),
});

const languageSchema = z.strictObject({
  code: z.string().describe('Код ISO 639-1 строчными: en, de, ru'),
  level: z
    .enum(LANGUAGE_LEVELS)
    .nullable()
    .describe('Уровень по CEFR или native; null — не назван'),
});

const listItems = (what: string): z.ZodArray<z.ZodString> =>
  z
    .array(z.string())
    .describe(`${what}: пункт — одна фраза из текста на его языке, без маркера списка`);

/** Поля роли, которые от дерева профессий не зависят. */
const roleFields = {
  title: z.string().describe('Название роли как в посте, без эмодзи и хэштегов'),
  company: z.string().nullable().describe('Компания, в которую нанимают; null, если не названа'),
  companyUrl: httpUrl
    .nullable()
    .describe(
      'Сайт компании или её страница в LinkedIn, если ссылка есть в посте; не ссылка на отклик',
    ),
  hiringParty: z.enum(HIRING_PARTIES).describe('Нанимает сама компания или агентство/рекрутёр'),
  suggestedOccupation: z
    .string()
    .nullable()
    .describe(
      'Профессия словами, только если подходящего листа в дереве нет и ты выбрал узел выше; иначе null',
    ),
  seniority: z.enum(SENIORITIES).nullable(),
  experienceYearsMin: z
    .number()
    .nullable()
    .describe('Нижняя граница лет опыта: «5+ years» → 5, «от 2 до 4 лет» → 2; null — числа нет'),
  workplace: z.enum(WORKPLACES).nullable().describe('Формат работы; null, если не сказано'),
  places: z
    .array(placeSchema)
    .describe('Места: одно место — одна запись; регион не разворачивай в страны'),
  employmentTypes: z.array(z.enum(EMPLOYMENT_TYPES)),
  salary: salarySchema.nullable(),
  equity: z
    .boolean()
    .nullable()
    .describe('true — обещают опцион или долю в компании; null — не сказано'),
  skills: z
    .array(z.string())
    .describe('Обязательные навыки и технологии, каноническим написанием: React, PostgreSQL'),
  niceSkills: z.array(z.string()).describe('Навыки «будет плюсом», «nice to have», «желательно»'),
  languages: z.array(languageSchema).describe('Языки, которые требуют от кандидата'),
  relocation: z.boolean().nullable().describe('Помогают с переездом; null, если не сказано'),
  visaSponsorship: z.boolean().nullable(),
  apply: applySchema,
  summary: z
    .string()
    .describe('Одно-два предложения на русском: чем занимается команда и что делать на роли'),
  responsibilities: listItems('Что делать на роли'),
  requirements: listItems('Что нужно уметь и знать, кроме навыков из skills'),
  benefits: listItems('Что дают: условия, бонусы'),
};

/**
 * Схема роли строится из дерева профессий: профессия — `z.enum` id действующих узлов (П12,
 * П19). Значение не из дерева не проходит схему, и разбор возвращает ошибку (E3).
 */
function roleSchema(tree: readonly OccupationNode[]) {
  const [first, ...rest] = occupationEnum(tree);
  if (first === undefined) throw new Error('Occupation tree has no root');
  return z
    .strictObject({
      ...roleFields,
      occupation: z
        .enum([first, ...rest])
        .describe('Id самого конкретного узла дерева профессий, который подтверждает текст'),
    })
    .refine((vacancy: Readonly<{ title: string }>) => vacancy.title.trim() !== '', {
      message: 'Пустое название роли',
      path: ['title'],
    });
}

/** Ответ экстрактора для дерева профессий: роли публикации в порядке текста. */
export function vacancySchema(tree: readonly OccupationNode[]) {
  return z.strictObject({
    // Ролей нет — ошибка: экстрактор получает только посты, которые классификатор признал вакансией (П5).
    vacancies: z
      .array(roleSchema(tree))
      .refine((vacancies: readonly unknown[]) => vacancies.length > 0, 'Вакансия без единой роли')
      .describe('Каждая отдельная роль из поста — отдельный элемент'),
  });
}

export type Salary = z.infer<typeof salarySchema>;
export type ApplyChannels = z.infer<typeof applySchema>;
export type ModelPlace = z.infer<typeof placeSchema>;
/** Роль, как её вернула модель, до нормализации. */
export type ModelVacancy = z.infer<ReturnType<typeof roleSchema>>;
