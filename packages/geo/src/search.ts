import {
  and,
  asc,
  desc,
  eq,
  geoAliases,
  geoCities,
  geoCountries,
  geoRegions,
  isNull,
  sql,
} from '@job-market/db';

import { GeoQueryError } from './errors/index.ts';
import { formatPlace } from './format.ts';
import type { CityNames, Locale } from './format.ts';
import { isCountryCode } from './generated/countries.ts';
import { normalizeName } from './normalize.ts';
import type { Place } from './place.ts';
import type { GeoDb } from './resolve.ts';

export type SearchOptions = {
  readonly locale: Locale;
  readonly limit: number;
};

/** Подсказка автодополнения: место и его название на языке `locale`. */
export type PlaceSuggestion = {
  readonly place: Place;
  readonly label: string;
  readonly city: CityNames | null;
  /** Население города или страны; у региона — `null`. */
  readonly population: number | null;
};

/** Запрос короче этого после нормализации в базу не идёт (П14). */
const MIN_QUERY_LENGTH = 2;

/**
 * Автодополнение (П14): места, у которых какое-то название начинается с `query` после
 * нормализации. Сначала регионы и страны, затем города по убыванию населения; каждое
 * место — один раз; не больше `limit`. Архивные города и регионы не предлагаются.
 */
export async function searchPlaces(
  db: GeoDb,
  query: string,
  { locale, limit }: SearchOptions,
): Promise<readonly PlaceSuggestion[] | GeoQueryError> {
  const prefix = normalizeName(query);
  if (prefix.length < MIN_QUERY_LENGTH || limit <= 0) return [];

  const rows = await queryPrefix(db, prefix, limit);
  if (rows instanceof Error) return rows;
  return rows.flatMap((row) => toSuggestions(row, locale));
}

type SuggestionRow = {
  readonly countryCode: string | null;
  readonly regionCode: string | null;
  readonly cityId: number | null;
  readonly cityCountryCode: string | null;
  readonly cityPopulation: number | null;
  readonly countryPopulation: number | null;
  readonly name: string | null;
  readonly nameRu: string | null;
  readonly nameEn: string | null;
};

async function queryPrefix(
  db: GeoDb,
  prefix: string,
  limit: number,
): Promise<readonly SuggestionRow[] | GeoQueryError> {
  // Ключи сортировки — столбцы выборки: этого требует SELECT DISTINCT.
  return (
    db
      .selectDistinct({
        countryCode: geoAliases.countryCode,
        regionCode: geoAliases.regionCode,
        cityId: geoAliases.cityId,
        cityCountryCode: geoCities.countryCode,
        cityPopulation: geoCities.population,
        countryPopulation: geoCountries.population,
        name: geoCities.name,
        nameRu: geoCities.nameRu,
        nameEn: geoCities.nameEn,
      })
      .from(geoAliases)
      .leftJoin(geoCities, eq(geoCities.id, geoAliases.cityId))
      .leftJoin(geoRegions, eq(geoRegions.code, geoAliases.regionCode))
      .leftJoin(geoCountries, eq(geoCountries.code, geoAliases.countryCode))
      // normalizeName оставляет только буквы, цифры и пробелы: % и _ в префиксе не бывает.
      .where(
        and(
          sql`${geoAliases.normalized} LIKE ${`${prefix}%`}`,
          isNull(geoCities.archivedAt),
          isNull(geoRegions.archivedAt),
        ),
      )
      .orderBy(
        // DESC ставит NULL первыми: регионы и страны — раньше городов.
        desc(geoCities.population),
        asc(geoAliases.regionCode),
        desc(geoCountries.population),
        asc(geoAliases.cityId),
      )
      .limit(limit)
      .catch((cause: unknown) => new GeoQueryError({ cause }))
  );
}

/** Строка выборки → подсказка; строка без места (не бывает при внешних ключах) отбрасывается. */
function toSuggestions(row: SuggestionRow, locale: Locale): PlaceSuggestion[] {
  if (row.regionCode !== null) {
    const place: Place = { kind: 'region', code: row.regionCode };
    return [{ place, label: formatPlace(place, locale), city: null, population: null }];
  }
  if (row.countryCode !== null && isCountryCode(row.countryCode)) {
    const place: Place = { kind: 'country', code: row.countryCode };
    return [
      {
        place,
        label: formatPlace(place, locale),
        city: null,
        population: row.countryPopulation,
      },
    ];
  }
  if (
    row.cityId !== null &&
    row.cityCountryCode !== null &&
    isCountryCode(row.cityCountryCode) &&
    row.name !== null
  ) {
    const place: Place = { kind: 'city', id: row.cityId, countryCode: row.cityCountryCode };
    const city: CityNames = { name: row.name, nameRu: row.nameRu, nameEn: row.nameEn };
    return [
      { place, label: formatPlace(place, locale, city), city, population: row.cityPopulation },
    ];
  }
  return [];
}
