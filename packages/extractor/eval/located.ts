import { placeKey } from '@job-market/geo';
import type { LocatedPlaces } from '@job-market/geo/server';

import { isLeaf } from '../src/index.ts';
import type { ExtractedRole, OccupationNode } from '../src/index.ts';

/** Ключ места справочника; нераспознанное место в сравнение не входит (П20). */
export function locatedKey(place: LocatedPlaces['places'][number]): string | null {
  if (place.regionCode !== null && place.regionCode !== undefined) {
    return placeKey({ kind: 'region', code: place.regionCode });
  }
  if (place.cityId !== null && place.cityId !== undefined) {
    return placeKey({ kind: 'city', id: place.cityId });
  }
  if (place.countryCode !== null && place.countryCode !== undefined) {
    return `country:${place.countryCode}`;
  }
  return null;
}

const share = (part: number, whole: number): number => (whole === 0 ? 0 : part / whole);

/** Доля вакансий на внутренних узлах дерева и доля нераспознанных мест прогона. */
export function coverage(
  roles: readonly ExtractedRole[],
  located: readonly LocatedPlaces[],
  tree: readonly OccupationNode[],
): { readonly innerNodes: number; readonly unresolvedPlaces: number } {
  const places = located.flatMap((role) => role.places);
  return {
    innerNodes: share(
      roles.filter((role) => !isLeaf(tree, role.occupationId)).length,
      roles.length,
    ),
    unresolvedPlaces: share(
      places.filter((place) => place.resolution === 'not_found' || place.resolution === 'ambiguous')
        .length,
      places.length,
    ),
  };
}
