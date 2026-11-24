import type { PlaceToSave } from '@job-market/db';
import type { LOCATION_ROLES } from '@job-market/db/values';

import type { GeoQueryError } from './errors/index.ts';
import { resolvePlaces } from './resolve.ts';
import type { GeoDb, ResolvedPlace } from './resolve.ts';

/** Место вакансии словами текста, как его вернул экстрактор. */
export type PlaceWords = {
  readonly role: (typeof LOCATION_ROLES)[number];
  readonly city: string | null;
  readonly country: string | null;
  readonly region: string | null;
  readonly raw: string;
};

/** Места роли после справочника: строки `vacancy_locations` и поля вакансии из них. */
export type LocatedPlaces = {
  readonly places: readonly PlaceToSave[];
  /** Среди мест найма есть «откуда угодно». */
  readonly isRemoteFromAnywhere: boolean;
  /**
   * `raw` мест по порядку, включая «откуда угодно»: по ним ищет `/vacancies` (П17,
   * packages/db/src/publication/README.md).
   */
  readonly locations: readonly string[];
};

/** Что стало с одним местом: строка, «откуда угодно» или ничего — офис «откуда угодно». */
type Outcome =
  | { readonly kind: 'row'; readonly row: PlaceToSave }
  | { readonly kind: 'anywhere' }
  | { readonly kind: 'dropped' };

function outcome(place: PlaceWords, resolved: ResolvedPlace): Outcome {
  const { role, raw } = place;
  if (resolved.status === 'unresolved') {
    return { kind: 'row', row: { role, raw, resolution: resolved.reason } };
  }
  const found = resolved.place;
  if (found.kind === 'anywhere')
    return role === 'hiring' ? { kind: 'anywhere' } : { kind: 'dropped' };
  if (found.kind === 'region') {
    // partial в базе бывает только у страны: регион по менее точному полю — resolved
    // (П16, packages/extractor/README.md).
    return { kind: 'row', row: { role, raw, resolution: 'resolved', regionCode: found.code } };
  }
  if (found.kind === 'country') {
    return {
      kind: 'row',
      row: { role, raw, resolution: resolved.status, countryCode: found.code },
    };
  }
  return {
    kind: 'row',
    row: { role, raw, resolution: 'resolved', cityId: found.id, countryCode: found.countryCode },
  };
}

function locateRole(
  places: readonly PlaceWords[],
  resolved: readonly ResolvedPlace[],
): LocatedPlaces {
  const rows: PlaceToSave[] = [];
  const locations: string[] = [];
  let isRemoteFromAnywhere = false;
  for (const [index, place] of places.entries()) {
    const result = resolved[index];
    if (result === undefined) continue;
    const located = outcome(place, result);
    if (located.kind === 'dropped') continue;
    locations.push(place.raw);
    if (located.kind === 'anywhere') isRemoteFromAnywhere = true;
    else rows.push(located.row);
  }
  return { places: rows, isRemoteFromAnywhere, locations };
}

/**
 * Сводит места всех ролей пачки к справочнику одним вызовом `resolvePlaces` (П16,
 * packages/extractor/README.md). Ответ — по роли в том же порядке: строки мест, «откуда
 * угодно» и `locations`. Нераспознанное место — не ошибка, а строка с `not_found` или
 * `ambiguous`; `GeoQueryError` — только сбой базы.
 */
export async function locateVacancies(
  db: GeoDb,
  roles: readonly { readonly places: readonly PlaceWords[] }[],
): Promise<readonly LocatedPlaces[] | GeoQueryError> {
  const inputs = roles.flatMap((role) =>
    role.places.map((place) => ({
      city: place.city,
      country: place.country,
      region: place.region,
    })),
  );
  const resolved = await resolvePlaces(db, inputs);
  if (resolved instanceof Error) return resolved;
  let offset = 0;
  return roles.map((role) => {
    const slice = resolved.slice(offset, offset + role.places.length);
    offset += role.places.length;
    return locateRole(role.places, slice);
  });
}
