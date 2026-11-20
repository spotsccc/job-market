/**
 * Применяет миграции базы: `pnpm db:migrate` из корня или из `apps/web`.
 *
 * Откуда берётся адрес базы — по `NODE_ENV`, как у самого Next.js:
 * - не задан или `development` — `apps/web/.env.local`;
 * - `test` — `apps/web/.env.test`;
 * - `production` — только настоящие переменные окружения (Vercel, CI).
 * Переменная, уже заданная в окружении, сильнее файла: CI может подменить адрес.
 *
 * Берёт `DATABASE_URL_UNPOOLED`, если он есть (Neon кладёт туда прямое
 * подключение — миграциям пулер не подходит), иначе `DATABASE_URL`.
 */
import path from 'node:path';

import { migrateDatabase } from '@job-market/db/migrate';

const ENV_FILES: Readonly<Record<string, string>> = {
  development: '.env.local',
  test: '.env.test',
};

/** Типы Next.js обещают, что NODE_ENV задан, но у скрипта вне Next его может не быть. */
function readNodeEnv(): string | undefined {
  return process.env['NODE_ENV'];
}

const mode = readNodeEnv() ?? 'development';
const envFile = ENV_FILES[mode];

if (envFile === undefined && mode !== 'production') {
  console.error(`Unknown NODE_ENV "${mode}": expected development, test or production`);
  process.exit(1);
}

if (envFile !== undefined) {
  const envPath = path.join(import.meta.dirname, '..', envFile);
  try {
    process.loadEnvFile(envPath);
  } catch {
    console.error(`Cannot read ${envPath}: copy apps/web/.env.example and set DATABASE_URL`);
    process.exit(1);
  }
}

const connectionString = process.env['DATABASE_URL_UNPOOLED'] ?? process.env['DATABASE_URL'];
if (connectionString === undefined || connectionString === '') {
  console.error(`DATABASE_URL is not set (NODE_ENV=${mode})`);
  process.exit(1);
}

const target = new URL(connectionString);
console.log(`Migrating ${target.hostname}:${target.port || '5432'}${target.pathname} (${mode})`);
await migrateDatabase(connectionString);
console.log('Migrations applied');
