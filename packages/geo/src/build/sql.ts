import type { GeonamesData } from './types.ts';

/** Разделитель операторов: по нему drizzle режет файл миграции. */
export const STATEMENT_BREAKPOINT = '--> statement-breakpoint';

/** Сколько строк в одном INSERT: так оператор остаётся небольшим. */
const ROWS_PER_INSERT = 1000;

const COUNTRIES_NEXT = 'geo_countries_next';
const CITIES_NEXT = 'geo_cities_next';

/**
 * SQL миграции geonames (П6, П7). Новый снимок кладётся во временные таблицы, затем:
 * страны — MERGE без удаления; города — MERGE, пропавшие получают `archived_at`,
 * вернувшиеся — снова NULL; названия `source = 'geonames'` заменяются целиком, ручные не
 * трогаются. Временные таблицы удаляются в конце явно, а не ON COMMIT DROP: drizzle
 * применяет все новые миграции в одной транзакции, и вторая такая же миграция
 * создаёт таблицы с теми же именами.
 */
export function buildGeonamesSql(data: GeonamesData): string {
  const statements = [
    ...countriesSql(data.countries),
    ...citiesSql(data.cities),
    ...aliasesSql(data.aliases),
    `DROP TABLE ${COUNTRIES_NEXT}`,
    `DROP TABLE ${CITIES_NEXT}`,
  ];
  return `${statements.join(`;${STATEMENT_BREAKPOINT}\n`)};\n`;
}

/** Страны не удаляются (П7): пропавшую страну генератор останавливает раньше. */
function countriesSql(countries: GeonamesData['countries']): string[] {
  return [
    `CREATE TEMP TABLE ${COUNTRIES_NEXT} (LIKE geo_countries)`,
    ...inserts(
      COUNTRIES_NEXT,
      ['code', 'iso3', 'geoname_id', 'continent', 'name_en', 'name_ru', 'population'],
      countries.map((country) => [
        country.code,
        country.iso3,
        country.geonameId,
        country.continent,
        country.nameEn,
        country.nameRu,
        country.population,
      ]),
    ),
    `MERGE INTO geo_countries AS target
USING ${COUNTRIES_NEXT} AS source ON target.code = source.code
WHEN MATCHED THEN UPDATE SET
  iso3 = source.iso3, geoname_id = source.geoname_id, continent = source.continent,
  name_en = source.name_en, name_ru = source.name_ru, population = source.population
WHEN NOT MATCHED THEN INSERT (code, iso3, geoname_id, continent, name_en, name_ru, population)
  VALUES (source.code, source.iso3, source.geoname_id, source.continent, source.name_en,
    source.name_ru, source.population)`,
  ];
}

/** Пропавший город получает `archived_at`, вернувшийся — снова NULL (П7). */
function citiesSql(cities: GeonamesData['cities']): string[] {
  return [
    `CREATE TEMP TABLE ${CITIES_NEXT} (LIKE geo_cities)`,
    ...inserts(
      CITIES_NEXT,
      [
        'id',
        'country_code',
        'admin1_code',
        'name',
        'name_en',
        'name_ru',
        'lat',
        'lng',
        'population',
        'timezone',
      ],
      cities.map((city) => [
        city.id,
        city.countryCode,
        city.admin1Code,
        city.name,
        city.nameEn,
        city.nameRu,
        city.lat,
        city.lng,
        city.population,
        city.timezone,
      ]),
    ),
    `MERGE INTO geo_cities AS target
USING ${CITIES_NEXT} AS source ON target.id = source.id
WHEN MATCHED THEN UPDATE SET
  country_code = source.country_code, admin1_code = source.admin1_code, name = source.name,
  name_en = source.name_en, name_ru = source.name_ru, lat = source.lat, lng = source.lng,
  population = source.population, timezone = source.timezone, archived_at = NULL
WHEN NOT MATCHED THEN INSERT
  (id, country_code, admin1_code, name, name_en, name_ru, lat, lng, population, timezone)
  VALUES (source.id, source.country_code, source.admin1_code, source.name, source.name_en,
    source.name_ru, source.lat, source.lng, source.population, source.timezone)
WHEN NOT MATCHED BY SOURCE AND target.archived_at IS NULL THEN UPDATE SET archived_at = now()`,
  ];
}

/** Названия GeoNames заменяются целиком; ручные (`source = 'manual'`) не трогаются (П7). */
function aliasesSql(aliases: GeonamesData['aliases']): string[] {
  return [
    `DELETE FROM geo_aliases WHERE source = 'geonames'`,
    ...inserts(
      'geo_aliases',
      ['normalized', 'alias', 'lang', 'source', 'country_code', 'city_id'],
      aliases.map((alias) => [
        alias.normalized,
        alias.alias,
        alias.lang,
        'geonames',
        alias.countryCode,
        alias.cityId,
      ]),
    ),
  ];
}

type SqlValue = string | number | null;

function inserts(
  table: string,
  columns: readonly string[],
  rows: readonly (readonly SqlValue[])[],
): string[] {
  const statements: string[] = [];
  for (let start = 0; start < rows.length; start += ROWS_PER_INSERT) {
    const values = rows
      .slice(start, start + ROWS_PER_INSERT)
      .map((row) => `(${row.map((value) => literal(value)).join(', ')})`)
      .join(',\n');
    statements.push(`INSERT INTO ${table} (${columns.join(', ')}) VALUES\n${values}`);
  }
  return statements;
}

/**
 * Литерал SQL. Строка — в одинарных кавычках с удвоенной кавычкой внутри: при
 * `standard_conforming_strings = on` (по умолчанию) обратный слэш не экранирует.
 */
export function literal(value: SqlValue): string {
  if (value === null) return 'NULL';
  if (typeof value === 'number') return String(value);
  return `'${value.replaceAll("'", "''")}'`;
}
