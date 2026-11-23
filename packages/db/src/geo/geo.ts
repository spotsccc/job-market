import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
  check,
  doublePrecision,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';

/**
 * Страна из ISO 3166-1 (и Косово), как их ведёт GeoNames. Строки не удаляются: на
 * страну ссылаются города, названия и данные вакансий.
 */
export const geoCountries = pgTable(
  'geo_countries',
  {
    /** ISO 3166-1 alpha-2: `DE`, `GB`, `XK`. */
    code: char({ length: 2 }).primaryKey(),
    /** ISO 3166-1 alpha-3: `DEU`, `GBR`. Встречается в вакансиях, поэтому он же — название в `geo_aliases`. */
    iso3: char({ length: 3 }).notNull().unique('geo_countries_iso3_unique'),
    /** Id страны в GeoNames: по нему к стране приходят названия из `alternateNamesV2`. */
    geonameId: integer().notNull().unique('geo_countries_geoname_id_unique'),
    /** Континент по GeoNames: `EU`, `AS`, `AF`, `NA`, `SA`, `OC`, `AN`. */
    continent: char({ length: 2 }).notNull(),
    /** Английское название из `Intl.DisplayNames`: так же страну называет код на странице без запроса в базу. */
    nameEn: text().notNull(),
    nameRu: text().notNull(),
    population: bigint({ mode: 'number' }).notNull(),
  },
  () => [check('geo_countries_code_check', sql`"code" ~ '^[A-Z]{2}$'`)],
);

/**
 * Регион найма из `src/regions.ts` пакета `@job-market/geo`: группа стран, которую
 * пишут в вакансиях вместо списка стран (`eu`, `cis`, `dach`). Убранный из
 * `regions.ts` регион архивируется, а не удаляется: его код мог попасть в данные.
 */
export const geoRegions = pgTable(
  'geo_regions',
  {
    code: text().primaryKey(),
    nameEn: text().notNull(),
    nameRu: text().notNull(),
    /** Что считать этим регионом, одной-двумя фразами: по ней модель выбирает регион. */
    description: text().notNull(),
    /** Когда регион убран из `regions.ts`; `null` — действует. */
    archivedAt: timestamp({ withTimezone: true }),
  },
  () => [check('geo_regions_code_check', sql`"code" ~ '^[a-z][a-z_]*$'`)],
);

/** Страна, которая входит в регион найма. Состав уходит вместе с регионом. */
export const geoRegionCountries = pgTable(
  'geo_region_countries',
  {
    regionCode: text()
      .notNull()
      .references(() => geoRegions.code, { onDelete: 'cascade' }),
    countryCode: char({ length: 2 })
      .notNull()
      .references(() => geoCountries.code, { onDelete: 'restrict' }),
  },
  (table) => [
    primaryKey({ columns: [table.regionCode, table.countryCode] }),
    // В какие регионы входит страна: предки места.
    index('geo_region_countries_country_code_index').on(table.countryCode),
  ],
);

/**
 * Населённый пункт из `cities15000`: от 15 000 жителей или столица. `id` — id
 * GeoNames, он стабилен между выгрузками, поэтому город обновляется, а не
 * создаётся заново. Пропавший из выгрузки город архивируется, а не удаляется.
 */
export const geoCities = pgTable(
  'geo_cities',
  {
    /** Id города в GeoNames: `2950159` — Берлин. */
    id: integer().primaryKey(),
    countryCode: char({ length: 2 })
      .notNull()
      .references(() => geoCountries.code, { onDelete: 'restrict' }),
    /** Код региона первого уровня по GeoNames (частью FIPS, частью ISO): `16` — земля Берлин. */
    admin1Code: text(),
    /** Основное название по GeoNames: `Berlin`, `München`. */
    name: text().notNull(),
    /** Предпочтительное английское название; `null` — совпадает с `name` или его нет. */
    nameEn: text(),
    /** Предпочтительное русское название: `Мюнхен`; `null` — его нет в GeoNames. */
    nameRu: text(),
    /** Широта, градусы WGS 84. */
    lat: doublePrecision().notNull(),
    /** Долгота, градусы WGS 84. */
    lng: doublePrecision().notNull(),
    /** Население по GeoNames: по нему выбирается город среди одноимённых и сортируется поиск. */
    population: integer().notNull(),
    /** Часовой пояс IANA: `Europe/Berlin`. */
    timezone: text().notNull(),
    /** Когда город пропал из выгрузки GeoNames; `null` — есть в последней. */
    archivedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    check('geo_cities_population_check', sql`"population" >= 0`),
    // Города страны от больших к меньшим.
    index('geo_cities_country_code_population_index')
      .on(table.countryCode, table.population.desc())
      .where(sql`"archived_at" IS NULL`),
  ],
);

/** Откуда название: `geonames` — дамп GeoNames, `manual` — `regions.ts` и `manual-aliases.ts`. */
export const GEO_ALIAS_SOURCES = ['geonames', 'manual'] as const;
export type GeoAliasSource = (typeof GEO_ALIAS_SOURCES)[number];

/**
 * Одно написание места — страны, региона или города — из одного источника. Ведёт
 * ровно на одно место. Каждая часть `geo:build` заменяет только названия своего
 * `source`; у регионов названия только ручные.
 */
export const geoAliases = pgTable(
  'geo_aliases',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    /**
     * Название после `normalizeName` из `@job-market/geo`: «санкт петербург». По нему
     * ищут разбор и автодополнение. Нормализует TypeScript, а не генерируемый
     * столбец: `unaccent` в генерируемом столбце использовать нельзя.
     */
    normalized: text().notNull(),
    /** Название как в источнике: «Санкт-Петербург». */
    alias: text().notNull(),
    /** Язык по GeoNames: `ru`, `en`, `de`, `abbr`; `null` — код или основное имя. */
    lang: text(),
    source: text({ enum: GEO_ALIAS_SOURCES }).notNull(),
    countryCode: char({ length: 2 }).references(() => geoCountries.code, {
      onDelete: 'restrict',
    }),
    regionCode: text().references(() => geoRegions.code, { onDelete: 'cascade' }),
    cityId: integer().references(() => geoCities.id, { onDelete: 'restrict' }),
  },
  (table) => [
    check(
      'geo_aliases_one_place_check',
      sql`num_nonnulls("country_code", "region_code", "city_id") = 1`,
    ),
    check('geo_aliases_source_check', sql`"source" IN ('geonames', 'manual')`),
    check('geo_aliases_region_manual_check', sql`"source" = 'manual' OR "region_code" IS NULL`),
    // Два из трёх столбцов места всегда NULL, а обычный UNIQUE считает NULL разными.
    unique('geo_aliases_source_normalized_place_unique')
      .on(table.source, table.normalized, table.countryCode, table.regionCode, table.cityId)
      .nullsNotDistinct(),
    // Точное совпадение при разборе.
    index('geo_aliases_normalized_index').on(table.normalized),
    // LIKE 'бер%' в автодополнении; нужен pg_trgm.
    index('geo_aliases_normalized_trgm_index').using('gin', table.normalized.op('gin_trgm_ops')),
  ],
);

export type GeoCountryRow = typeof geoCountries.$inferSelect;
export type NewGeoCountryRow = typeof geoCountries.$inferInsert;
export type GeoRegionRow = typeof geoRegions.$inferSelect;
export type NewGeoRegionRow = typeof geoRegions.$inferInsert;
export type GeoRegionCountryRow = typeof geoRegionCountries.$inferSelect;
export type NewGeoRegionCountryRow = typeof geoRegionCountries.$inferInsert;
export type GeoCityRow = typeof geoCities.$inferSelect;
export type NewGeoCityRow = typeof geoCities.$inferInsert;
export type GeoAliasRow = typeof geoAliases.$inferSelect;
export type NewGeoAliasRow = typeof geoAliases.$inferInsert;
