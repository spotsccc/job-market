import { InvalidPlaceKeyError } from './errors/index.ts';
import { isCountryCode } from './generated/countries.ts';
import type { CountryCode } from './generated/countries.ts';
import { normalizeName } from './normalize.ts';

/**
 * Код региона найма: строчные латинские буквы и `_`, как в `geo_regions.code`. Это
 * строка, а не объединение кодов из `regions.ts`: в сохранённых данных может остаться
 * код региона, который уже убран и архивирован.
 */
export type RegionCode = string;

/**
 * Место — город, страна, регион найма или «откуда угодно». Город несёт свою страну:
 * предков города (П13) можно получить без запроса в базу.
 */
export type Place =
  | { readonly kind: 'city'; readonly id: number; readonly countryCode: CountryCode }
  | { readonly kind: 'country'; readonly code: CountryCode }
  | { readonly kind: 'region'; readonly code: RegionCode }
  | { readonly kind: 'anywhere' };

/**
 * Место, как его задаёт ключ: у города только id. Любой `Place` годится как `PlaceRef`.
 */
export type PlaceRef =
  | { readonly kind: 'city'; readonly id: number }
  | { readonly kind: 'country'; readonly code: CountryCode }
  | { readonly kind: 'region'; readonly code: RegionCode }
  | { readonly kind: 'anywhere' };

/** Ключ места в данных: `city:2950159`, `country:DE`, `region:eu`, `anywhere`. */
export type PlaceKey =
  | `city:${number}`
  | `country:${CountryCode}`
  | `region:${string}`
  | 'anywhere';

const REGION_CODE = /^[a-z][a-z_]*$/u;
const CITY_ID = /^[1-9]\d*$/u;

/** Ключ места: по нему место хранится в данных и сравнивается. */
export function placeKey(place: PlaceRef): PlaceKey {
  if (place.kind === 'city') {
    return `city:${place.id}`;
  }
  if (place.kind === 'country') {
    return `country:${place.code}`;
  }
  if (place.kind === 'region') {
    return `region:${place.code}`;
  }
  return 'anywhere';
}

/**
 * Разбирает ключ места. Код страны должен быть в справочнике; код региона проверяется
 * только по форме: архивный регион в данных — не ошибка.
 */
export function parsePlaceKey(key: string): InvalidPlaceKeyError | PlaceRef {
  if (key === 'anywhere') return { kind: 'anywhere' };
  const separator = key.indexOf(':');
  const kind = key.slice(0, separator);
  const value = key.slice(separator + 1);
  if (separator > 0) {
    if (kind === 'city' && CITY_ID.test(value)) {
      const id = Number(value);
      if (Number.isSafeInteger(id)) return { kind: 'city', id };
    }
    if (kind === 'country' && isCountryCode(value)) return { kind: 'country', code: value };
    if (kind === 'region' && REGION_CODE.test(value)) return { kind: 'region', code: value };
  }
  return new InvalidPlaceKeyError({ key });
}

/** Написания «откуда угодно» после `normalizeName` (П10). */
const ANYWHERE_NAMES: ReadonlySet<string> = new Set(
  ['worldwide', 'anywhere', 'весь мир', 'откуда угодно'].map((name) => normalizeName(name)),
);

/** Текст означает «откуда угодно»: «Worldwide», «весь мир» (П10). */
export function isAnywhere(text: string): boolean {
  return ANYWHERE_NAMES.has(normalizeName(text));
}
