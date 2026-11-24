import {
  and,
  authors,
  companies,
  db,
  desc,
  eq,
  publications,
  sources,
  sql,
  vacancies,
} from '@job-market/db';
import type { VacancyApply } from '@job-market/db';
import type { EmploymentType, Seniority, Workplace } from '@job-market/db/values';

/** Сколько вакансий показываем за раз. */
export const SEARCH_LIMIT = 50;

/** Вакансия для страницы: что показываем о ней и о публикации, из которой она извлечена. */
export type VacancySearchItem = {
  readonly id: string;
  readonly title: string;
  /** Компания как в тексте вакансии. */
  readonly company: string | null;
  /** Компания из справочника; `null` — у вакансии нет ключей компании. */
  readonly companyId: string | null;
  readonly companyName: string | null;
  readonly seniority: Seniority | null;
  readonly workplace: Workplace | null;
  readonly isRemoteFromAnywhere: boolean;
  readonly locations: readonly string[];
  readonly employmentTypes: readonly EmploymentType[];
  readonly salaryRaw: string | null;
  readonly skills: readonly string[];
  readonly relocation: boolean | null;
  readonly visaSponsorship: boolean | null;
  readonly apply: VacancyApply;
  readonly summary: string;
  readonly postUrl: string;
  /** Дата публикации строкой ISO. */
  readonly postedAt: string;
  /** Автор публикации, а если его нет — источник: канал, поиск. */
  readonly authorName: string;
  /** Страница автора; `null` — автора нет. */
  readonly authorUrl: string | null;
};

/** Компания фильтра (П9 плана компаний). */
export type CompanyFilter = { readonly id: string; readonly name: string };

export type VacancySearchResult = {
  readonly items: readonly VacancySearchItem[];
  /** Сколько вакансий подходит под запрос всего, не только на странице. */
  readonly total: number;
  /**
   * Компания фильтра; `null` — фильтра нет или компании с таким id нет. Во втором случае
   * `items` пуст.
   */
  readonly company: CompanyFilter | null;
};

export type SearchOptions = {
  /** Только вакансии этой компании; id уже проверен как uuid. */
  readonly companyId?: string;
  readonly limit?: number;
};

/** Столбцы выдачи: поля вакансии, публикация и сколько всего строк подошло под запрос. */
const RESULT_COLUMNS = {
  id: vacancies.id,
  title: vacancies.title,
  company: vacancies.company,
  companyId: vacancies.companyId,
  companyName: companies.name,
  seniority: vacancies.seniority,
  workplace: vacancies.workplace,
  isRemoteFromAnywhere: vacancies.isRemoteFromAnywhere,
  locations: vacancies.locations,
  employmentTypes: vacancies.employmentTypes,
  salaryRaw: vacancies.salaryRaw,
  skills: vacancies.skills,
  relocation: vacancies.relocation,
  visaSponsorship: vacancies.visaSponsorship,
  apply: vacancies.apply,
  summary: vacancies.summary,
  postUrl: publications.url,
  // Строкой ISO прямо из базы: на страницу дата уходит строкой.
  postedAt: sql<string>`to_json(${publications.postedAt}) #>> '{}'`,
  authorName: sql<string>`coalesce(${authors.name}, ${sources.name})`,
  authorUrl: authors.url,
  total: sql<number>`count(*) over ()`.mapWith(Number),
};

/** Компания по id; `null` — такой нет. */
async function findCompany(companyId: string): Promise<CompanyFilter | null> {
  const [row] = await db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(eq(companies.id, companyId));
  return row ?? null;
}

/**
 * Полнотекстовый поиск по вакансиям новой модели. Пустой запрос — все вакансии, свежие
 * публикации первыми. Запрос разбирает `websearch_to_tsquery`: понимает `"точную фразу"`,
 * `-исключение` и `or` и не падает на произвольном вводе. Найденное сортируем по
 * релевантности, при равной — свежие публикации первыми. `companyId` оставляет вакансии одной
 * компании, запрос работает вместе с ним (П9 плана компаний).
 */
export async function searchVacancies(
  rawQuery: string,
  { companyId, limit = SEARCH_LIMIT }: SearchOptions = {},
): Promise<Error | VacancySearchResult> {
  const text = rawQuery.trim();
  const tsQuery = sql`websearch_to_tsquery('russian', ${text})`;

  // `async`-обёртка: `db` бросает синхронно, если не задан DATABASE_URL, — `.catch` ниже ловит и это.
  async function query(): Promise<VacancySearchResult> {
    const company = companyId === undefined ? null : await findCompany(companyId);
    if (companyId !== undefined && company === null) return { items: [], total: 0, company };
    const rows = await db
      .select(RESULT_COLUMNS)
      .from(vacancies)
      .innerJoin(publications, eq(vacancies.publicationId, publications.id))
      .innerJoin(sources, eq(publications.sourceId, sources.id))
      .leftJoin(authors, eq(publications.authorId, authors.id))
      .leftJoin(companies, eq(vacancies.companyId, companies.id))
      .where(
        and(
          text === '' ? undefined : sql`${vacancies.searchVector} @@ ${tsQuery}`,
          companyId === undefined ? undefined : eq(vacancies.companyId, companyId),
        ),
      )
      .orderBy(
        ...(text === '' ? [] : [desc(sql`ts_rank(${vacancies.searchVector}, ${tsQuery})`)]),
        desc(publications.postedAt),
        vacancies.position,
      )
      .limit(limit);
    return {
      // Лишний столбец `total` в строках не мешает: страница его не читает.
      items: rows,
      total: rows[0]?.total ?? 0,
      company,
    };
  }

  return query().catch(
    (cause: unknown) => new Error(`Searching vacancies for "${text}" failed`, { cause }),
  );
}
