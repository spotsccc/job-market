import { asc, db, eq, geoCities, inArray, vacancyLocations } from '@job-market/db';
import type { RESOLUTIONS } from '@job-market/db/values';
import { formatPlace, isCountryCode } from '@job-market/geo';

type Resolution = (typeof RESOLUTIONS)[number];

/** Место вакансии для карточки: название по справочнику или как в тексте. */
export type VacancyPlace = {
  readonly role: 'office' | 'hiring';
  readonly resolution: Resolution;
  readonly label: string;
  /** Как место написано в тексте. */
  readonly raw: string;
};

/** Места вакансий страницы с названиями городов, по порядку. */
export async function loadPlaces(ids: readonly string[]): Promise<Map<string, VacancyPlace[]>> {
  const rows =
    ids.length === 0
      ? []
      : await db
          .select({
            vacancyId: vacancyLocations.vacancyId,
            role: vacancyLocations.role,
            resolution: vacancyLocations.resolution,
            regionCode: vacancyLocations.regionCode,
            countryCode: vacancyLocations.countryCode,
            cityId: vacancyLocations.cityId,
            raw: vacancyLocations.raw,
            cityName: geoCities.name,
            cityNameRu: geoCities.nameRu,
            cityNameEn: geoCities.nameEn,
          })
          .from(vacancyLocations)
          .leftJoin(geoCities, eq(geoCities.id, vacancyLocations.cityId))
          .where(inArray(vacancyLocations.vacancyId, [...ids]))
          .orderBy(asc(vacancyLocations.vacancyId), asc(vacancyLocations.position));
  const places = new Map<string, VacancyPlace[]>();
  for (const row of rows) {
    const list = places.get(row.vacancyId) ?? [];
    list.push({
      role: row.role,
      resolution: row.resolution,
      label: placeLabel(row),
      raw: row.raw,
    });
    places.set(row.vacancyId, list);
  }
  return places;
}

function placeLabel(row: {
  readonly regionCode: string | null;
  readonly countryCode: string | null;
  readonly cityId: number | null;
  readonly raw: string;
  readonly cityName: string | null;
  readonly cityNameRu: string | null;
  readonly cityNameEn: string | null;
}): string {
  if (row.regionCode !== null) return formatPlace({ kind: 'region', code: row.regionCode }, 'ru');
  if (row.countryCode === null || !isCountryCode(row.countryCode)) return row.raw;
  if (row.cityId !== null && row.cityName !== null) {
    return formatPlace({ kind: 'city', id: row.cityId, countryCode: row.countryCode }, 'ru', {
      name: row.cityName,
      nameRu: row.cityNameRu,
      nameEn: row.cityNameEn,
    });
  }
  return formatPlace({ kind: 'country', code: row.countryCode }, 'ru');
}
