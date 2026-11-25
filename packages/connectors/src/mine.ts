import { db, listOccupations, saveVacancies, setOutcome } from '@job-market/db';
import type { Occupation, VacancyToSave } from '@job-market/db';
import type { ExtractedRole, OccupationNode } from '@job-market/extractor';
import { locateVacancies } from '@job-market/geo/server';
import type { LocatedPlaces } from '@job-market/geo/server';

import type {
  ConnectorDefinition,
  MinePublication,
  MineResult,
  ProcessOutcome,
} from './contract.ts';

/** Сводит места ролей к гео-справочнику; тесты подставляют справочник, который не отвечает. */
export type Locate = typeof locateVacancies;

/** Статусы, в которых публикацию можно разбирать (П12). */
const MINEABLE: ReadonlySet<MinePublication['status']> = new Set(['pending', 'processing']);

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- в публикации `Date`, глубоко readonly его не сделать
function toNode(occupation: Occupation): OccupationNode {
  return {
    id: occupation.id,
    parentId: occupation.parentId,
    name: occupation.name,
    description: occupation.description,
    archived: occupation.archivedAt !== null,
  };
}

function toVacancy(role: ExtractedRole, located: LocatedPlaces): VacancyToSave {
  const { places: _words, ...fields } = role;
  return {
    ...fields,
    isRemoteFromAnywhere: located.isRemoteFromAnywhere,
    locations: located.locations,
    places: located.places,
  };
}

/** Роли с местами из справочника (П12): все места — одним вызовом `locate`. */
async function locateRoles(
  roles: readonly ExtractedRole[],
  locate: Locate,
): Promise<Error | VacancyToSave[]> {
  const located = await locate(db, roles);
  if (located instanceof Error) return located;
  return roles.flatMap((role, index) => {
    const places = located[index];
    return places === undefined ? [] : [toVacancy(role, places)];
  });
}

/**
 * Вакансии и итог одной транзакцией (П12); сбой базы — `Error`, не записано ничего. Роли, уже
 * сохранённые из других публикаций, не пишутся; все роли такие — итог `duplicate` (П18–П20,
 * packages/db/src/publication/README.md).
 */
async function write(
  publicationId: string,
  outcome: ProcessOutcome,
  vacancies: readonly VacancyToSave[],
): Promise<Error | MineResult> {
  return (
    db
      // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- транзакцию drizzle передаёт сам
      .transaction(async (tx): Promise<MineResult> => {
        if (outcome.kind === 'vacancy') {
          const { saved, duplicateOf } = await saveVacancies(tx, publicationId, vacancies, {
            skipDuplicates: true,
          });
          const [originalId] = duplicateOf;
          if (saved === 0 && originalId !== undefined) {
            await setOutcome(tx, publicationId, { status: 'duplicate', originalId });
            return { status: 'duplicate', vacancies: 0 };
          }
          await setOutcome(tx, publicationId, { status: 'vacancy' });
          return { status: 'vacancy', vacancies: saved };
        }
        await setOutcome(
          tx,
          publicationId,
          outcome.reason === 'empty'
            ? { status: 'not_vacancy', reason: 'empty' }
            : { status: 'not_vacancy', reason: 'trash', note: outcome.note },
        );
        return { status: 'not_vacancy', vacancies: 0 };
      })
      .catch(
        (cause: unknown) =>
          new Error(`Writing vacancies of publication ${publicationId} failed`, { cause }),
      )
  );
}

/**
 * Разбор одной публикации (П12): дерево профессий, `process` коннектора, места ролей одним
 * вызовом справочника и запись вакансий без дублей с итогом одной транзакцией. Публикация не в `pending`
 * и не в `processing` — `skipped` без моделей. Сбой модели, справочника или базы — `Error`,
 * ничего не записано и статус прежний: повтор решает вызывающий.
 */
export async function mine(
  connector: Pick<ConnectorDefinition, 'process'>,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- в публикации `Date`, глубоко readonly его не сделать
  publication: MinePublication,
  locate: Locate = locateVacancies,
): Promise<Error | MineResult> {
  if (!MINEABLE.has(publication.status)) return { status: 'skipped', vacancies: 0 };

  const occupations = await listOccupations(db).catch(
    (cause: unknown) => new Error('Reading occupations failed', { cause }),
  );
  if (occupations instanceof Error) return occupations;

  const outcome = await connector.process(publication, {
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- в узле дерева `Date` архивации, глубоко readonly его не сделать
    occupations: occupations.map((occupation) => toNode(occupation)),
  });
  if (outcome instanceof Error) return outcome;

  const vacancies = outcome.kind === 'vacancy' ? await locateRoles(outcome.roles, locate) : [];
  if (vacancies instanceof Error) return vacancies;

  return write(publication.id, outcome, vacancies);
}
