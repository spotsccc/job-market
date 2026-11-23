/**
 * Гео-справочник: страны, регионы найма и города. Здесь — часть без базы: ключи мест,
 * предки, показ и нормализация названий. Разбор и поиск по базе — в `@job-market/geo/server`.
 */
export { InvalidPlaceKeyError } from './errors/index.ts';
export { formatPlace } from './format.ts';
export type { CityNames, Locale } from './format.ts';
export { COUNTRY_CODES, isCountryCode } from './generated/countries.ts';
export type { CountryCode } from './generated/countries.ts';
export { ancestors, covers, regionsOf } from './hierarchy.ts';
export type { RegionMembers } from './hierarchy.ts';
export { normalizeName } from './normalize.ts';
export { isAnywhere, parsePlaceKey, placeKey } from './place.ts';
export type { Place, PlaceKey, PlaceRef, RegionCode } from './place.ts';
export { REGIONS } from './regions.ts';
export type { Region } from './regions.ts';
