import type { CountryCode } from './generated/countries.ts';
import { placeKey } from './place.ts';
import type { Place, PlaceRef, RegionCode } from './place.ts';
import { REGIONS } from './regions.ts';
import type { Region } from './regions.ts';

/** Из региона иерархии нужен только состав. */
export type RegionMembers = Pick<Region, 'code' | 'countries'>;

const ANYWHERE: Place = { kind: 'anywhere' };

/**
 * Регионы, в которые входит страна, от узких к широким: по числу стран, при равенстве — по
 * коду. Так «dach» идёт раньше «eu», а «eu» — раньше «europe».
 */
export function regionsOf(
  country: CountryCode,
  regions: readonly RegionMembers[] = REGIONS,
): readonly RegionCode[] {
  return narrowestFirst(regions.filter((region) => region.countries.includes(country)));
}

/**
 * Предки места (П13): город → его страна → регионы страны → anywhere; страна → её
 * регионы → anywhere; регион → регионы, которые его покрывают (П5) → anywhere. Регион,
 * которого нет в `regions`, покрыт только anywhere.
 */
export function ancestors(
  place: Place,
  regions: readonly RegionMembers[] = REGIONS,
): readonly Place[] {
  if (place.kind === 'city') {
    return [
      { kind: 'country', code: place.countryCode },
      ...asPlaces(regionsOf(place.countryCode, regions)),
      ANYWHERE,
    ];
  }
  if (place.kind === 'country') {
    return [...asPlaces(regionsOf(place.code, regions)), ANYWHERE];
  }
  if (place.kind === 'region') {
    const inner = regions.find((region) => region.code === place.code);
    if (inner === undefined) return [ANYWHERE];
    const outer = regions.filter(
      (region) => region.code !== inner.code && includesAll(region, inner),
    );
    return [...asPlaces(narrowestFirst(outer)), ANYWHERE];
  }
  return [];
}

/** `outer` покрывает `inner`: это то же место или один из предков `inner` (П13). */
export function covers(
  outer: PlaceRef,
  inner: Place,
  regions: readonly RegionMembers[] = REGIONS,
): boolean {
  const key = placeKey(outer);
  return (
    key === placeKey(inner) || ancestors(inner, regions).some((place) => placeKey(place) === key)
  );
}

/** Все страны `inner` входят в `outer` (П5). */
function includesAll(outer: RegionMembers, inner: RegionMembers): boolean {
  return inner.countries.every((country) => outer.countries.includes(country));
}

function narrowestFirst(regions: readonly RegionMembers[]): RegionCode[] {
  return regions
    .toSorted((a, b) => a.countries.length - b.countries.length || a.code.localeCompare(b.code))
    .map((region) => region.code);
}

function asPlaces(codes: readonly RegionCode[]): Place[] {
  return codes.map((code) => ({ kind: 'region', code }));
}
