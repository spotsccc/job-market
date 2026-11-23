import { db, desc, eq, legacyPosts, sql, legacyVacancies } from '@job-market/db';
import type { VacancyApply } from '@job-market/db';
import type { EmploymentType, Seniority, Workplace } from '@job-market/db/values';

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
  id: legacyVacancies.id,
  title: legacyVacancies.title,
  company: legacyVacancies.company,
  seniority: legacyVacancies.seniority,
  workplace: legacyVacancies.workplace,
  isRemoteFromAnywhere: legacyVacancies.isRemoteFromAnywhere,
  locations: legacyVacancies.locations,
  employmentTypes: legacyVacancies.employmentTypes,
  salaryRaw: legacyVacancies.salaryRaw,
  skills: legacyVacancies.skills,
  relocation: legacyVacancies.relocation,
  visaSponsorship: legacyVacancies.visaSponsorship,
  apply: legacyVacancies.apply,
  summary: legacyVacancies.summary,
  postUrl: legacyPosts.url,
  // Строкой ISO прямо из базы: на страницу дата уходит строкой.
  postedAt: sql<string>`to_json(${legacyPosts.postedAt}) #>> '{}'`,
  authorName: legacyPosts.authorName,
  authorUrl: legacyPosts.authorUrl,
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
      .from(legacyVacancies)
      .innerJoin(legacyPosts, eq(legacyVacancies.postId, legacyPosts.id))
      .where(text === '' ? undefined : sql`${legacyVacancies.searchVector} @@ ${tsQuery}`)
      .orderBy(
        ...(text === '' ? [] : [desc(sql`ts_rank(${legacyVacancies.searchVector}, ${tsQuery})`)]),
        desc(legacyPosts.postedAt),
        legacyVacancies.position,
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
