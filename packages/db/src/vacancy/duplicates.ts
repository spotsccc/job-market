import { and, asc, eq, gte, inArray, lte, ne } from 'drizzle-orm';

import type { DbExecutor } from '../client.ts';
import { publications } from '../publication/publication.ts';
import type { VacancyToSave } from './save-vacancies.ts';
import { vacancyLocations } from './vacancy-location.ts';
import { vacancies } from './vacancy.ts';

/**
 * Дубли вакансий (П18–П20, packages/db/src/publication/README.md): одна роль одной компании,
 * которая вышла в нескольких публикациях, сохраняется один раз.
 */

/** Окно поиска дубля: публикации вышли не дальше стольких дней друг от друга (П19). */
export const DUPLICATE_WINDOW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Что сравнивает правило дубля (П18): название, уровень, формат работы и распознанные места. */
export type DuplicateFields = {
  readonly title: string;
  readonly seniority: string | null;
  readonly workplace: string | null;
  /** Коды стран распознанных мест. */
  readonly countries: readonly string[];
  /** Id городов распознанных мест. */
  readonly cities: readonly number[];
};

/**
 * Название роли в одном виде (П18): Unicode NFKC, нижний регистр, ё → е; всё, кроме букв, цифр,
 * «+» и «#», — пробел: эмодзи, пунктуация и скобки названия не различают, а «C++» и «C#»
 * остаются собой. Слова не выбрасываются: «Frontend (React)» и «Frontend (Vue)» — разные роли.
 */
export function titleKey(title: string): string {
  return title
    .normalize('NFKC')
    .toLowerCase()
    .replaceAll('ё', 'е')
    .replaceAll(/[^\p{L}\p{N}+#]+/gu, ' ')
    .trim();
}

/** Оба значения названы и разные. Не названное значение ничему не противоречит. */
function differ(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && a !== b;
}

/** Оба списка не пусты и не пересекаются. Пустой список ничему не противоречит. */
function disjoint<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length > 0 && b.length > 0 && !a.some((item) => b.includes(item));
}

/**
 * Одна и та же роль (П18): названия совпадают по `titleKey`, а уровень, формат работы, страны и
 * города не противоречат друг другу. Пустое название дублем не бывает.
 */
export function isSameRole(a: DuplicateFields, b: DuplicateFields): boolean {
  const key = titleKey(a.title);
  if (key === '' || key !== titleKey(b.title)) return false;
  if (differ(a.seniority, b.seniority) || differ(a.workplace, b.workplace)) return false;
  return !disjoint(a.countries, b.countries) && !disjoint(a.cities, b.cities);
}

function fieldsOf(role: VacancyToSave): DuplicateFields {
  return {
    title: role.title,
    seniority: role.seniority ?? null,
    workplace: role.workplace ?? null,
    countries: role.places.flatMap((place) => place.countryCode ?? []),
    cities: role.places.flatMap((place) => place.cityId ?? []),
  };
}

/** Сохранённая вакансия компании из другой публикации в окне П19. */
type Candidate = DuplicateFields & {
  readonly companyId: string | null;
  readonly publicationId: string;
};

type CandidatePlace = {
  readonly vacancyId: string;
  readonly countryCode: string | null;
  readonly cityId: number | null;
};

async function placesOf(db: DbExecutor, vacancyIds: readonly string[]): Promise<CandidatePlace[]> {
  return db
    .select({
      vacancyId: vacancyLocations.vacancyId,
      countryCode: vacancyLocations.countryCode,
      cityId: vacancyLocations.cityId,
    })
    .from(vacancyLocations)
    .where(inArray(vacancyLocations.vacancyId, [...vacancyIds]));
}

/** Когда вышла публикация, в миллисекундах; `undefined` — строки нет. */
async function postedAtOf(db: DbExecutor, publicationId: string): Promise<number | undefined> {
  const [publication] = await db
    .select({ postedAt: publications.postedAt })
    .from(publications)
    .where(eq(publications.id, publicationId));
  return publication?.postedAt.getTime();
}

/** Вакансии этих компаний из других публикаций в окне П19, от ранней записи к поздней. */
async function findCandidates(
  db: DbExecutor,
  publicationId: string,
  companyIds: readonly string[],
): Promise<Candidate[]> {
  const postedAt = await postedAtOf(db, publicationId);
  if (postedAt === undefined) return [];
  const windowMs = DUPLICATE_WINDOW_DAYS * DAY_MS;

  const rows = await db
    .select({
      id: vacancies.id,
      publicationId: vacancies.publicationId,
      companyId: vacancies.companyId,
      title: vacancies.title,
      seniority: vacancies.seniority,
      workplace: vacancies.workplace,
    })
    .from(vacancies)
    .innerJoin(publications, eq(publications.id, vacancies.publicationId))
    .where(
      and(
        inArray(vacancies.companyId, [...companyIds]),
        ne(vacancies.publicationId, publicationId),
        gte(publications.postedAt, new Date(postedAt - windowMs)),
        lte(publications.postedAt, new Date(postedAt + windowMs)),
      ),
    )
    .orderBy(asc(vacancies.createdAt), asc(vacancies.id));
  if (rows.length === 0) return [];

  const places = await placesOf(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => {
    const own = places.filter((place) => place.vacancyId === row.id);
    return {
      publicationId: row.publicationId,
      companyId: row.companyId,
      title: row.title,
      seniority: row.seniority,
      workplace: row.workplace,
      countries: own.flatMap((place) => place.countryCode ?? []),
      cities: own.flatMap((place) => place.cityId ?? []),
    };
  });
}

/**
 * Для каждой роли — id публикации, из которой эта роль уже сохранена, или `null` (П18, П19).
 * `companyIds` — компании ролей по порядку; роль без компании дублем не бывает. Зовётся после
 * блокировок ключей компаний: два разбора одной вакансии идут по очереди, и второй видит
 * вакансию первого (E8).
 */
export async function findDuplicates(
  db: DbExecutor,
  publicationId: string,
  roles: readonly VacancyToSave[],
  companyIds: readonly (string | null)[],
): Promise<(string | null)[]> {
  const known = [...new Set(companyIds.filter((id) => id !== null))];
  if (known.length === 0) return roles.map(() => null);
  const candidates = await findCandidates(db, publicationId, known);
  return roles.map((role, index) => {
    const companyId = companyIds[index] ?? null;
    if (companyId === null) return null;
    const fields = fieldsOf(role);
    const original = candidates.find(
      (candidate) => candidate.companyId === companyId && isSameRole(fields, candidate),
    );
    return original?.publicationId ?? null;
  });
}
