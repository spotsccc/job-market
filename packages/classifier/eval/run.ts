/**
 * Прогон набора проверки классификатора настоящей моделью (Э2 плана classifier):
 * `pnpm --filter @job-market/classifier eval`.
 *
 * Ключ — `AI_GATEWAY_API_KEY` из окружения или `apps/web/.env.local`. Отчёт пишется в `eval/reports/`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';

import { CLASSIFIER_MODEL_ID, classify } from '../src/index.ts';
import type { Classification } from '../src/index.ts';
import { loadCases } from './cases.ts';
import type { EvalCase } from './cases.ts';
import { score } from './score.ts';

/** Столько вызовов модели идут одновременно. */
const CONCURRENCY = 5;

type CaseResult = {
  readonly evalCase: EvalCase;
  readonly answer: Classification | Error;
};

/** Ошибка одной строкой: сообщения провайдера бывают многострочными и с цветами терминала. */
function errorMessage(error: Readonly<Error>): string {
  const message =
    error.cause instanceof Error ? `${error.message}: ${error.cause.message}` : error.message;
  // oxlint-disable-next-line no-control-regex -- убираем ANSI-коды цвета
  return (message.split('\n')[0] ?? '').replaceAll(/\u001B\[\d+m/gu, '');
}

/** Случаи по `CONCURRENCY` одновременно; порядок результатов — как у случаев. */
async function runAll(cases: readonly EvalCase[]): Promise<readonly CaseResult[]> {
  const results = new Map<number, CaseResult>();
  let next = 0;
  async function worker(): Promise<void> {
    const index = next;
    next += 1;
    const evalCase = cases[index];
    if (evalCase === undefined) return;
    results.set(index, { evalCase, answer: await classify(evalCase.publication) });
    await worker();
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => worker()));
  return cases.flatMap((_, index) => {
    const result = results.get(index);
    return result === undefined ? [] : [result];
  });
}

const percent = (matched: number, total: number): string =>
  `${String(matched)}/${String(total)} (${total === 0 ? '0' : ((matched / total) * 100).toFixed(0)}%)`;

const cases = loadCases();
console.log(
  `Модель ${CLASSIFIER_MODEL_ID} · случаев ${String(cases.length)} · по ${String(CONCURRENCY)} одновременно`,
);
const results = await runAll(cases);
const summary = score(
  results.map(({ evalCase, answer }) => ({
    id: evalCase.id,
    expected: evalCase.expected,
    actual: answer instanceof Error ? answer : answer.verdict,
  })),
);

for (const { evalCase, answer } of results) {
  if (answer instanceof Error) console.log(`  ${evalCase.id}: ошибка — ${errorMessage(answer)}`);
}
console.log(
  `\nСлучаев ${String(summary.cases)} · ошибок ${String(summary.errors)} · совпало ${percent(summary.matched, summary.cases)}`,
);
for (const [verdict, { matched, total }] of Object.entries(summary.byVerdict)) {
  console.log(`  ${verdict.padEnd(17)} ${String(matched)}/${String(total)}`);
}
if (summary.confusion.length > 0) {
  console.log('\nНесовпадения');
  for (const { expected, actual, ids } of summary.confusion) {
    console.log(`  ${expected} → ${actual}: ${ids.join(', ')}`);
  }
}

const createdAt = new Date().toISOString();
const reportsDir = new URL('reports/', import.meta.url);
mkdirSync(reportsDir, { recursive: true });
const name = createdAt.replaceAll(':', '-').replace(/\.\d+Z$/u, '');
const reportUrl = new URL(`${name}.json`, reportsDir);
const report = {
  createdAt,
  model: CLASSIFIER_MODEL_ID,
  summary,
  cases: results.map(({ evalCase, answer }) => ({
    id: evalCase.id,
    expected: evalCase.expected,
    answer: answer instanceof Error ? null : answer,
    error: answer instanceof Error ? errorMessage(answer) : null,
  })),
};
writeFileSync(reportUrl, `${JSON.stringify(report, null, 2)}\n`);
console.log(`\nОтчёт ${reportUrl.pathname}`);
