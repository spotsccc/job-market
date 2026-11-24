import { readdirSync, readFileSync } from 'node:fs';

import { CONNECTORS } from '@job-market/db/values';
import type { PublicationForModel } from '@job-market/publication-text';
import { z } from 'zod';

import { MODEL_VERDICTS } from '../src/classification.ts';
import type { ModelVerdict } from '../src/classification.ts';

/**
 * Вид случая: `vacancy` или один из видов «не вакансии» из инструкции. В ответ модели он не
 * входит — по нему отчёт показывает, на каких постах классификатор ошибается.
 */
export const CASE_GROUPS = ['vacancy', 'job_seeker', 'no_specific_role', 'not_hiring'] as const;
export type CaseGroup = (typeof CASE_GROUPS)[number];

const caseSchema = z.strictObject({
  /** Имя файла без `.json`: `synthetic-open-to-work`. */
  id: z.string(),
  /** Откуда текст: ссылка на пост или `synthetic` — текст написан для набора. */
  source: z.string(),
  /** Что этот случай проверяет. */
  why: z.string(),
  publication: z.strictObject({
    connector: z.enum(CONNECTORS),
    content: z.string(),
    postedAt: z.iso.datetime().transform((value) => new Date(value)),
    author: z
      .strictObject({ name: z.string(), url: z.string(), headline: z.string().nullable() })
      .nullable(),
  }),
  group: z.enum(CASE_GROUPS),
  expected: z.enum(MODEL_VERDICTS),
});

export type EvalCase = {
  readonly id: string;
  readonly source: string;
  readonly why: string;
  readonly publication: PublicationForModel;
  readonly group: CaseGroup;
  readonly expected: ModelVerdict;
};

/**
 * Случаи набора из `eval/cases/*.json`. Ошибка разметки, id, не совпавший с именем файла,
 * или вид, который расходится с ожидаемым вердиктом, — исключение с именем файла.
 */
export function loadCases(): readonly EvalCase[] {
  const dir = new URL('cases/', import.meta.url);
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .toSorted()
    .map((file) => {
      const parsed = caseSchema.safeParse(JSON.parse(readFileSync(new URL(file, dir), 'utf8')));
      if (!parsed.success) throw new Error(`Case ${file} is invalid`, { cause: parsed.error });
      if (parsed.data.id !== file.replace(/\.json$/u, '')) {
        throw new Error(`Case ${file}: id differs from the file name`);
      }
      if ((parsed.data.group === 'vacancy') !== (parsed.data.expected === 'vacancy')) {
        throw new Error(`Case ${file}: group and expected disagree`);
      }
      return parsed.data;
    });
}
