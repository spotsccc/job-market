/** Строки трёх дампов GeoNames, уже распакованные. Источник открывает вызывающий. */
export type GeonamesSources = {
  readonly countryInfo: AsyncIterable<string>;
  readonly cities: AsyncIterable<string>;
  readonly alternateNames: AsyncIterable<string>;
};

export type CountryRecord = {
  readonly code: string;
  readonly iso3: string;
  readonly geonameId: number;
  readonly continent: string;
  readonly nameEn: string;
  readonly nameRu: string;
  readonly population: number;
};

export type CityRecord = {
  readonly id: number;
  readonly countryCode: string;
  readonly admin1Code: string | null;
  readonly name: string;
  readonly nameEn: string | null;
  readonly nameRu: string | null;
  readonly lat: number;
  readonly lng: number;
  readonly population: number;
  readonly timezone: string;
};

/** Название места; ровно одно из `countryCode` и `cityId` задано. */
export type AliasRecord = {
  readonly normalized: string;
  readonly alias: string;
  readonly lang: string | null;
  readonly countryCode: string | null;
  readonly cityId: number | null;
};

export type GeonamesData = {
  readonly countries: readonly CountryRecord[];
  readonly cities: readonly CityRecord[];
  readonly aliases: readonly AliasRecord[];
  /** Сколько строк cities15000 отброшено по П2 или из-за страны не из справочника. */
  readonly droppedCities: number;
};
