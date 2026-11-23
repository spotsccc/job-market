import { readdirSync, readFileSync } from 'node:fs';

import {
  CONNECTORS,
  EMPLOYMENT_TYPES,
  HIRING_PARTIES,
  LANGUAGE_LEVELS,
  LOCATION_ROLES,
  SALARY_PERIODS,
  SENIORITIES,
  WORKPLACES,
} from '@job-market/db/values';
import { parsePlaceKey } from '@job-market/geo';
import type { PublicationForModel } from '@job-market/publication-text';
import { z } from 'zod';

import type { ExpectedRole, TreeNode } from './compare.ts';

/** Узел снимка дерева профессий `occupations.json`: те же поля, что строка `occupations`. */
export type OccupationNode = TreeNode & { readonly name: string; readonly description: string };

const occupationsSchema = z.array(
  z.strictObject({
    id: z.string(),
    parent_id: z.string().nullable(),
    name: z.string(),
    description: z.string(),
  }),
);

const expectedRoleSchema = z.strictObject({
  title: z.string(),
  company: z.string().nullable(),
  hiringParty: z.enum(HIRING_PARTIES),
  occupationId: z.string(),
  suggestedOccupation: z.boolean(),
  seniority: z.enum(SENIORITIES).nullable(),
  experienceYearsMin: z.number().int().nullable(),
  workplace: z.enum(WORKPLACES).nullable(),
  isRemoteFromAnywhere: z.boolean(),
  places: z.array(z.strictObject({ role: z.enum(LOCATION_ROLES), key: z.string() })),
  employmentTypes: z.array(z.enum(EMPLOYMENT_TYPES)),
  salaryMin: z.number().nullable(),
  salaryMax: z.number().nullable(),
  salaryCurrency: z.string().nullable(),
  salaryPeriod: z.enum(SALARY_PERIODS).nullable(),
  salaryGross: z.boolean().nullable(),
  equity: z.boolean().nullable(),
  skills: z.array(z.string()),
  niceSkills: z.array(z.string()),
  languages: z.array(
    z.strictObject({ code: z.string(), level: z.enum(LANGUAGE_LEVELS).nullable() }),
  ),
  relocation: z.boolean().nullable(),
  visaSponsorship: z.boolean().nullable(),
  responsibilities: z.boolean(),
  requirements: z.boolean(),
  benefits: z.boolean(),
});

const caseSchema = z.strictObject({
  /** Имя файла без `.json`: `geekjobs-10533`. */
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
  expected: z.array(expectedRoleSchema),
});

export type EvalCase = {
  readonly id: string;
  readonly source: string;
  readonly why: string;
  readonly publication: PublicationForModel;
  readonly expected: readonly ExpectedRole[];
};

const EVAL_DIR = new URL('./', import.meta.url);

/** Снимок дерева профессий, по которому размечен набор. */
export function loadOccupations(): readonly OccupationNode[] {
  return occupationsSchema.parse(
    JSON.parse(readFileSync(new URL('occupations.json', EVAL_DIR), 'utf8')),
  );
}

/**
 * Случаи набора из `eval/cases/*.json`. Ошибка разметки — исключение с именем файла: id
 * узла не из дерева, ключ места не по формату справочника, id не совпадает с именем файла.
 */
export function loadCases(occupations: readonly OccupationNode[]): readonly EvalCase[] {
  const ids = new Set(occupations.map((node) => node.id));
  const dir = new URL('cases/', EVAL_DIR);
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .toSorted()
    .map((file) => {
      const parsed = caseSchema.safeParse(JSON.parse(readFileSync(new URL(file, dir), 'utf8')));
      if (!parsed.success) throw new Error(`Case ${file} is invalid`, { cause: parsed.error });
      const evalCase = parsed.data;
      const problems = [
        ...(evalCase.id === file.replace(/\.json$/u, '') ? [] : ['id differs from the file name']),
        ...evalCase.expected.flatMap((role) => [
          ...(ids.has(role.occupationId) ? [] : [`unknown occupation ${role.occupationId}`]),
          ...role.places
            .filter((place) => parsePlaceKey(place.key) instanceof Error)
            .map((place) => `bad place key ${place.key}`),
        ]),
      ];
      if (problems.length > 0) throw new Error(`Case ${file}: ${problems.join('; ')}`);
      return evalCase;
    });
}
