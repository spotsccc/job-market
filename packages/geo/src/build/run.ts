import { tryAsync } from '@spotsccc/error-as-value';

import { readGeonames } from './geonames.ts';
import { buildManualSql } from './manual.ts';
import type { ManualInput } from './manual.ts';
import { buildGeonamesSql } from './sql.ts';
import type { GeonamesSources } from './types.ts';

/** Части справочника, которые пишет `geo:build` (П6). */
export const BUILD_PARTS = ['geonames', 'manual'] as const;
export type BuildPart = (typeof BUILD_PARTS)[number];

/** Всё, что `runBuild` берёт извне: сеть, диск, drizzle-kit, данные из кода. */
export type BuildDeps = {
  /** Скачивает дампы (или берёт из кэша) и открывает их строки. Нужно части geonames. */
  readonly openSources: () => Promise<Error | GeonamesSources>;
  /** Коды из прошлого `src/generated/countries.ts`; пусто — файла ещё нет. */
  readonly previousCountryCodes: readonly string[];
  /** Регионы, ручные названия и коды стран. Нужно части manual. */
  readonly manual: ManualInput;
  /** `drizzle-kit generate --custom --name <name>`; возвращает путь пустого SQL-файла. */
  readonly generateMigration: (name: string) => Promise<Error | string>;
  readonly writeFile: (path: string, content: string) => Promise<Error | undefined>;
  /** Куда писать `countries.ts`. */
  readonly countriesPath: string;
};

export type BuildSummary = {
  /** Что собрано, строками для консоли. */
  readonly report: readonly string[];
  readonly migrationPath: string;
  readonly migrationBytes: number;
  /** Другие записанные файлы: `countries.ts` у части geonames. */
  readonly files: readonly string[];
};

/** Собранная в памяти часть: SQL миграции и другие файлы. */
type BuiltPart = {
  readonly sql: string;
  readonly files: readonly { readonly path: string; readonly content: string }[];
  readonly report: readonly string[];
};

/**
 * Собирает часть справочника и пишет миграцию и её файлы (П6, П8). Всё собирается в
 * памяти целиком, и только потом вызывается drizzle-kit: при любой ошибке в журнале
 * миграций не остаётся пустой миграции.
 */
export async function runBuild(part: BuildPart, deps: BuildDeps): Promise<Error | BuildSummary> {
  const built = part === 'geonames' ? await buildGeonamesPart(deps) : buildManualPart(deps.manual);
  if (built instanceof Error) return built;

  const migrationPath = await deps.generateMigration(`geo_${part}`);
  if (migrationPath instanceof Error) return migrationPath;

  const writtenSql = await deps.writeFile(migrationPath, built.sql);
  if (writtenSql instanceof Error) return writtenSql;
  for (const file of built.files) {
    // Файлы пишутся по одному: при ошибке остальные не пишутся.
    // oxlint-disable-next-line no-await-in-loop -- порядок записи важен
    const written = await deps.writeFile(file.path, file.content);
    if (written instanceof Error) return written;
  }

  return {
    report: built.report,
    migrationPath,
    migrationBytes: Buffer.byteLength(built.sql),
    files: built.files.map((file) => file.path),
  };
}

async function buildGeonamesPart(deps: BuildDeps): Promise<Error | BuiltPart> {
  const sources = await deps.openSources();
  if (sources instanceof Error) return sources;

  const data = await tryAsync(
    async () => readGeonames(sources, deps.previousCountryCodes),
    (cause: unknown) => new Error('Reading GeoNames dumps failed', { cause }),
  );
  if (data instanceof Error) return data;

  return {
    sql: buildGeonamesSql(data),
    files: [
      {
        path: deps.countriesPath,
        content: buildCountriesModule(data.countries.map((country) => country.code)),
      },
    ],
    report: [
      `Стран: ${String(data.countries.length)}.`,
      `Городов: ${String(data.cities.length)} (отброшено ${String(data.droppedCities)}).`,
      `Названий: ${String(data.aliases.length)}.`,
    ],
  };
}

function buildManualPart(input: ManualInput): Error | BuiltPart {
  const manual = buildManualSql(input);
  if (manual instanceof Error) return manual;
  const sizes = input.regions.map((region) => `${region.code} ${String(region.countries.length)}`);
  return {
    sql: manual.sql,
    files: [],
    report: [
      `Регионов: ${String(manual.regions)} (${sizes.join(', ')}).`,
      `Ручных названий: ${String(manual.aliases)}.`,
    ],
  };
}

/** Текст `src/generated/countries.ts`: коды тех же стран, что в миграции (П8). */
export function buildCountriesModule(codes: readonly string[]): string {
  const list = [...codes]
    .toSorted()
    .map((code) => `  '${code}',`)
    .join('\n');
  return `// Пишет pnpm geo:build geonames вместе с миграцией geo_geonames. Руками не править.

/** Коды стран справочника, ISO 3166-1 alpha-2 и XK; те же, что в geo_countries. */
export const COUNTRY_CODES = [
${list}
] as const;

export type CountryCode = (typeof COUNTRY_CODES)[number];

const codes: ReadonlySet<string> = new Set(COUNTRY_CODES);

export function isCountryCode(value: string): value is CountryCode {
  return codes.has(value);
}
`;
}
