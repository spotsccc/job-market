import {
  and,
  asc,
  authors,
  db,
  eq,
  listOccupations,
  ne,
  platforms,
  publications,
  sources,
  sql,
  vacancies,
} from '@job-market/db';
import type { VacancySchemaVersion } from '@job-market/db/values';

import { buildOccupationTree } from './occupation-tree.ts';
import { VACANCY_COLUMNS, loadPlaces } from './search-vacancies.ts';
import type { VacancySearchItem } from './search-vacancies.ts';

/** Другая вакансия той же публикации: ссылка на её страницу. */
export type SiblingVacancy = {
  readonly id: string;
  readonly title: string;
};

/** Вакансия для её страницы: всё, что показывает карточка, и служебные поля. */
export type VacancyDetails = VacancySearchItem & {
  readonly occupationId: string | null;
  readonly schemaVersion: VacancySchemaVersion;
  readonly position: number;
  /** Текст публикации в Markdown, с разделами по ссылкам в конце. */
  readonly content: string;
  readonly authorHeadline: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Другие роли из той же публикации, по порядку. */
  readonly siblings: readonly SiblingVacancy[];
};

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu;

async function findVacancy(id: string): Promise<VacancyDetails | null> {
  const [row] = await db
    .select({
      ...VACANCY_COLUMNS,
      occupationId: vacancies.occupationId,
      schemaVersion: vacancies.schemaVersion,
      position: vacancies.position,
      publicationId: vacancies.publicationId,
      content: publications.content,
      authorHeadline: authors.headline,
      // Строкой ISO прямо из базы: на страницу дата уходит строкой.
      createdAt: sql<string>`to_json(${vacancies.createdAt}) #>> '{}'`,
      updatedAt: sql<string>`to_json(${vacancies.updatedAt}) #>> '{}'`,
    })
    .from(vacancies)
    .innerJoin(publications, eq(vacancies.publicationId, publications.id))
    .innerJoin(sources, eq(publications.sourceId, sources.id))
    .innerJoin(platforms, eq(sources.platform, platforms.id))
    .leftJoin(authors, eq(publications.authorId, authors.id))
    .where(eq(vacancies.id, id));
  if (row === undefined) return null;

  const [occupations, places, siblings] = await Promise.all([
    listOccupations(db),
    loadPlaces([id]),
    db
      .select({ id: vacancies.id, title: vacancies.title })
      .from(vacancies)
      .where(and(eq(vacancies.publicationId, row.publicationId), ne(vacancies.id, id)))
      .orderBy(asc(vacancies.position)),
  ]);
  const { publicationId: _publicationId, ...vacancy } = row;
  return {
    ...vacancy,
    occupation:
      row.occupationId === null ? null : buildOccupationTree(occupations).path(row.occupationId),
    places: places.get(id) ?? [],
    siblings,
  };
}

/** Вакансия по id. Нет такой или id не uuid — `null`; сбой базы — ошибка. */
export async function getVacancy(id: string): Promise<Error | VacancyDetails | null> {
  if (!UUID.test(id)) return null;
  // `async`-обёртка: `db` бросает синхронно, если не задан DATABASE_URL, — `.catch` ниже ловит и это.
  return (async () => findVacancy(id))().catch(
    (cause: unknown) => new Error(`Loading vacancy ${id} failed`, { cause }),
  );
}
