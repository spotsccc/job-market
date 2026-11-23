import {
  asc,
  db,
  eq,
  geoAliases,
  geoCities,
  geoCountries,
  geoRegionCountries,
  geoRegions,
  sql,
} from '@job-market/db';
import type { GeoAliasRow, GeoCountryRow } from '@job-market/db';
import type { CountryCode, RegionMembers } from '@job-market/geo';

export type GeoTotals = {
  readonly regions: number;
  readonly archivedRegions: number;
  readonly countries: number;
  readonly cities: number;
  readonly archivedCities: number;
  readonly aliases: number;
};

/** Регион найма с составом. Дата архивации — строкой ISO: на страницу она уходит строкой. */
export type RegionSummary = {
  readonly code: string;
  readonly nameRu: string;
  readonly nameEn: string;
  readonly description: string;
  readonly archivedAt: string | null;
  readonly countries: readonly CountryCode[];
};

export type CountrySummary = Pick<
  GeoCountryRow,
  'code' | 'iso3' | 'continent' | 'nameRu' | 'nameEn' | 'population'
> & {
  /** Сколько у страны действующих городов. */
  readonly cities: number;
  /** Коды регионов, куда входит страна, включая архивные. */
  readonly regions: readonly string[];
};

export type GeoOverview = {
  readonly totals: GeoTotals;
  readonly regions: readonly RegionSummary[];
  readonly countries: readonly CountrySummary[];
};

export type AliasItem = Pick<GeoAliasRow, 'id' | 'alias' | 'normalized' | 'lang' | 'source'>;

export type CountryItem = Pick<GeoCountryRow, 'code' | 'nameRu' | 'nameEn' | 'population'>;

export type RegionDetails = {
  readonly region: RegionSummary;
  readonly countries: readonly CountryItem[];
  readonly aliases: readonly AliasItem[];
  /** Все регионы с составом: по ним считаются вложенность и покрытие (П5). */
  readonly allRegions: readonly RegionSummary[];
};

export const ALIAS_COLUMNS = {
  id: geoAliases.id,
  alias: geoAliases.alias,
  normalized: geoAliases.normalized,
  lang: geoAliases.lang,
  source: geoAliases.source,
};

export const ALIAS_ORDER = [asc(geoAliases.source), asc(geoAliases.lang), asc(geoAliases.alias)];

/**
 * Запрос к базе ошибкой-значением, как в `search-vacancies.ts`. `async`-обёртка: `db`
 * бросает синхронно, если не задан DATABASE_URL, — `.catch` ловит и это.
 */
export async function attempt<T>(what: string, run: () => Promise<T>): Promise<Error | T> {
  async function wrapped(): Promise<T> {
    return run();
  }
  return wrapped().catch((cause: unknown) => new Error(`${what} failed`, { cause }));
}

export const count = sql<number>`count(*)`.mapWith(Number);

async function loadTotals(): Promise<GeoTotals> {
  const [regions, countries, cities, aliases] = await Promise.all([
    db
      .select({
        total: count,
        archived: sql<number>`count(${geoRegions.archivedAt})`.mapWith(Number),
      })
      .from(geoRegions),
    db.select({ total: count }).from(geoCountries),
    db
      .select({
        total: count,
        archived: sql<number>`count(${geoCities.archivedAt})`.mapWith(Number),
      })
      .from(geoCities),
    db.select({ total: count }).from(geoAliases),
  ]);
  return {
    regions: regions[0]?.total ?? 0,
    archivedRegions: regions[0]?.archived ?? 0,
    countries: countries[0]?.total ?? 0,
    cities: cities[0]?.total ?? 0,
    archivedCities: cities[0]?.archived ?? 0,
    aliases: aliases[0]?.total ?? 0,
  };
}

/** Все регионы с составом: сначала действующие, внутри — от узких к широким, как в П13. */
export async function loadRegions(): Promise<readonly RegionSummary[]> {
  const member = geoRegionCountries.countryCode;
  const rows = await db
    .select({
      code: geoRegions.code,
      nameEn: geoRegions.nameEn,
      nameRu: geoRegions.nameRu,
      description: geoRegions.description,
      archivedAt: sql<string | null>`to_json(${geoRegions.archivedAt}) #>> '{}'`,
      countries: sql<
        readonly CountryCode[]
      >`coalesce(array_agg(${member} order by ${member}) filter (where ${member} is not null), '{}')`,
    })
    .from(geoRegions)
    .leftJoin(geoRegionCountries, eq(geoRegionCountries.regionCode, geoRegions.code))
    .groupBy(geoRegions.code);
  return rows.toSorted(
    (a, b) =>
      Number(a.archivedAt !== null) - Number(b.archivedAt !== null) ||
      a.countries.length - b.countries.length ||
      a.code.localeCompare(b.code),
  );
}

/** Состав действующих регионов: архивный регион в предках места не участвует (П10). */
export function activeMembers(regions: readonly RegionSummary[]): readonly RegionMembers[] {
  return regions.filter((region) => region.archivedAt === null);
}

function loadCountries(): Promise<Omit<CountrySummary, 'regions'>[]> {
  return db
    .select({
      code: geoCountries.code,
      iso3: geoCountries.iso3,
      continent: geoCountries.continent,
      nameRu: geoCountries.nameRu,
      nameEn: geoCountries.nameEn,
      population: geoCountries.population,
      cities:
        sql<number>`(select count(*) from ${geoCities} where ${geoCities.countryCode} = ${geoCountries.code} and ${geoCities.archivedAt} is null)`.mapWith(
          Number,
        ),
    })
    .from(geoCountries)
    .orderBy(asc(geoCountries.nameRu));
}

export async function getOverview(): Promise<Error | GeoOverview> {
  return attempt('Loading geo overview', async () => {
    const [totals, regions, countries] = await Promise.all([
      loadTotals(),
      loadRegions(),
      loadCountries(),
    ]);
    function regionsOf(code: string): readonly string[] {
      return regions
        .filter((region) => region.countries.some((country) => country === code))
        .map((region) => region.code);
    }
    return {
      totals,
      regions,
      countries: countries.map((country): CountrySummary =>
        Object.assign(country, { regions: regionsOf(country.code) }),
      ),
    };
  });
}

export async function getRegion(code: string): Promise<Error | RegionDetails | null> {
  return attempt(`Loading region ${code}`, async () => {
    const allRegions = await loadRegions();
    const region = allRegions.find((item) => item.code === code);
    if (region === undefined) return null;
    const [countries, aliases] = await Promise.all([
      db
        .select({
          code: geoCountries.code,
          nameRu: geoCountries.nameRu,
          nameEn: geoCountries.nameEn,
          population: geoCountries.population,
        })
        .from(geoRegionCountries)
        .innerJoin(geoCountries, eq(geoCountries.code, geoRegionCountries.countryCode))
        .where(eq(geoRegionCountries.regionCode, code))
        .orderBy(asc(geoCountries.nameRu)),
      db
        .select(ALIAS_COLUMNS)
        .from(geoAliases)
        .where(eq(geoAliases.regionCode, code))
        .orderBy(...ALIAS_ORDER),
    ]);
    return { region, countries, aliases, allRegions };
  });
}
