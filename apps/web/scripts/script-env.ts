/**
 * Окружение скриптов, которым нужна только база: адрес выбирается по `NODE_ENV`, как у
 * `migrate.ts`: не задан — `.env.local`, `test` — `.env.test`, `production` — только
 * переменные окружения. Ошибка окружения завершает процесс с кодом 1.
 */
import path from 'node:path';

const ENV_FILES: Readonly<Record<string, string>> = {
  development: '.env.local',
  test: '.env.test',
};

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
}

export type ScriptEnv = { readonly mode: string; readonly databaseUrl: string };

export function loadScriptEnv(): ScriptEnv {
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
  const databaseUrl = readEnv('DATABASE_URL');
  if (databaseUrl === undefined) {
    console.error(`DATABASE_URL is not set (NODE_ENV=${mode})`);
    process.exit(1);
  }
  return { mode, databaseUrl };
}

/** Хост и база — первой строкой вывода: видно, та ли это база. */
export function describeDatabase({ mode, databaseUrl }: ScriptEnv): string {
  const target = new URL(databaseUrl);
  return `База ${target.hostname}${target.pathname} (${mode})`;
}

export const ruNumber = (value: number): string => value.toLocaleString('ru-RU');
