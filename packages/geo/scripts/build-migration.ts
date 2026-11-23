/**
 * `pnpm geo:build geonames [--refresh]`: собирает часть справочника и пишет миграцию в
 * `packages/db/migrations` и `src/generated/countries.ts`. Оба файла коммитятся вместе (П8).
 * Дампы кэшируются в `node_modules/.cache/geonames`; `--refresh` качает их заново.
 */
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { GEONAMES_DUMP_URL, GEONAMES_FILES, downloadGeonames } from '../src/build/download.ts';
import { BUILD_PARTS, runBuild } from '../src/build/run.ts';
import type { BuildPart } from '../src/build/run.ts';
import { COUNTRY_CODES } from '../src/generated/countries.ts';
import { MANUAL_ALIASES } from '../src/manual-aliases.ts';
import { REGIONS } from '../src/regions.ts';

const packageDir = fileURLToPath(new URL('..', import.meta.url));
const repoDir = fileURLToPath(new URL('../../..', import.meta.url));
const migrationsDir = fileURLToPath(new URL('../../db/migrations/', import.meta.url));
const countriesPath = fileURLToPath(new URL('../src/generated/countries.ts', import.meta.url));
const cacheDir = fileURLToPath(new URL('../node_modules/.cache/geonames', import.meta.url));

const args = process.argv.slice(2);
const part = args.find((arg) => !arg.startsWith('--'));
const refresh = args.includes('--refresh');

if (!isBuildPart(part)) {
  console.error(`Usage: pnpm geo:build <${BUILD_PARTS.join(' | ')}> [--refresh]`);
  process.exit(1);
}

const summary = await runBuild(part, {
  openSources: async () => {
    const paths = await downloadGeonames(GEONAMES_FILES, {
      cacheDir,
      baseUrl: GEONAMES_DUMP_URL,
      refresh,
    });
    if (paths instanceof Error) return paths;
    const [countryInfo, cities, alternateNames] = paths;
    if (countryInfo === undefined || cities === undefined || alternateNames === undefined) {
      return new Error('downloadGeonames returned fewer paths than files');
    }
    return {
      countryInfo: lines(createReadStream(countryInfo)),
      cities: zipLines(cities, 'cities15000.txt'),
      alternateNames: zipLines(alternateNames, 'alternateNamesV2.txt'),
    };
  },
  // Коды на момент запуска: часть geonames перепишет countries.ts уже после импорта.
  previousCountryCodes: COUNTRY_CODES,
  manual: { regions: REGIONS, aliases: MANUAL_ALIASES, countryCodes: COUNTRY_CODES },
  generateMigration,
  writeFile: async (path, content) => {
    const written = await writeFile(path, content).catch(
      (cause: unknown) => new Error(`Writing ${path} failed`, { cause }),
    );
    return written instanceof Error ? written : undefined;
  },
  countriesPath,
});

if (summary instanceof Error) {
  console.error(summary);
  process.exit(1);
}

// Сгенерированные модули приводятся к формату репозитория, чтобы прошёл format:check.
if (summary.files.length > 0) await run('pnpm', ['exec', 'oxfmt', ...summary.files], packageDir);

const size = `${(summary.migrationBytes / 1024).toFixed(0)} КБ`;
console.log(
  [
    ...summary.report,
    `Записано: ${[`${summary.migrationPath} (${size})`, ...summary.files].join(', ')}`,
  ].join(' '),
);

function isBuildPart(value: string | undefined): value is BuildPart {
  return BUILD_PARTS.some((known) => known === value);
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- поток Node по природе изменяем
async function* lines(input: NodeJS.ReadableStream): AsyncGenerator<string> {
  yield* createInterface({ input, crlfDelay: Infinity });
}

/** Строки файла из zip-архива: `unzip -p` распаковывает потоком, не на диск. */
async function* zipLines(zip: string, entry: string): AsyncGenerator<string> {
  const child = spawn('unzip', ['-p', zip, entry], { stdio: ['ignore', 'pipe', 'inherit'] });
  const exit = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  yield* lines(child.stdout);
  const code = await exit;
  if (code !== 0) throw new Error(`unzip -p ${zip} ${entry} exited with ${String(code)}`);
}

/** Пустая custom-миграция от drizzle-kit: он ведёт журнал и снимок схемы. */
async function generateMigration(name: string): Promise<Error | string> {
  const generated = await run(
    'pnpm',
    ['--filter', '@job-market/db', 'exec', 'drizzle-kit', 'generate', '--custom', '--name', name],
    repoDir,
  ).catch((cause: unknown) => new Error('drizzle-kit generate --custom failed', { cause }));
  if (generated instanceof Error) return generated;

  const journal = await readFile(`${migrationsDir}meta/_journal.json`, 'utf8')
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- журнал пишет drizzle-kit
    .then((text) => JSON.parse(text) as { entries: { tag: string }[] })
    .catch(
      (cause: unknown) => new Error('Reading the drizzle migrations journal failed', { cause }),
    );
  if (journal instanceof Error) return journal;

  const tag = journal.entries.at(-1)?.tag;
  if (tag?.endsWith(`_${name}`) !== true) {
    return new Error(`The last journal entry is ${String(tag)}, not the new ${name} migration`);
  }
  return `${migrationsDir}${tag}.sql`;
}

async function run(command: string, commandArgs: readonly string[], cwd: string): Promise<void> {
  const child = spawn(command, commandArgs, { cwd, stdio: 'inherit' });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  if (code !== 0)
    throw new Error(`${command} ${commandArgs.join(' ')} exited with ${String(code)}`);
}
