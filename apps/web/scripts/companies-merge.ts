/**
 * Слияние дублей компаний (Э4 плана companies):
 * `pnpm --filter @job-market/web companies:merge --from <id> --into <id>`. Ключи и вакансии
 * `--from` переходят к `--into`, компания `--from` удаляется. Ошибка — код выхода 1.
 */
import { parseArgs } from 'node:util';

import { getDb, mergeCompanies } from '@job-market/db';

import { describeDatabase, loadScriptEnv, ruNumber } from './script-env.ts';

const { values } = parseArgs({
  options: { from: { type: 'string' }, into: { type: 'string' } },
});
if (values.from === undefined || values.into === undefined) {
  console.error('Usage: companies:merge --from <company id> --into <company id>');
  process.exit(1);
}
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu;
for (const id of [values.from, values.into]) {
  if (!UUID.test(id)) {
    console.error(`Not a company id: "${id}"`);
    process.exit(1);
  }
}

const env = loadScriptEnv();
console.log(describeDatabase(env));

const db = getDb();
const result = await mergeCompanies(db, values.from, values.into);
await db.$client.end();
if (result instanceof Error) {
  console.error(`Ошибка: ${result.message}; ничего не изменено`);
  process.exit(1);
}
console.log(
  `перенесено ключей ${ruNumber(result.keys)}, вакансий ${ruNumber(result.vacancies)}; компания «${result.removed}» удалена`,
);
