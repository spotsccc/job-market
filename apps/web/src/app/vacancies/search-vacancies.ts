import {
  and,
  asc,
  authors,
  db,
  desc,
  eq,
  geoCities,
  inArray,
  listOccupations,
  platforms,
  publications,
  sources,
  sql,
  vacancies,
  vacancyLocations,
} from '@job-market/db';
import type { SQL, VacancyApply, VacancyLanguage } from '@job-market/db';
import type { EmploymentType, RESOLUTIONS, Seniority, Workplace } from '@job-market/db/values';
import { formatPlace, isCountryCode } from '@job-market/geo';
import type { Place } from '@job-market/geo';

import { filterConditions, placeCondition } from './conditions.ts';
import type { HiringParty, SalaryPeriod, VacancyFilters } from './filters.ts';
import { buildOccupationTree } from './occupation-tree.ts';

type Resolution = (typeof RESOLUTIONS)[number];

/** Сколько вакансий на странице. */
export const PAGE_SIZE = 20;

/** Место вакансии для карточки: название по справочнику или как в тексте. */
export type VacancyPlace = {
  readonly role: 'office' | 'hiring';
  readonly resolution: Resolution;
  readonly label: string;
  /** Как место написано в тексте. */
  readonly raw: string;
};

/** Вакансия для страницы: поля вакансии, её места и публикация, из которой она извлечена. */
export type VacancySearchItem = {
  readonly id: string;
  readonly title: string;
  readonly company: string | null;
  readonly companyUrl: string | null;
  readonly hiringParty: HiringParty;
  /** Путь профессии: «IT › Разработка › Frontend»; `null` — профессии нет. */
  readonly occupation: string | null;
  readonly suggestedOccupation: string | null;
  readonly seniority: Seniority | null;
  readonly experienceYearsMin: number | null;
  readonly workplace: Workplace | null;
  readonly isRemoteFromAnywhere: boolean;
  /** Места словами текста; показываются, если мест справочника нет. */
  readonly locations: readonly string[];
  readonly places: readonly VacancyPlace[];
  readonly employmentTypes: readonly EmploymentType[];
  readonly salaryMin: number | null;
  readonly salaryMax: number | null;
  readonly salaryCurrency: string | null;
  readonly salaryPeriod: SalaryPeriod | null;
  readonly salaryRaw: string | null;
  readonly salaryGross: boolean | null;
  readonly equity: boolean | null;
  readonly skills: readonly string[];
  readonly niceSkills: readonly string[];
  readonly languages: readonly VacancyLanguage[];
  readonly relocation: boolean | null;
  readonly visaSponsorship: boolean | null;
  readonly apply: VacancyApply;
  readonly summary: string;
  readonly responsibilities: readonly string[];
  readonly requirements: readonly string[];
  readonly benefits: readonly string[];
  readonly publicationUrl: string;
  /** Дата публикации строкой ISO. */
  readonly postedAt: string;
  readonly authorName: string | null;
  readonly authorUrl: string | null;
  readonly sourceName: string;
  readonly platformName: string;
};

export type VacancySearchResult = {
  readonly items: readonly VacancySearchItem[];
  /** Сколько вакансий подходит под фильтры всего, не только на странице. */
  readonly total: number;
};

/** Столбцы вакансии с публикацией, источником и автором: общие у выдачи и страницы вакансии. */
export const VACANCY_COLUMNS = {
  id: vacancies.id,
  title: vacancies.title,
  company: vacancies.company,
  companyUrl: vacancies.companyUrl,
  hiringParty: vacancies.hiringParty,
  occupationId: vacancies.occupationId,
  suggestedOccupation: vacancies.suggestedOccupation,
  seniority: vacancies.seniority,
  experienceYearsMin: vacancies.experienceYearsMin,
  workplace: vacancies.workplace,
  isRemoteFromAnywhere: vacancies.isRemoteFromAnywhere,
  locations: vacancies.locations,
  employmentTypes: vacancies.employmentTypes,
  salaryMin: vacancies.salaryMin,
  salaryMax: vacancies.salaryMax,
  salaryCurrency: vacancies.salaryCurrency,
  salaryPeriod: vacancies.salaryPeriod,
  salaryRaw: vacancies.salaryRaw,
  salaryGross: vacancies.salaryGross,
  equity: vacancies.equity,
  skills: vacancies.skills,
  niceSkills: vacancies.niceSkills,
  languages: vacancies.languages,
  relocation: vacancies.relocation,
  visaSponsorship: vacancies.visaSponsorship,
  apply: vacancies.apply,
  summary: vacancies.summary,
  responsibilities: vacancies.responsibilities,
  requirements: vacancies.requirements,
  benefits: vacancies.benefits,
  publicationUrl: publications.url,
  // Строкой ISO прямо из базы: на страницу дата уходит строкой.
  postedAt: sql<string>`to_json(${publications.postedAt}) #>> '{}'`,
  authorName: authors.name,
  authorUrl: authors.url,
  sourceName: sources.name,
  platformName: platforms.name,
};

/**
 * Место фильтра с полными данными: у города из ключа только id, его страну читаем из
 * справочника. Города нет — `null`, и фильтр по месту ничего не находит.
 */
async function resolveFilterPlace(
  place: VacancyFilters['place'],
): Promise<Exclude<Place, { kind: 'anywhere' }> | null | undefined> {
  if (place === null || place.kind === 'anywhere') return undefined;
  if (place.kind !== 'city') return place;
  const [city] = await db
    .select({ countryCode: geoCities.countryCode })
    .from(geoCities)
    .where(eq(geoCities.id, place.id));
  if (city === undefined || !isCountryCode(city.countryCode)) return null;
  return { kind: 'city', id: place.id, countryCode: city.countryCode };
}

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

async function runSearch(filters: VacancyFilters, limit: number): Promise<VacancySearchResult> {
  const [occupationList, place] = await Promise.all([
    listOccupations(db),
    resolveFilterPlace(filters.place),
  ]);
  const tree = buildOccupationTree(occupationList);
  const occupationIds = tree.expand(filters.occupations);
  const tsQuery: SQL | null =
    filters.q === '' ? null : sql`websearch_to_tsquery('russian', ${filters.q})`;

  const rows = await db
    .select({ ...VACANCY_COLUMNS, total: sql<number>`count(*) over ()`.mapWith(Number) })
    .from(vacancies)
    .innerJoin(publications, eq(vacancies.publicationId, publications.id))
    .innerJoin(sources, eq(publications.sourceId, sources.id))
    .innerJoin(platforms, eq(sources.platform, platforms.id))
    .leftJoin(authors, eq(publications.authorId, authors.id))
    .where(
      and(
        // Все id профессий неизвестны — фильтр отброшен, как прочие неизвестные значения.
        filterConditions(filters, occupationIds.length === 0 ? null : occupationIds, tsQuery),
        place === undefined
          ? undefined
          : place === null
            ? sql`false`
            : placeCondition(place, filters.placeMode),
      ),
    )
    .orderBy(
      ...(tsQuery === null ? [] : [desc(sql`ts_rank(${vacancies.searchVector}, ${tsQuery})`)]),
      desc(publications.postedAt),
      asc(vacancies.position),
    )
    .limit(limit)
    .offset((filters.page - 1) * limit);

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- строки drizzle с изменяемыми массивами
  const places = await loadPlaces(rows.map(({ id }) => id));
  return {
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- строки drizzle с изменяемыми массивами
    items: rows.map(({ total: _total, occupationId, ...row }) => ({
      ...row,
      occupation: occupationId === null ? null : tree.path(occupationId),
      places: places.get(row.id) ?? [],
    })),
    total: rows[0]?.total ?? 0,
  };
}

/**
 * Вакансии под фильтры, страница `filters.page`. Есть запрос — сначала релевантные
 * (`websearch_to_tsquery` понимает `"фразу"`, `-исключение` и `or` и не падает на
 * произвольном вводе), при равной релевантности и без запроса — свежие публикации первыми.
 */
export async function searchVacancies(
  filters: VacancyFilters,
  limit: number = PAGE_SIZE,
): Promise<Error | VacancySearchResult> {
  // `async`-обёртка: `db` бросает синхронно, если не задан DATABASE_URL, — `.catch` ниже ловит и это.
  return (async () => runSearch(filters, limit))().catch(
    (cause: unknown) => new Error('Searching vacancies failed', { cause }),
  );
}
