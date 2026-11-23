import { and, eq, geoAliases, geoCities, geoRegions, inArray, isNull } from '@job-market/db';
import type { Database } from '@job-market/db';

import { GeoQueryError } from './errors/index.ts';
import type { CityNames } from './format.ts';
import { isCountryCode } from './generated/countries.ts';
import type { CountryCode } from './generated/countries.ts';
import { normalizeName } from './normalize.ts';
import { isAnywhere } from './place.ts';
import type { Place, RegionCode } from './place.ts';

/** Клиент базы или транзакция: справочник только читается. */
export type GeoDb = Pick<Database, 'select' | 'selectDistinct'>;

/** Поле входа; места ищутся только среди своего вида (П10). */
export type PlaceField = 'city' | 'country' | 'region';

/** Место строками, как его написала модель или человек: «Питер», «UK», «EU». */
export type PlaceInput = Readonly<Partial<Record<PlaceField, string | null>>>;

export type UnresolvedReason = 'not_found' | 'ambiguous';

/**
 * Ответ на один вход (П11): `resolved` — место найдено по самому точному полю;
 * `partial` — более точное поле не распознано, место — по менее точному; `unresolved` —
 * не распознано ничего, причина — у самого точного поля. У города — его названия.
 */
export type ResolvedPlace =
  | { readonly status: 'resolved'; readonly place: Place; readonly city: CityNames | null }
  | {
      readonly status: 'partial';
      readonly place: Place;
      readonly city: CityNames | null;
      readonly unresolved: {
        readonly field: PlaceField;
        readonly text: string;
        readonly reason: UnresolvedReason;
      };
    }
  | { readonly status: 'unresolved'; readonly reason: UnresolvedReason };

/** Город берётся, только если он больше следующего кандидата хотя бы во столько раз (П11). */
const CITY_POPULATION_RATIO = 5;

/** От точного поля к общему. */
const FIELDS: readonly PlaceField[] = ['city', 'country', 'region'];

type City = CityNames & {
  readonly id: number;
  readonly countryCode: CountryCode;
  readonly population: number;
};

/** Места, на которые ведёт одно нормализованное название; каждое — один раз. */
type Candidates = {
  readonly cities: readonly City[];
  readonly countries: readonly CountryCode[];
  readonly regions: readonly RegionCode[];
};

/** Кандидаты по нормализованному названию; `undefined` — такого названия нет. */
type FindCandidates = (name: string) => Candidates | undefined;

type FieldResult =
  | { readonly place: Place; readonly city: CityNames | null }
  | { readonly reason: UnresolvedReason };

/** Результат непустого поля. */
type Outcome = { readonly field: PlaceField; readonly result: FieldResult };

type AliasRow = {
  readonly normalized: string;
  readonly countryCode: string | null;
  readonly regionCode: string | null;
  readonly cityId: number | null;
  readonly cityCountryCode: string | null;
  readonly population: number | null;
  readonly name: string | null;
  readonly nameRu: string | null;
  readonly nameEn: string | null;
};

/**
 * Разбирает места пачкой (П10–П12): один запрос в `geo_aliases` на все входы, ответ на
 * каждый вход в том же порядке. Ненайденное место — не ошибка; `GeoQueryError` — только
 * сбой базы. Пустая пачка и входы только из «откуда угодно» в базу не ходят.
 */
export async function resolvePlaces(
  db: GeoDb,
  inputs: readonly PlaceInput[],
): Promise<readonly ResolvedPlace[] | GeoQueryError> {
  const names = new Set(
    inputs.flatMap((input) =>
      FIELDS.map((field) => input[field] ?? '')
        .filter((text) => !isAnywhere(text))
        .map((text) => normalizeName(text))
        .filter((name) => name !== ''),
    ),
  );
  const find = names.size === 0 ? (): undefined => undefined : await lookup(db, [...names]);
  if (find instanceof Error) return find;
  return inputs.map((input) => resolveOne(input, find));
}

async function lookup(
  db: GeoDb,
  names: readonly string[],
): Promise<FindCandidates | GeoQueryError> {
  const rows = await db
    .select({
      normalized: geoAliases.normalized,
      countryCode: geoAliases.countryCode,
      regionCode: geoAliases.regionCode,
      cityId: geoAliases.cityId,
      cityCountryCode: geoCities.countryCode,
      population: geoCities.population,
      name: geoCities.name,
      nameRu: geoCities.nameRu,
      nameEn: geoCities.nameEn,
    })
    .from(geoAliases)
    .leftJoin(geoCities, eq(geoCities.id, geoAliases.cityId))
    .leftJoin(geoRegions, eq(geoRegions.code, geoAliases.regionCode))
    // Архивные города и регионы не участвуют; у названий страны оба столбца — NULL.
    .where(
      and(
        inArray(geoAliases.normalized, names),
        isNull(geoCities.archivedAt),
        isNull(geoRegions.archivedAt),
      ),
    )
    .catch((cause: unknown) => new GeoQueryError({ cause }));
  if (rows instanceof Error) return rows;
  return groupByName(rows);
}

/** Один город приходит несколькими названиями и источниками: кандидаты — по месту. */
function groupByName(rows: readonly AliasRow[]): FindCandidates {
  const groups = new Map<
    string,
    { cities: Map<number, City>; countries: Set<CountryCode>; regions: Set<RegionCode> }
  >();
  for (const row of rows) {
    let group = groups.get(row.normalized);
    if (group === undefined) {
      group = { cities: new Map(), countries: new Set(), regions: new Set() };
      groups.set(row.normalized, group);
    }
    if (row.countryCode !== null && isCountryCode(row.countryCode)) {
      group.countries.add(row.countryCode);
    }
    if (row.regionCode !== null) group.regions.add(row.regionCode);
    const city = cityOf(row);
    if (city !== undefined) group.cities.set(city.id, city);
  }
  return (name) => {
    const group = groups.get(name);
    return group === undefined
      ? group
      : {
          cities: [...group.cities.values()],
          countries: [...group.countries],
          regions: [...group.regions],
        };
  };
}

function cityOf(row: AliasRow): City | undefined {
  if (
    row.cityId === null ||
    row.cityCountryCode === null ||
    !isCountryCode(row.cityCountryCode) ||
    row.population === null ||
    row.name === null
  ) {
    return undefined;
  }
  return {
    id: row.cityId,
    countryCode: row.cityCountryCode,
    population: row.population,
    name: row.name,
    nameRu: row.nameRu,
    nameEn: row.nameEn,
  };
}

function resolveOne(input: PlaceInput, find: FindCandidates): ResolvedPlace {
  const country = fieldResult(input.country, find, (found) =>
    pickOne(found.countries.map((code) => ({ kind: 'country', code }))),
  );
  const countryCode =
    country !== undefined && 'place' in country && country.place.kind === 'country'
      ? country.place.code
      : undefined;
  const city = fieldResult(input.city, find, (found) => pickCity(found.cities, countryCode));
  const region = fieldResult(input.region, find, (found) =>
    pickOne(found.regions.map((code) => ({ kind: 'region', code }))),
  );
  return combine(input, [
    ...outcome('city', city),
    ...outcome('country', country),
    ...outcome('region', region),
  ]);
}

function outcome(field: PlaceField, result: FieldResult | undefined): Outcome[] {
  return result === undefined ? [] : [{ field, result }];
}

/**
 * Ответ по непустым полям от точного к общему: место — по первому распознанному полю.
 * Всё, что раньше него, не распознано; тогда ответ — partial с самым точным из них.
 */
function combine(input: PlaceInput, outcomes: readonly Outcome[]): ResolvedPlace {
  const bestIndex = outcomes.findIndex(({ result }) => 'place' in result);
  const best = outcomes[bestIndex]?.result;
  const failed = outcomes[0];
  if (best === undefined || !('place' in best)) {
    const reason =
      failed !== undefined && 'reason' in failed.result ? failed.result.reason : 'not_found';
    return { status: 'unresolved', reason };
  }
  if (bestIndex > 0 && failed !== undefined && 'reason' in failed.result) {
    return {
      status: 'partial',
      place: best.place,
      city: best.city,
      unresolved: {
        field: failed.field,
        text: input[failed.field] ?? '',
        reason: failed.result.reason,
      },
    };
  }
  return { status: 'resolved', place: best.place, city: best.city };
}

/** Результат одного поля; `undefined` — поле пустое. */
function fieldResult(
  text: string | null | undefined,
  find: FindCandidates,
  pick: (found: Candidates) => FieldResult,
): FieldResult | undefined {
  if (text === null || text === undefined) return undefined;
  if (isAnywhere(text)) return { place: { kind: 'anywhere' }, city: null };
  const name = normalizeName(text);
  if (name === '') return undefined;
  const found = find(name);
  if (found === undefined) return { reason: 'not_found' };
  return pick(found);
}

/** Страна или регион: ровно один кандидат, иначе — неоднозначно. */
function pickOne(places: readonly Place[]): FieldResult {
  const [first, ...rest] = places;
  if (first === undefined) return { reason: 'not_found' };
  if (rest.length > 0) return { reason: 'ambiguous' };
  return { place: first, city: null };
}

/**
 * Город (П11): если страна во входе распознана — только среди её городов; самый
 * населённый берётся, если он больше следующего хотя бы в `CITY_POPULATION_RATIO` раз.
 */
function pickCity(cities: readonly City[], countryCode: CountryCode | undefined): FieldResult {
  const [first, second] = cities
    .filter((city) => countryCode === undefined || city.countryCode === countryCode)
    .toSorted((a, b) => b.population - a.population);
  if (first === undefined) return { reason: 'not_found' };
  if (second !== undefined && first.population < second.population * CITY_POPULATION_RATIO) {
    return { reason: 'ambiguous' };
  }
  return {
    place: { kind: 'city', id: first.id, countryCode: first.countryCode },
    city: { name: first.name, nameRu: first.nameRu, nameEn: first.nameEn },
  };
}
