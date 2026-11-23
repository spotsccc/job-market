import type { CountryCode } from './generated/countries.ts';

/** Ручное название страны или города; у регионов названия — в `regions.ts`. */
export type ManualAlias = {
  readonly alias: string;
  /** Язык, как у GeoNames: `ru`, `en`, `abbr`. */
  readonly lang: string;
} & ({ readonly countryCode: CountryCode } | { readonly cityId: number });

/**
 * Названия, которых нет в GeoNames, а в вакансиях они встречаются. «UK», «USA», «NYC» и
 * «СПб» в GeoNames уже есть (проверено 23 ноября 2026), поэтому их здесь нет. Город —
 * по id GeoNames; несуществующий id остановит миграцию на внешнем ключе.
 */
export const MANUAL_ALIASES: readonly ManualAlias[] = [
  { alias: 'England', lang: 'en', countryCode: 'GB' },
  { alias: 'Scotland', lang: 'en', countryCode: 'GB' },
  { alias: 'Wales', lang: 'en', countryCode: 'GB' },
  { alias: 'Англия', lang: 'ru', countryCode: 'GB' },
  { alias: 'Шотландия', lang: 'ru', countryCode: 'GB' },
  { alias: 'Уэльс', lang: 'ru', countryCode: 'GB' },
  { alias: 'РФ', lang: 'abbr', countryCode: 'RU' },
  { alias: 'KSA', lang: 'abbr', countryCode: 'SA' },
  { alias: 'Штаты', lang: 'ru', countryCode: 'US' },
  { alias: 'SPb', lang: 'abbr', cityId: 498_817 },
  { alias: 'Мск', lang: 'abbr', cityId: 524_901 },
  { alias: 'Екб', lang: 'abbr', cityId: 1_486_209 },
  { alias: 'Нск', lang: 'abbr', cityId: 1_496_747 },
];
