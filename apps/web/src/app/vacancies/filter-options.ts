import {
  companies,
  db,
  geoCities,
  isNotNull,
  listOccupations,
  platforms,
  sql,
  vacancies,
  vacancyLocations,
} from '@job-market/db';
import { COUNTRY_CODES, REGIONS, formatPlace, isCountryCode, placeKey } from '@job-market/geo';

import { buildOccupationTree } from './occupation-tree.ts';
import type { OccupationNode } from './occupation-tree.ts';

/** Вариант выбора: `value` уходит в адрес страницы, `label` видит человек. */
export type Option = { readonly value: string; readonly label: string };

/** Группа вариантов выбора места: регионы, страны, города. */
export type OptionGroup = { readonly group: string; readonly items: readonly Option[] };

/** Варианты для фильтров, которые зависят от данных. */
export type FilterOptions = {
  readonly occupations: readonly OccupationNode[];
  readonly places: readonly OptionGroup[];
  readonly skills: readonly Option[];
  readonly languages: readonly Option[];
  readonly currencies: readonly Option[];
  /** Компании справочника, у которых есть вакансии. */
  readonly companies: readonly Option[];
  readonly platforms: readonly Option[];
};

/** Сколько самых частых навыков предлагать в фильтре. */
const SKILLS_LIMIT = 500;

const languageNames = new Intl.DisplayNames(['ru'], { type: 'language', fallback: 'code' });

const byLabel = (a: Option, b: Option): number => a.label.localeCompare(b.label, 'ru');

/**
 * Навыки обязательные и «плюсом» вместе, без учёта регистра, самые частые первыми.
 * Название — самое частое написание.
 */
async function loadSkills(): Promise<Option[]> {
  const rows = await db.execute<Readonly<{ name: string }>>(sql`
    select mode() within group (order by skill.name) as name
    from ${vacancies}, unnest(${vacancies.skills} || ${vacancies.niceSkills}) as skill(name)
    group by lower(skill.name)
    order by count(*) desc, lower(skill.name)
    limit ${SKILLS_LIMIT}`);
  return rows.rows.map((row) => ({ value: row.name, label: row.name }));
}

async function loadLanguages(): Promise<Option[]> {
  const rows = await db.execute<Readonly<{ code: string }>>(sql`
    select distinct lower(language ->> 'code') as code
    from ${vacancies}, jsonb_array_elements(${vacancies.languages}) as language
    where language ->> 'code' is not null`);
  return rows.rows
    .map((row) => ({
      value: row.code,
      label: `${languageNames.of(row.code) ?? row.code} (${row.code})`,
    }))
    .toSorted(byLabel);
}

async function loadCompanies(): Promise<Option[]> {
  const rows = await db
    .selectDistinct({ value: companies.id, label: companies.name })
    .from(companies)
    .innerJoin(vacancies, sql`${vacancies.companyId} = ${companies.id}`);
  return rows.toSorted(byLabel);
}

async function loadCurrencies(): Promise<Option[]> {
  const rows = await db
    .selectDistinct({ currency: vacancies.salaryCurrency })
    .from(vacancies)
    .where(isNotNull(vacancies.salaryCurrency));
  return rows
    .flatMap((row) => (row.currency === null ? [] : [row.currency.toUpperCase()]))
    .toSorted()
    .map((currency) => ({ value: currency, label: currency }));
}

/** Города, которые встречаются в местах вакансий: все города справочника в список не влезут. */
async function loadCities(): Promise<Option[]> {
  const rows = await db
    .selectDistinct({
      id: geoCities.id,
      countryCode: geoCities.countryCode,
      name: geoCities.name,
      nameRu: geoCities.nameRu,
      nameEn: geoCities.nameEn,
    })
    .from(vacancyLocations)
    .innerJoin(geoCities, sql`${geoCities.id} = ${vacancyLocations.cityId}`);
  return rows
    .flatMap((city) =>
      isCountryCode(city.countryCode)
        ? [
            {
              value: placeKey({ kind: 'city', id: city.id }),
              label: formatPlace(
                { kind: 'city', id: city.id, countryCode: city.countryCode },
                'ru',
                city,
              ),
            },
          ]
        : [],
    )
    .toSorted(byLabel);
}

function placeGroups(cities: readonly Option[]): OptionGroup[] {
  return [
    {
      group: 'Регионы',
      items: REGIONS.map((region) => ({
        value: placeKey({ kind: 'region', code: region.code }),
        label: region.nameRu,
      })).toSorted(byLabel),
    },
    {
      group: 'Страны',
      items: COUNTRY_CODES.map((code) => ({
        value: placeKey({ kind: 'country', code }),
        label: formatPlace({ kind: 'country', code }, 'ru'),
      })).toSorted(byLabel),
    },
    ...(cities.length === 0 ? [] : [{ group: 'Города', items: cities }]),
  ];
}

async function loadFilterOptionsOnce(): Promise<FilterOptions> {
  const [occupations, cities, skills, languages, currencies, companyOptions, platformRows] =
    await Promise.all([
      listOccupations(db),
      loadCities(),
      loadSkills(),
      loadLanguages(),
      loadCurrencies(),
      loadCompanies(),
      db.select({ value: platforms.id, label: platforms.name }).from(platforms),
    ]);
  return {
    occupations: buildOccupationTree(occupations).nodes,
    places: placeGroups(cities),
    skills,
    languages,
    currencies,
    companies: companyOptions,
    platforms: platformRows.toSorted(byLabel),
  };
}

/** Варианты фильтров из базы. */
export async function loadFilterOptions(): Promise<Error | FilterOptions> {
  return (async () => loadFilterOptionsOnce())().catch(
    (cause: unknown) => new Error('Loading vacancy filter options failed', { cause }),
  );
}
