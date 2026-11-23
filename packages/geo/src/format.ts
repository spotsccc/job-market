import type { CountryCode } from './generated/countries.ts';
import type { Place } from './place.ts';
import { REGIONS } from './regions.ts';

export type Locale = 'ru' | 'en';

/** Названия города из `geo_cities`. */
export type CityNames = {
  /** Основное название по GeoNames: `München`. */
  readonly name: string;
  readonly nameRu: string | null;
  readonly nameEn: string | null;
};

/**
 * Названия стран — те же, что генератор пишет в `geo_countries`: `Intl.DisplayNames`
 * знает все коды справочника, поэтому название страны не требует запроса в базу.
 */
const COUNTRY_NAMES = {
  ru: new Intl.DisplayNames(['ru'], { type: 'region', fallback: 'none' }),
  en: new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' }),
};

const ANYWHERE = { ru: 'Откуда угодно', en: 'Anywhere' };

/**
 * Название места для показа (П15): город — «название, страна», где название — `nameRu`
 * (для en — `nameEn`), а если его нет — `name`; страна и регион — название на языке
 * `locale`. Без названий города показывается только его страна. Регион, которого нет в
 * `regions.ts`, показывается кодом.
 */
export function formatPlace(place: Place, locale: Locale, city?: CityNames): string {
  if (place.kind === 'city') {
    const country = countryName(place.countryCode, locale);
    if (city === undefined) return country;
    const name = (locale === 'ru' ? city.nameRu : city.nameEn) ?? city.name;
    return `${name}, ${country}`;
  }
  if (place.kind === 'country') {
    return countryName(place.code, locale);
  }
  if (place.kind === 'region') {
    const region = REGIONS.find((item) => item.code === place.code);
    if (region === undefined) return place.code;
    return locale === 'ru' ? region.nameRu : region.nameEn;
  }
  return ANYWHERE[locale];
}

function countryName(code: CountryCode, locale: Locale): string {
  return COUNTRY_NAMES[locale].of(code) ?? code;
}
