/**
 * Перенос постов `legacy_posts` в новую модель (Э5 плана vacancy-extraction):
 *
 * `pnpm --filter @job-market/web vacancies:transfer --dry-run --limit 20` — пробный запуск;
 * `… vacancies:transfer --limit 100` — сотня постов; без `--limit` — все оставшиеся.
 *
 * Откуда берётся адрес базы — по `NODE_ENV`, как у `migrate.ts`: не задан — `.env.local`,
 * `test` — `.env.test`, `production` — только переменные окружения. Нужны `DATABASE_URL`,
 * `AI_GATEWAY_API_KEY` и `APIFY_TOKEN` (читатели ссылок LinkedIn).
 */
import path from 'node:path';
import { parseArgs } from 'node:util';

import { count, getDb, isNull, legacyPosts, publications, sql, vacancies } from '@job-market/db';
import type { Database } from '@job-market/db';
import { createReaders } from '@job-market/enricher';

import { transferPosts } from '../src/transfer/transfer.ts';
import type { TransferSummary } from '../src/transfer/transfer.ts';

const ENV_FILES: Readonly<Record<string, string>> = {
  development: '.env.local',
  test: '.env.test',
};

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
}

const mode = readEnv('NODE_ENV') ?? 'development';
const envFile = ENV_FILES[mode];
if (envFile === undefined && mode !== 'production') {
  console.error(`Unknown NODE_ENV "${mode}": expected development, test or production`);
  process.exit(1);
}
if (envFile !== undefined) {
  try {
    process.loadEnvFile(path.join(import.meta.dirname, '..', envFile));
  } catch {
    console.error(`Cannot read apps/web/${envFile}: copy apps/web/.env.example`);
    process.exit(1);
  }
}

const { values } = parseArgs({
  options: { limit: { type: 'string' }, 'dry-run': { type: 'boolean', default: false } },
});
const limit = values.limit === undefined ? undefined : Number(values.limit);
if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
  console.error(`--limit must be a positive integer, got "${values.limit ?? ''}"`);
  process.exit(1);
}
const dryRun = values['dry-run'];

const databaseUrl = readEnv('DATABASE_URL');
const apifyToken = readEnv('APIFY_TOKEN');
const missing = [
  ...(databaseUrl === undefined ? ['DATABASE_URL'] : []),
  ...(apifyToken === undefined ? ['APIFY_TOKEN'] : []),
];
if (databaseUrl === undefined || apifyToken === undefined) {
  console.error(`Not set: ${missing.join(', ')} (NODE_ENV=${mode})`);
  process.exit(1);
}

/** Посты без публикации: столько ещё не перенесено. */
async function untransferred(db: Database): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(legacyPosts)
    .leftJoin(publications, sql`${publications.id} = ${legacyPosts.id}`)
    .where(isNull(publications.id));
  return row?.value ?? 0;
}

async function legacyCount(db: Database): Promise<number> {
  const [row] = await db.select({ value: count() }).from(legacyPosts);
  return row?.value ?? 0;
}

const ruNumber = (value: number): string => value.toLocaleString('ru-RU');

function printSummary(summary: TransferSummary): void {
  console.log(
    [
      `Постов ${ruNumber(summary.posts)}`,
      `вакансий ${ruNumber(summary.vacancies)}`,
      `копий ${ruNumber(summary.duplicates)}`,
      `без текста ${ruNumber(summary.notVacancy)}`,
      `ошибок ${ruNumber(summary.errors.length)}`,
      `уже перенесено ${ruNumber(summary.alreadyTransferred)}`,
      `копий ждут оригинал ${ruNumber(summary.postponed)}`,
    ].join(' · '),
  );
  for (const { externalId, error } of summary.errors)
    console.log(`  ошибка ${externalId}: ${error}`);
  console.log(
    `Ссылки: прочитано ${ruNumber(summary.links.read)} · сбоев ${ruNumber(summary.links.failed)}`,
  );
  const occupations = [...summary.occupations]
    .toSorted(([, a], [, b]) => b - a)
    .map(([id, value]) => `${id} ${ruNumber(value)}`);
  console.log(`Профессии: ${occupations.join(', ') || '—'}`);
  const { places } = summary;
  console.log(
    `Места: распознано ${ruNumber(places.resolved)} · только страна ${ruNumber(places.partial)} · не распознано ${ruNumber(places.unresolved)} · откуда угодно ${ruNumber(places.anywhere)}`,
  );
  if (summary.stopped !== null) console.log(`Запуск остановлен: ${summary.stopped}`);
}

/** Сверка S6: публикации против постов, вакансии по версии схемы. */
async function printReconciliation(db: Database): Promise<void> {
  const statuses = await db
    .select({ status: publications.status, value: count() })
    .from(publications)
    .groupBy(publications.status);
  const versions = await db
    .select({ version: vacancies.schemaVersion, value: count() })
    .from(vacancies)
    .groupBy(vacancies.schemaVersion);
  const exhausted = await db
    .select({ externalId: publications.externalId, error: publications.lastError })
    .from(publications)
    .where(sql`${publications.status} = 'failed' AND ${publications.attempts} >= 3`);
  const total = statuses.reduce((sum, row) => sum + row.value, 0);
  console.log(
    `Сверка: legacy_posts ${ruNumber(await legacyCount(db))} · publications ${ruNumber(total)} (${statuses.map((row) => `${row.status} ${ruNumber(row.value)}`).join(', ')}) · постов без публикации ${ruNumber(await untransferred(db))} · vacancies ${versions.map((row) => `v${String(row.version)} ${ruNumber(row.value)}`).join(', ') || '0'}`,
  );
  for (const row of exhausted) {
    console.log(`  failed после трёх попыток: ${row.externalId}: ${row.error ?? ''}`);
  }
}

const db = getDb();
const target = new URL(databaseUrl);
// Хост и счётчики — до первого вызова модели: видно, та ли это база.
console.log(
  `База ${target.hostname}${target.pathname} (${mode}) · legacy_posts ${ruNumber(await legacyCount(db))} · без публикации ${ruNumber(await untransferred(db))}`,
);

const summary = await transferPosts({
  db,
  readers: createReaders({ apifyToken }),
  dryRun,
  ...(limit === undefined ? {} : { limit }),
});
printSummary(summary);
console.log(
  dryRun
    ? `Осталось ${ruNumber(await untransferred(db))} (пробный запуск ничего не записал)`
    : `Осталось ${ruNumber(await untransferred(db))}`,
);
if (!dryRun) await printReconciliation(db);
await db.$client.end();
process.exit(summary.stopped === null ? 0 : 1);
