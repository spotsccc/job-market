import type { EmploymentType, Seniority, Workplace } from '@job-market/core';
import { db, desc, eq, posts, sql, vacancies } from '@job-market/db';
import type { VacancyApply } from '@job-market/db';

/** Сколько вакансий показываем за раз. */
export const SEARCH_LIMIT = 50;

/** Вакансия для страницы: что показываем о ней и о посте, из которого она извлечена. */
export type VacancySearchItem = {
  readonly id: string;
  readonly title: string;
  readonly company: string | null;
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
  /** Дата поста строкой ISO. */
  readonly postedAt: string;
  readonly authorName: string;
  readonly authorUrl: string;
};

export type VacancySearchResult = {
  readonly items: readonly VacancySearchItem[];
  /** Сколько вакансий подходит под запрос всего, не только на странице. */
  readonly total: number;
};

/** Столбцы выдачи: поля вакансии, пост и сколько всего строк подошло под запрос. */
const RESULT_COLUMNS = {
  id: vacancies.id,
  title: vacancies.title,
  company: vacancies.company,
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
  postUrl: posts.url,
  // Строкой ISO прямо из базы: на страницу дата уходит строкой.
  postedAt: sql<string>`to_json(${posts.postedAt}) #>> '{}'`,
  authorName: posts.authorName,
  authorUrl: posts.authorUrl,
  total: sql<number>`count(*) over ()`.mapWith(Number),
};

/**
 * Полнотекстовый поиск по сохранённым вакансиям. Пустой запрос — все вакансии,
 * свежие посты первыми. Запрос разбирает `websearch_to_tsquery`: понимает
 * `"точную фразу"`, `-исключение` и `or` и не падает на произвольном вводе.
 * Найденное сортируем по релевантности, при равной — свежие посты первыми.
 */
export async function searchVacancies(
  rawQuery: string,
  limit: number = SEARCH_LIMIT,
): Promise<Error | VacancySearchResult> {
  const text = rawQuery.trim();
  const tsQuery = sql`websearch_to_tsquery('russian', ${text})`;

  // `async`-обёртка: `db` бросает синхронно, если не задан DATABASE_URL, — `.catch` ниже ловит и это.
  async function query(): Promise<VacancySearchResult> {
    const rows = await db
      .select(RESULT_COLUMNS)
      .from(vacancies)
      .innerJoin(posts, eq(vacancies.postId, posts.id))
      .where(text === '' ? undefined : sql`${vacancies.searchVector} @@ ${tsQuery}`)
      .orderBy(
        ...(text === '' ? [] : [desc(sql`ts_rank(${vacancies.searchVector}, ${tsQuery})`)]),
        desc(posts.postedAt),
        vacancies.position,
      )
      .limit(limit);
    return {
      // Лишний столбец `total` в строках не мешает: страница его не читает.
      items: rows,
      total: rows[0]?.total ?? 0,
    };
  }

  return query().catch(
    (cause: unknown) => new Error(`Searching vacancies for "${text}" failed`, { cause }),
  );
}
