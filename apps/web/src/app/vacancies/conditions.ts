import {
  and,
  arrayOverlaps,
  db,
  eq,
  exists,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  notExists,
  or,
  publications,
  sources,
  sql,
  vacancies,
  vacancyLocations,
} from '@job-market/db';
import type { SQL } from '@job-market/db';
import type { Place } from '@job-market/geo';

import type { ApplyMethod, PlaceMode, VacancyFilters } from './filters.ts';
import { placeMatch } from './place-match.ts';

/** `SQL` из drizzle: тип условия `where`. */
type Condition = SQL | undefined;

const location = vacancyLocations;

/** Места вакансии из подзапроса: строки `vacancy_locations` этой вакансии под условием. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- SQL drizzle — класс, readonly его не сделать
function hasLocation(condition: Condition): SQL {
  return exists(
    db
      .select({ one: sql`1` })
      .from(location)
      .where(and(eq(location.vacancyId, vacancies.id), condition)),
  );
}

function placeConditions(place: Exclude<Place, { kind: 'anywhere' }>): {
  inside: Condition;
  covering: Condition;
} {
  const match = placeMatch(place);
  const inside = or(
    match.inside.cityId === null ? undefined : eq(location.cityId, match.inside.cityId),
    match.inside.countryCodes.length === 0
      ? undefined
      : inArray(location.countryCode, [...match.inside.countryCodes]),
    match.inside.regionCodes.length === 0
      ? undefined
      : inArray(location.regionCode, [...match.inside.regionCodes]),
  );
  const covering = or(
    match.covering.countryCode === null
      ? undefined
      : and(eq(location.countryCode, match.covering.countryCode), isNull(location.cityId)),
    match.covering.regionCodes.length === 0
      ? undefined
      : inArray(location.regionCode, [...match.covering.regionCodes]),
  );
  return { inside, covering };
}

/**
 * Место фильтра. `office` — офис вакансии внутри места. `work` — можно работать отсюда:
 * место найма внутри выбранного или покрывает его, вакансия «откуда угодно», или офис
 * внутри выбранного у вакансии без мест найма — тогда работать нужно там, где офис.
 */
export function placeCondition(place: Exclude<Place, { kind: 'anywhere' }>, mode: PlaceMode): SQL {
  const { inside, covering } = placeConditions(place);
  const officeInside = hasLocation(and(eq(location.role, 'office'), inside));
  if (mode === 'office') return officeInside;
  return (
    or(
      eq(vacancies.isRemoteFromAnywhere, true),
      hasLocation(and(eq(location.role, 'hiring'), or(inside, covering))),
      and(
        officeInside,
        notExists(
          db
            .select({ one: sql`1` })
            .from(location)
            .where(and(eq(location.vacancyId, vacancies.id), eq(location.role, 'hiring'))),
        ),
      ),
    ) ?? sql`false`
  );
}

const APPLY_CONDITIONS: Readonly<Record<ApplyMethod, SQL>> = {
  url: sql`jsonb_array_length(${vacancies.apply} -> 'urls') > 0`,
  email: sql`jsonb_array_length(${vacancies.apply} -> 'emails') > 0`,
  dm: sql`(${vacancies.apply} ->> 'directMessage')::boolean`,
};

/** `%` и `_` в подстроке — буквы, а не шаблон `ILIKE`. */
function escapeLike(text: string): string {
  return text.replaceAll(/[\\%_]/gu, (char) => `\\${char}`);
}

/** Навык есть среди обязательных или «плюсом», без учёта регистра. */
function hasSkill(skill: string): SQL {
  return sql`exists (select 1 from unnest(${vacancies.skills} || ${vacancies.niceSkills}) as skill(name) where lower(skill.name) = lower(${skill}))`;
}

function hasLanguage(code: string): SQL {
  return sql`${vacancies.languages} @> ${JSON.stringify([{ code }])}::jsonb`;
}

function salaryConditions(filters: VacancyFilters): Condition[] {
  return [
    filters.withSalary
      ? or(
          isNotNull(vacancies.salaryRaw),
          isNotNull(vacancies.salaryMin),
          isNotNull(vacancies.salaryMax),
        )
      : undefined,
    filters.salaryCurrency === null
      ? undefined
      : eq(vacancies.salaryCurrency, filters.salaryCurrency),
    // Нижняя граница сравнивается с верхней вилки: вакансия «80–95k» подходит под «от 90k».
    filters.salaryFrom === null || filters.salaryCurrency === null
      ? undefined
      : gte(sql`coalesce(${vacancies.salaryMax}, ${vacancies.salaryMin})`, filters.salaryFrom),
    filters.salaryPeriod === null ? undefined : eq(vacancies.salaryPeriod, filters.salaryPeriod),
    filters.salaryTax === null
      ? undefined
      : eq(vacancies.salaryGross, filters.salaryTax === 'gross'),
  ];
}

function anyOf<T>(values: readonly T[], condition: (value: T) => SQL): Condition {
  return values.length === 0 ? undefined : or(...values.map((value) => condition(value)));
}

/**
 * Условие `where` по всем фильтрам, кроме места: место зависит от страны города, её
 * читает вызывающий. `occupationIds` — узлы профессий с потомками; `null` — без фильтра.
 */
export function filterConditions(
  filters: VacancyFilters,
  occupationIds: readonly string[] | null,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- SQL drizzle — класс, readonly его не сделать
  tsQuery: SQL | null,
): Condition {
  return and(
    tsQuery === null ? undefined : sql`${vacancies.searchVector} @@ ${tsQuery}`,
    occupationIds === null ? undefined : inArray(vacancies.occupationId, [...occupationIds]),
    filters.seniorities.length === 0
      ? undefined
      : inArray(vacancies.seniority, [...filters.seniorities]),
    filters.experienceYears === null
      ? undefined
      : or(
          isNull(vacancies.experienceYearsMin),
          lte(vacancies.experienceYearsMin, filters.experienceYears),
        ),
    filters.workplaces.length === 0
      ? undefined
      : inArray(vacancies.workplace, [...filters.workplaces]),
    filters.remoteFromAnywhere ? eq(vacancies.isRemoteFromAnywhere, true) : undefined,
    filters.employmentTypes.length === 0
      ? undefined
      : arrayOverlaps(vacancies.employmentTypes, [...filters.employmentTypes]),
    filters.hiringParties.length === 0
      ? undefined
      : inArray(vacancies.hiringParty, [...filters.hiringParties]),
    filters.company === ''
      ? undefined
      : ilike(vacancies.company, `%${escapeLike(filters.company)}%`),
    ...filters.skills.map((skill) => hasSkill(skill)),
    anyOf(filters.languages, hasLanguage),
    ...salaryConditions(filters),
    filters.equity ? eq(vacancies.equity, true) : undefined,
    filters.relocation ? eq(vacancies.relocation, true) : undefined,
    filters.visaSponsorship ? eq(vacancies.visaSponsorship, true) : undefined,
    anyOf(filters.applyMethods, (method) => APPLY_CONDITIONS[method]),
    filters.platforms.length === 0 ? undefined : inArray(sources.platform, [...filters.platforms]),
    filters.postedWithinDays === null
      ? undefined
      : gte(publications.postedAt, sql`now() - make_interval(days => ${filters.postedWithinDays})`),
  );
}
