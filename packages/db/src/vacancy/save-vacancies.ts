import { and, eq, getTableColumns, gte, inArray, sql } from 'drizzle-orm';

import type { DbExecutor } from '../client.ts';
import type { NewVacancyLocationRow } from './vacancy-location.ts';
import { vacancyLocations } from './vacancy-location.ts';
import type { NewVacancyRow } from './vacancy.ts';
import { vacancies } from './vacancy.ts';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type ReadonlyArrays<T> = {
  readonly [K in keyof T]: Exclude<T[K], undefined> extends (infer E)[] ? readonly E[] : T[K];
};

/** Место вакансии для записи: номер места — его индекс в списке. */
export type PlaceToSave = Readonly<Omit<NewVacancyLocationRow, 'vacancyId' | 'position'>>;

/**
 * Роль для записи: строка `vacancies` без публикации и номера — номер роли это её индекс в
 * списке — и её места. `locations` пишет тот, кто сводил места к справочнику: там и «откуда
 * угодно», которого нет среди мест (П16, П17).
 */
export type VacancyToSave = ReadonlyArrays<
  Omit<
    NewVacancyRow,
    'id' | 'publicationId' | 'position' | 'createdAt' | 'updatedAt' | 'searchVector'
  >
> & { readonly places: readonly PlaceToSave[] };

function vacancyRow(
  publicationId: string,
  position: number,
  role: VacancyToSave,
): Mutable<NewVacancyRow> {
  const { places: _places, ...fields } = role;
  return {
    ...fields,
    publicationId,
    position,
    locations: fields.locations === undefined ? undefined : [...fields.locations],
    employmentTypes: fields.employmentTypes === undefined ? undefined : [...fields.employmentTypes],
    skills: fields.skills === undefined ? undefined : [...fields.skills],
    niceSkills: fields.niceSkills === undefined ? undefined : [...fields.niceSkills],
    responsibilities:
      fields.responsibilities === undefined ? undefined : [...fields.responsibilities],
    requirements: fields.requirements === undefined ? undefined : [...fields.requirements],
    benefits: fields.benefits === undefined ? undefined : [...fields.benefits],
  };
}

/** Столбцы, которые не перезаписываются: ключ строки, время создания и генерируемый вектор. */
const KEEP: ReadonlySet<string> = new Set([
  'id',
  'publicationId',
  'position',
  'createdAt',
  'updatedAt',
  'searchVector',
]);

/**
 * Повторная запись перезаписывает все остальные столбцы значением из вставки: столбец, которого
 * нет в роли, получает свой DEFAULT, а не остаётся от прежней записи.
 */
const OVERWRITE = {
  ...Object.fromEntries(
    Object.entries(getTableColumns(vacancies))
      .filter(([key]) => !KEEP.has(key))
      .map(([key]) => [
        key,
        sql`excluded.${sql.identifier(key.replaceAll(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`))}`,
      ]),
  ),
  updatedAt: sql`now()`,
};

/**
 * Пишет роли публикации (П9, П17): вакансия — upsert по `(publication_id, position)`, лишние
 * вакансии прежней записи удаляются; места каждой вакансии стираются и пишутся заново по
 * порядку. Транзакцию держит вызывающий: вакансии и места пишутся вместе с публикацией.
 */
export async function saveVacancies(
  db: DbExecutor,
  publicationId: string,
  roles: readonly VacancyToSave[],
): Promise<void> {
  await db
    .delete(vacancies)
    .where(and(eq(vacancies.publicationId, publicationId), gte(vacancies.position, roles.length)));
  if (roles.length === 0) return;

  const saved = await db
    .insert(vacancies)
    .values(roles.map((role, position) => vacancyRow(publicationId, position, role)))
    .onConflictDoUpdate({ target: [vacancies.publicationId, vacancies.position], set: OVERWRITE })
    .returning({ id: vacancies.id, position: vacancies.position });

  const ids = saved.map((row) => row.id);
  await db.delete(vacancyLocations).where(inArray(vacancyLocations.vacancyId, ids));
  const places = saved.flatMap(({ id, position }) =>
    (roles[position]?.places ?? []).map((place, index) => ({
      vacancyId: id,
      position: index,
      role: place.role,
      resolution: place.resolution,
      regionCode: place.regionCode,
      countryCode: place.countryCode,
      cityId: place.cityId,
      raw: place.raw,
    })),
  );
  if (places.length > 0) await db.insert(vacancyLocations).values(places);
}
