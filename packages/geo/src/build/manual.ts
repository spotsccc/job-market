import { ManualDataError } from '../errors/index.ts';
import { normalizeName } from '../normalize.ts';
import { inserts, joinStatements } from './sql.ts';

/** Регион, как его задаёт `regions.ts`; коды стран — строки, их проверяет `buildManualSql`. */
export type RegionInput = {
  readonly code: string;
  readonly nameRu: string;
  readonly nameEn: string;
  readonly description: string;
  readonly countries: readonly string[];
  readonly aliases: readonly string[];
};

/** Ручное название, как его задаёт `manual-aliases.ts`. */
export type ManualAliasInput = {
  readonly alias: string;
  readonly lang: string;
} & ({ readonly countryCode: string } | { readonly cityId: number });

export type ManualInput = {
  readonly regions: readonly RegionInput[];
  readonly aliases: readonly ManualAliasInput[];
  /** Коды стран справочника: `COUNTRY_CODES` из `src/generated/countries.ts`. */
  readonly countryCodes: readonly string[];
};

export type ManualSql = {
  readonly sql: string;
  readonly regions: number;
  readonly aliases: number;
};

type AliasRow = readonly [
  string,
  string,
  string | null,
  string | null,
  string | null,
  number | null,
];

const REGIONS_NEXT = 'geo_regions_next';

/**
 * SQL миграции manual (П4, П7): регионы — MERGE, убранные из `regions.ts` получают
 * `archived_at`, вернувшиеся — снова NULL; состав регионов заменяется целиком; названия
 * `source = 'manual'` заменяются целиком, названия GeoNames не трогаются. Сначала
 * проверяет данные: при ошибке SQL не собирается.
 */
export function buildManualSql(input: ManualInput): ManualDataError | ManualSql {
  const invalid = validate(input);
  if (invalid !== undefined) return invalid;

  const aliases = [
    ...input.regions.flatMap((region) => regionAliases(region)),
    ...input.aliases.map((alias) => manualAlias(alias)),
  ];
  const statements = [
    ...regionsSql(input.regions),
    ...aliasesSql(aliases),
    `DROP TABLE ${REGIONS_NEXT}`,
  ];
  return {
    sql: joinStatements(statements),
    regions: input.regions.length,
    aliases: aliases.length,
  };
}

/** Регионы и их состав. Состав убранного региона удаляется вместе с остальным. */
function regionsSql(regions: readonly RegionInput[]): string[] {
  return [
    `CREATE TEMP TABLE ${REGIONS_NEXT} (LIKE geo_regions)`,
    ...inserts(
      REGIONS_NEXT,
      ['code', 'name_en', 'name_ru', 'description'],
      regions.map((region) => [region.code, region.nameEn, region.nameRu, region.description]),
    ),
    `MERGE INTO geo_regions AS target
USING ${REGIONS_NEXT} AS source ON target.code = source.code
WHEN MATCHED THEN UPDATE SET
  name_en = source.name_en, name_ru = source.name_ru, description = source.description,
  archived_at = NULL
WHEN NOT MATCHED THEN INSERT (code, name_en, name_ru, description)
  VALUES (source.code, source.name_en, source.name_ru, source.description)
WHEN NOT MATCHED BY SOURCE AND target.archived_at IS NULL THEN UPDATE SET archived_at = now()`,
    'DELETE FROM geo_region_countries',
    ...inserts(
      'geo_region_countries',
      ['region_code', 'country_code'],
      regions.flatMap((region) => region.countries.map((country) => [region.code, country])),
    ),
  ];
}

/** Ручные названия заменяются целиком; названия GeoNames не трогаются (П7). */
function aliasesSql(aliases: readonly AliasRow[]): string[] {
  return [
    `DELETE FROM geo_aliases WHERE source = 'manual'`,
    ...inserts(
      'geo_aliases',
      ['normalized', 'alias', 'lang', 'source', 'country_code', 'region_code', 'city_id'],
      aliases.map(([normalized, alias, lang, countryCode, regionCode, cityId]) => [
        normalized,
        alias,
        lang,
        'manual',
        countryCode,
        regionCode,
        cityId,
      ]),
    ),
  ];
}

function validate(input: ManualInput): ManualDataError | undefined {
  const seen = new Set<string>();
  for (const region of input.regions) {
    const entry = `region ${region.code}`;
    if (seen.has(region.code)) return new ManualDataError({ entry, problem: 'duplicate code' });
    seen.add(region.code);
    if (region.countries.length === 0) {
      return new ManualDataError({ entry, problem: 'no countries' });
    }
    const unknown = region.countries.filter((code) => !input.countryCodes.includes(code));
    if (unknown.length > 0) {
      return new ManualDataError({
        entry,
        problem: `countries ${unknown.join(', ')} are not in src/generated/countries.ts`,
      });
    }
  }
  for (const alias of input.aliases) {
    const entry = `alias ${alias.alias}`;
    if (normalizeName(alias.alias) === '') {
      return new ManualDataError({ entry, problem: 'empty after normalization' });
    }
    if ('countryCode' in alias && !input.countryCodes.includes(alias.countryCode)) {
      return new ManualDataError({
        entry,
        problem: `country ${alias.countryCode} is not in src/generated/countries.ts`,
      });
    }
  }
  return undefined;
}

/** Код, названия и другие написания региона без повторов после нормализации. */
function regionAliases(region: RegionInput): AliasRow[] {
  const candidates: (readonly [string, string | null])[] = [
    [region.code, null],
    [region.nameEn, 'en'],
    [region.nameRu, 'ru'],
    ...region.aliases.map((alias) => [alias, null] as const),
  ];
  const seen = new Set<string>();
  const rows: AliasRow[] = [];
  for (const [alias, lang] of candidates) {
    const normalized = normalizeName(alias);
    if (normalized === '' || seen.has(normalized)) continue;
    seen.add(normalized);
    rows.push([normalized, alias, lang, null, region.code, null]);
  }
  return rows;
}

function manualAlias(alias: ManualAliasInput): AliasRow {
  const normalized = normalizeName(alias.alias);
  return 'countryCode' in alias
    ? [normalized, alias.alias, alias.lang, alias.countryCode, null, null]
    : [normalized, alias.alias, alias.lang, null, null, alias.cityId];
}
