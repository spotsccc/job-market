import { tryAsync } from '@spotsccc/error-as-value';

import { readGeonames } from './geonames.ts';
import { buildGeonamesSql } from './sql.ts';
import type { GeonamesSources } from './types.ts';

/** Части справочника, которые пишет `geo:build`. Часть manual добавит Э3. */
export const BUILD_PARTS = ['geonames'] as const;
export type BuildPart = (typeof BUILD_PARTS)[number];

/** Всё, что `runBuild` делает с внешним миром: сеть, диск, drizzle-kit. */
export type BuildDeps = {
  /** Скачивает дампы (или берёт из кэша) и открывает их строки. */
  readonly openSources: () => Promise<Error | GeonamesSources>;
  /** Коды из прошлого `src/generated/countries.ts`; пусто — файла ещё нет. */
  readonly previousCountryCodes: readonly string[];
  /** `drizzle-kit generate --custom --name <name>`; возвращает путь пустого SQL-файла. */
  readonly generateMigration: (name: string) => Promise<Error | string>;
  readonly writeFile: (path: string, content: string) => Promise<Error | undefined>;
  /** Куда писать `countries.ts`. */
  readonly countriesPath: string;
};

export type BuildSummary = {
  readonly countries: number;
  readonly cities: number;
  readonly droppedCities: number;
  readonly aliases: number;
  readonly migrationPath: string;
  readonly migrationBytes: number;
  readonly countriesPath: string;
};

/**
 * Собирает часть справочника и пишет миграцию и `countries.ts` (П6, П8). SQL и
 * `countries.ts` собираются в памяти целиком, и только потом вызывается drizzle-kit: при
 * любой ошибке в журнале миграций не остаётся пустой миграции.
 */
export async function runBuild(part: BuildPart, deps: BuildDeps): Promise<Error | BuildSummary> {
  const sources = await deps.openSources();
  if (sources instanceof Error) return sources;

  const data = await tryAsync(
    async () => readGeonames(sources, deps.previousCountryCodes),
    (cause: unknown) => new Error('Reading GeoNames dumps failed', { cause }),
  );
  if (data instanceof Error) return data;

  const sql = buildGeonamesSql(data);
  const countries = buildCountriesModule(data.countries.map((country) => country.code));

  const migrationPath = await deps.generateMigration(`geo_${part}`);
  if (migrationPath instanceof Error) return migrationPath;

  const writtenSql = await deps.writeFile(migrationPath, sql);
  if (writtenSql instanceof Error) return writtenSql;
  const writtenCountries = await deps.writeFile(deps.countriesPath, countries);
  if (writtenCountries instanceof Error) return writtenCountries;

  return {
    countries: data.countries.length,
    cities: data.cities.length,
    droppedCities: data.droppedCities,
    aliases: data.aliases.length,
    migrationPath,
    migrationBytes: Buffer.byteLength(sql),
    countriesPath: deps.countriesPath,
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
