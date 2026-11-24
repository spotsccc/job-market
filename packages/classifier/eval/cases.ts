import { readdirSync, readFileSync } from 'node:fs';

import { CONNECTORS } from '@job-market/db/values';
import type { PublicationForModel } from '@job-market/publication-text';
import { z } from 'zod';

import { VERDICTS } from '../src/index.ts';
import type { Verdict } from '../src/index.ts';

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
  expected: z.enum(VERDICTS),
});

export type EvalCase = {
  readonly id: string;
  readonly source: string;
  readonly why: string;
  readonly publication: PublicationForModel;
  readonly expected: Verdict;
};

/**
 * Случаи набора из `eval/cases/*.json`. Ошибка разметки или id, не совпавший с именем файла, —
 * исключение с именем файла.
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
      return parsed.data;
    });
}
