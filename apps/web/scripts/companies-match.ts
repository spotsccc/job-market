/**
 * Пересчёт компаний записанных вакансий (Э3 плана companies):
 * `pnpm --filter @job-market/web companies:match`. Запускается после переноса постов и после
 * правки списка хостов-не-компаний. Повторный запуск без новых данных ничего не меняет.
 */
import { companies, count, desc, eq, getDb, rematchCompanies, vacancies } from '@job-market/db';

import { describeDatabase, loadScriptEnv, ruNumber } from './script-env.ts';

const env = loadScriptEnv();
console.log(describeDatabase(env));

const db = getDb();
const summary = await rematchCompanies(db);
console.log(
  [
    `обработано ${ruNumber(summary.processed)}`,
    `изменено ${ruNumber(summary.changed)}`,
    `создано компаний ${ruNumber(summary.created)}`,
    `без компании ${ruNumber(summary.withoutCompany)}`,
  ].join(' · '),
);

// Крупные компании: среди них видно дубли, которые надо слить, и агрегаторы вместо компаний.
const top = await db
  .select({ id: companies.id, name: companies.name, value: count() })
  .from(vacancies)
  .innerJoin(companies, eq(companies.id, vacancies.companyId))
  .groupBy(companies.id)
  .orderBy(desc(count()))
  .limit(20);
for (const row of top) console.log(`  ${ruNumber(row.value)}  ${row.name}  ${row.id}`);

await db.$client.end();
