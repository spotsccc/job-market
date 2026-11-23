/**
 * Прогон набора проверки настоящей моделью (Э2 плана vacancy-extraction):
 *
 * `pnpm --filter @job-market/extractor eval` — все случаи;
 * `… eval --case geekjobs-10533 --case synthetic-paris` — только эти;
 * `… eval --compare eval/reports/<отчёт>.json` — рядом с долей совпадений печатает разницу с тем отчётом.
 *
 * Ключ — `AI_GATEWAY_API_KEY` из окружения или `apps/web/.env.local`. Места ответа сводятся к
 * справочнику локальной базы (`DATABASE_URL` оттуда же) тем же `locateVacancies`, что при переносе.
 * Отчёт пишется в `eval/reports/`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { getDb } from '@job-market/db';
import { locateVacancies } from '@job-market/geo/server';
import type { LocatedPlaces } from '@job-market/geo/server';
import { z } from 'zod';

import { extract, EXTRACTOR_MODEL_ID } from '../src/index.ts';
import type { ExtractedRole, OccupationNode } from '../src/index.ts';
import { loadCases, loadOccupations } from './cases.ts';
import type { EvalCase } from './cases.ts';
import { compareCase } from './compare.ts';
import type { ActualRole, CaseComparison } from './compare.ts';
import { coverage, locatedKey } from './located.ts';
import { summarize } from './summary.ts';
import type { Summary } from './summary.ts';

/** Столько вызовов модели идут одновременно. */
const CONCURRENCY = 5;

type CaseResult = {
  readonly id: string;
  readonly error: string | null;
  readonly actual: readonly ExtractedRole[] | null;
  readonly located: readonly LocatedPlaces[] | null;
  readonly comparison: CaseComparison | null;
};

type Score = { readonly matched: number; readonly compared: number };

/** Из прошлого отчёта для `--compare` нужны только доли совпадений. */
const baseSchema = z.object({
  summary: z.object({
    roleCount: z.object({ matched: z.number(), compared: z.number() }),
    fields: z.record(z.string(), z.object({ matched: z.number(), compared: z.number() })),
  }),
});
type Base = z.infer<typeof baseSchema>['summary'];

/** Ответ текущей схемы в полях сравнения. Полей, которых схема не возвращает, здесь нет. */
function toActualRole(role: ExtractedRole, located: LocatedPlaces): ActualRole {
  return {
    title: role.title,
    company: role.company,
    hiringParty: role.hiringParty,
    occupationId: role.occupationId,
    suggestedOccupation: role.suggestedOccupation,
    seniority: role.seniority,
    experienceYearsMin: role.experienceYearsMin,
    workplace: role.workplace,
    isRemoteFromAnywhere: located.isRemoteFromAnywhere,
    places: located.places.flatMap((place) => {
      const key = locatedKey(place);
      return key === null ? [] : [{ role: place.role, key }];
    }),
    employmentTypes: role.employmentTypes,
    salaryMin: role.salaryMin,
    salaryMax: role.salaryMax,
    salaryCurrency: role.salaryCurrency,
    salaryPeriod: role.salaryPeriod,
    salaryGross: role.salaryGross,
    equity: role.equity,
    skills: role.skills,
    niceSkills: role.niceSkills,
    languages: role.languages,
    relocation: role.relocation,
    visaSponsorship: role.visaSponsorship,
    responsibilities: role.responsibilities,
    requirements: role.requirements,
    benefits: role.benefits,
  };
}

/** Ошибка одной строкой: сообщения провайдера бывают многострочными и с цветами терминала. */
function errorMessage(error: Readonly<Error>): string {
  const message =
    error.cause instanceof Error ? `${error.message}: ${error.cause.message}` : error.message;
  // oxlint-disable-next-line no-control-regex -- убираем ANSI-коды цвета
  return (message.split('\n')[0] ?? '').replaceAll(/\u001B\[\d+m/gu, '');
}

/** Снимок дерева в виде узлов экстрактора. */
function toNodes(tree: ReturnType<typeof loadOccupations>): readonly OccupationNode[] {
  return tree.map((node) => ({
    id: node.id,
    parentId: node.parent_id,
    name: node.name,
    description: node.description,
  }));
}

async function runCase(
  evalCase: EvalCase,
  tree: ReturnType<typeof loadOccupations>,
): Promise<CaseResult> {
  const failed = (error: Readonly<Error>): CaseResult => ({
    id: evalCase.id,
    error: errorMessage(error),
    actual: null,
    located: null,
    comparison: null,
  });
  const actual = await extract(evalCase.publication, { occupations: toNodes(tree) });
  if (actual instanceof Error) return failed(actual);
  const located = await locateVacancies(getDb(), actual);
  if (located instanceof Error) return failed(located);
  const roles = actual.flatMap((role, index) => {
    const places = located[index];
    return places === undefined ? [] : [toActualRole(role, places)];
  });
  return {
    id: evalCase.id,
    error: null,
    actual,
    located,
    comparison: compareCase(tree, evalCase.expected, roles),
  };
}

/** Случаи по `CONCURRENCY` одновременно; порядок результатов — как у случаев. */
async function runAll(
  cases: readonly EvalCase[],
  tree: ReturnType<typeof loadOccupations>,
): Promise<readonly CaseResult[]> {
  const results = new Map<number, CaseResult>();
  let next = 0;
  async function worker(): Promise<void> {
    const index = next;
    next += 1;
    const evalCase = cases[index];
    if (evalCase === undefined) return;
    results.set(index, await runCase(evalCase, tree));
    await worker();
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => worker()));
  return cases.flatMap((_, index) => {
    const result = results.get(index);
    return result === undefined ? [] : [result];
  });
}

const percent = (value: number): string => `${(value * 100).toFixed(0)}%`;

function scoreLine(name: string, score: Score, base: Score | undefined): string {
  const share = score.compared === 0 ? 0 : score.matched / score.compared;
  const diff =
    base === undefined || base.compared === 0 ? undefined : share - base.matched / base.compared;
  const delta = diff === undefined ? '' : ` (${diff >= 0 ? '+' : ''}${percent(diff)})`;
  return `${name.padEnd(22)} ${percent(share).padStart(4)}${delta.padEnd(8)} ${String(score.matched)}/${String(score.compared)}`;
}

function printSummary(summary: Summary, base: Base | undefined): void {
  console.log(
    `\nСлучаев ${String(summary.cases)} · ошибок экстрактора ${String(summary.errors)}\n`,
  );
  console.log(scoreLine('число ролей', summary.roleCount, base?.roleCount));
  for (const [field, total] of Object.entries(summary.fields)) {
    const parts = [scoreLine(field, total, base?.fields[field])];
    if (total.precision !== undefined && total.recall !== undefined) {
      parts.push(`P ${total.precision.toFixed(2)} R ${total.recall.toFixed(2)}`);
    }
    if (total.drift !== undefined) {
      const { ancestor, descendant, other_branch: otherBranch } = total.drift;
      parts.push(
        `к предку ${String(ancestor)}, к потомку ${String(descendant)}, другая ветка ${String(otherBranch)}`,
      );
    }
    console.log(parts.join(' · '));
  }
}

function mismatches(comparison: CaseComparison): readonly string[] {
  const { roleCount } = comparison;
  const lines = roleCount.match
    ? []
    : [`ролей: ждали ${String(roleCount.expected)}, получили ${String(roleCount.actual)}`];
  for (const [index, role] of comparison.roles.entries()) {
    for (const [field, result] of Object.entries(role)) {
      if (!result.match) {
        lines.push(
          `роль ${String(index)} ${field}: ждали ${JSON.stringify(result.expected)}, получили ${JSON.stringify(result.actual)}`,
        );
      }
    }
  }
  return lines;
}

function printMismatches(results: readonly CaseResult[]): void {
  console.log('\nРасхождения');
  for (const result of results) {
    const lines =
      result.error === null
        ? result.comparison === null
          ? []
          : mismatches(result.comparison)
        : [`ошибка — ${result.error}`];
    if (lines.length > 0) {
      console.log(`  ${result.id}\n${lines.map((line) => `    ${line}`).join('\n')}`);
    }
  }
}

const { values } = parseArgs({
  options: {
    case: { type: 'string', multiple: true },
    compare: { type: 'string' },
  },
});

const occupations = loadOccupations();
const allCases = loadCases(occupations);
const wanted = values.case ?? [];
const unknown = wanted.filter((id) => !allCases.some((evalCase) => evalCase.id === id));
if (unknown.length > 0) {
  console.error(`Нет случаев: ${unknown.join(', ')}`);
  process.exit(1);
}
const cases =
  wanted.length === 0 ? allCases : allCases.filter((evalCase) => wanted.includes(evalCase.id));
const base =
  values.compare === undefined
    ? undefined
    : baseSchema.parse(JSON.parse(readFileSync(values.compare, 'utf8'))).summary;

console.log(
  `Модель ${EXTRACTOR_MODEL_ID} · случаев ${String(cases.length)} · по ${String(CONCURRENCY)} одновременно`,
);
const results = await runAll(cases, occupations);
await getDb().$client.end();
const summary = summarize(results.map((result) => result.comparison));
const { innerNodes, unresolvedPlaces } = coverage(
  results.flatMap((result) => result.actual ?? []),
  results.flatMap((result) => result.located ?? []),
  toNodes(occupations),
);
printMismatches(results);
printSummary(summary, base);
console.log(
  `\nВакансий на внутренних узлах ${percent(innerNodes)} · мест не распознано ${percent(unresolvedPlaces)}`,
);

const createdAt = new Date().toISOString();
const reportsDir = new URL('reports/', import.meta.url);
mkdirSync(reportsDir, { recursive: true });
// Время в имени: два прогона подряд в один день — точка отсчёта шума (E1), они не затирают друг друга.
const name = createdAt.replaceAll(':', '-').replace(/\.\d+Z$/u, '');
const reportUrl = new URL(`${name}.json`, reportsDir);
const report = {
  createdAt,
  model: EXTRACTOR_MODEL_ID,
  summary,
  coverage: { innerNodes, unresolvedPlaces },
  cases: results,
};
writeFileSync(reportUrl, `${JSON.stringify(report, null, 2)}\n`);
console.log(`\nОтчёт ${reportUrl.pathname}`);
