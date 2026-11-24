import { REGIONS, ancestors } from '@job-market/geo';
import type { CountryCode, Place, RegionCode } from '@job-market/geo';

/**
 * Какие места вакансии подходят под место фильтра. Ключи — в терминах столбцов
 * `vacancy_locations`, чтобы запрос собирался из простых `IN`.
 */
export type PlaceMatch = {
  /** Место вакансии внутри выбранного: тот же город, страна или регион, или их часть. */
  readonly inside: {
    readonly cityId: number | null;
    readonly countryCodes: readonly CountryCode[];
    readonly regionCodes: readonly RegionCode[];
  };
  /**
   * Места найма, которые покрывают выбранное, кроме «откуда угодно»: страна города и
   * регионы, куда выбранное входит целиком (П13).
   */
  readonly covering: {
    /** Страна целиком, без города: только для города. */
    readonly countryCode: CountryCode | null;
    readonly regionCodes: readonly RegionCode[];
  };
};

/** Регионы, которые целиком лежат внутри `code`, включая его самого. */
function regionsInside(code: RegionCode): RegionCode[] {
  return REGIONS.filter(
    (region) =>
      region.code === code ||
      ancestors({ kind: 'region', code: region.code }).some(
        (outer) => outer.kind === 'region' && outer.code === code,
      ),
  ).map((region) => region.code);
}

function coveringRegions(place: Place): RegionCode[] {
  return ancestors(place).flatMap((outer) => (outer.kind === 'region' ? [outer.code] : []));
}

/** Город фильтра несёт страну: её читает запрос, ключ места хранит только id. */
export function placeMatch(place: Exclude<Place, { kind: 'anywhere' }>): PlaceMatch {
  if (place.kind === 'city') {
    return {
      inside: { cityId: place.id, countryCodes: [], regionCodes: [] },
      covering: { countryCode: place.countryCode, regionCodes: coveringRegions(place) },
    };
  }
  if (place.kind === 'country') {
    return {
      inside: { cityId: null, countryCodes: [place.code], regionCodes: [] },
      covering: { countryCode: null, regionCodes: coveringRegions(place) },
    };
  }
  const region = REGIONS.find((item) => item.code === place.code);
  return {
    inside: {
      cityId: null,
      countryCodes: region?.countries ?? [],
      regionCodes: regionsInside(place.code),
    },
    covering: { countryCode: null, regionCodes: coveringRegions(place) },
  };
}
