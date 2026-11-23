import {
  and,
  asc,
  db,
  desc,
  eq,
  geoAliases,
  geoCities,
  geoCountries,
  ilike,
  or,
  sql,
} from '@job-market/db';
import type { GeoCityRow, GeoCountryRow } from '@job-market/db';

import { ALIAS_COLUMNS, ALIAS_ORDER, attempt, count, loadRegions } from './geo-data.ts';
import type { AliasItem, RegionSummary } from './geo-data.ts';

/** Сколько городов страны показываем на одной странице. */
export const CITIES_PAGE_SIZE = 100;

export type CityItem = Pick<
  GeoCityRow,
  'id' | 'name' | 'nameRu' | 'nameEn' | 'admin1Code' | 'population' | 'timezone'
> & { readonly archived: boolean };

export type CityPage = {
  readonly cities: readonly CityItem[];
  /** Сколько городов подходит под фильтр всего. */
  readonly total: number;
};

export type CountryDetails = CityPage & {
  readonly country: GeoCountryRow;
  /** Регионы, куда входит страна, включая архивные. */
  readonly regions: readonly RegionSummary[];
  readonly allRegions: readonly RegionSummary[];
  readonly aliases: readonly AliasItem[];
};

export type CityDetails = {
  readonly city: Omit<GeoCityRow, 'archivedAt'> & { readonly archivedAt: string | null };
  readonly country: Pick<GeoCountryRow, 'code' | 'nameRu'>;
  readonly aliases: readonly AliasItem[];
  readonly regions: readonly RegionSummary[];
};

export type CityFilter = {
  /** Страница, с 1. */
  readonly page: number;
  /** Часть названия на любом языке; пустая строка — все города. */
  readonly name: string;
};

/** Названия одного места: страны или города. */
function loadAliases(
  place: Readonly<{ countryCode: string }> | Readonly<{ cityId: number }>,
): Promise<AliasItem[]> {
  return db
    .select(ALIAS_COLUMNS)
    .from(geoAliases)
    .where(
      'cityId' in place
        ? eq(geoAliases.cityId, place.cityId)
        : eq(geoAliases.countryCode, place.countryCode),
    )
    .orderBy(...ALIAS_ORDER);
}

/** Города страны от больших к меньшим, архивные — тоже, с пометкой. */
async function loadCities(code: string, { page, name }: CityFilter): Promise<CityPage> {
  const pattern = `%${name.replaceAll(/[%_\\]/gu, (char) => `\\${char}`)}%`;
  const where = and(
    eq(geoCities.countryCode, code),
    name === ''
      ? undefined
      : or(
          ilike(geoCities.name, pattern),
          ilike(geoCities.nameRu, pattern),
          ilike(geoCities.nameEn, pattern),
        ),
  );
  const [rows, totals] = await Promise.all([
    db
      .select({
        id: geoCities.id,
        name: geoCities.name,
        nameRu: geoCities.nameRu,
        nameEn: geoCities.nameEn,
        admin1Code: geoCities.admin1Code,
        population: geoCities.population,
        timezone: geoCities.timezone,
        archived: sql<boolean>`${geoCities.archivedAt} is not null`,
      })
      .from(geoCities)
      .where(where)
      .orderBy(desc(geoCities.population), asc(geoCities.id))
      .limit(CITIES_PAGE_SIZE)
      .offset((page - 1) * CITIES_PAGE_SIZE),
    db.select({ total: count }).from(geoCities).where(where),
  ]);
  return { cities: rows, total: totals[0]?.total ?? 0 };
}

export async function getCountry(
  code: string,
  filter: CityFilter,
): Promise<CountryDetails | Error | null> {
  return attempt(`Loading country ${code}`, async () => {
    const [country] = await db.select().from(geoCountries).where(eq(geoCountries.code, code));
    if (country === undefined) return null;
    const [allRegions, aliases, cities] = await Promise.all([
      loadRegions(),
      loadAliases({ countryCode: code }),
      loadCities(code, filter),
    ]);
    return {
      ...cities,
      country,
      regions: allRegions.filter((region) => region.countries.some((item) => item === code)),
      allRegions,
      aliases,
    };
  });
}

export async function getCity(id: number): Promise<CityDetails | Error | null> {
  return attempt(`Loading city ${String(id)}`, async () => {
    const [row] = await db
      .select({
        city: {
          id: geoCities.id,
          countryCode: geoCities.countryCode,
          admin1Code: geoCities.admin1Code,
          name: geoCities.name,
          nameEn: geoCities.nameEn,
          nameRu: geoCities.nameRu,
          lat: geoCities.lat,
          lng: geoCities.lng,
          population: geoCities.population,
          timezone: geoCities.timezone,
          archivedAt: sql<string | null>`to_json(${geoCities.archivedAt}) #>> '{}'`,
        },
        country: { code: geoCountries.code, nameRu: geoCountries.nameRu },
      })
      .from(geoCities)
      .innerJoin(geoCountries, eq(geoCountries.code, geoCities.countryCode))
      .where(eq(geoCities.id, id));
    if (row === undefined) return null;
    const [aliases, regions] = await Promise.all([loadAliases({ cityId: id }), loadRegions()]);
    return { city: row.city, country: row.country, aliases, regions };
  });
}
