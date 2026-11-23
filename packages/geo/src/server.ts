/**
 * Разбор и поиск мест по базе. Отдельно от `@job-market/geo`, потому что тянет
 * `@job-market/db` и `pg`: чистая часть пакета годится и для клиентского кода.
 */
export { GeoQueryError } from './errors/index.ts';
export { resolvePlaces } from './resolve.ts';
export type { GeoDb, PlaceField, PlaceInput, ResolvedPlace, UnresolvedReason } from './resolve.ts';
export { searchPlaces } from './search.ts';
export type { PlaceSuggestion, SearchOptions } from './search.ts';
