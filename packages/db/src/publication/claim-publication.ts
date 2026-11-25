import { and, eq, inArray, lt, or, sql } from 'drizzle-orm';

import type { DbExecutor } from '../client.ts';
import type { AuthorRow } from './author.ts';
import { authors } from './author.ts';
import type { NewPublicationRow } from './publication.ts';
import { publications } from './publication.ts';
import type { Connector } from './values.ts';

/**
 * Состояние разбора публикации для движка (`packages/engine/README.md`): взять публикацию в разбор и записать,
 * чем попытка кончилась. Итог разбора с вакансиями пишет `setOutcome` в `mine` коннектора.
 * Сбой базы — `Error` значением: движок отдаёт его очереди, и та повторяет задание.
 */

/**
 * Публикация, взятая в разбор: как её видит модель, плюс id и статус строки, `attempts` после
 * взятия и хэш текста для поиска оригинала.
 */
export type ClaimedPublication = {
  readonly id: string;
  readonly status: 'processing';
  readonly connector: Connector;
  readonly content: string;
  readonly postedAt: Date;
  readonly author: Readonly<Pick<AuthorRow, 'name' | 'url' | 'headline'>> | null;
  readonly attempts: number;
  readonly contentHash: string;
};

export type ClaimOptions = {
  readonly now: Date;
  /** Публикация `processing`, взятая раньше, брошена: её можно взять снова. */
  readonly staleBefore: Date;
  /** Коннекторы реестра: публикацию чужого коннектора не берём. */
  readonly connectorIds: readonly Connector[];
};

/**
 * Берёт публикацию в разбор одним запросом (П1 разбора, packages/engine/README.md): только если она `pending` или
 * `processing` с `claimed_at` раньше `staleBefore` и её коннектор в `connectorIds`. Взятая
 * получает `processing`, `attempts` + 1 и `claimed_at = now` и возвращается с автором.
 * `undefined` — брать нечего: публикации нет, она разобрана, её разбирает другой обработчик
 * или её коннектора нет. Сбой базы — `Error`.
 */
export async function claimPublication(
  db: DbExecutor,
  id: string,
  options: ClaimOptions,
): Promise<Error | ClaimedPublication | undefined> {
  const { now, staleBefore, connectorIds } = options;
  if (connectorIds.length === 0) return undefined;
  return db
    .update(publications)
    .set({ status: 'processing', attempts: sql`${publications.attempts} + 1`, claimedAt: now })
    .where(
      and(
        eq(publications.id, id),
        inArray(publications.connector, [...connectorIds]),
        or(
          eq(publications.status, 'pending'),
          and(eq(publications.status, 'processing'), lt(publications.claimedAt, staleBefore)),
        ),
      ),
    )
    .returning({
      id: publications.id,
      connector: publications.connector,
      content: publications.content,
      postedAt: publications.postedAt,
      attempts: publications.attempts,
      contentHash: publications.contentHash,
      // Подзапрос, а не JOIN: UPDATE … RETURNING не соединяется с другой таблицей.
      author: sql<ClaimedPublication['author']>`(
        select json_build_object('name', ${authors.name}, 'url', ${authors.url}, 'headline', ${authors.headline})
        from ${authors} where ${authors.id} = ${publications.authorId}
      )`,
    })
    .then(([row]) => (row === undefined ? undefined : { ...row, status: 'processing' as const }))
    .catch((cause: unknown) => new Error(`Claiming publication ${id} failed`, { cause }));
}

/** Поля состояния разбора, которые пишет движок. Какие из них писать, решает он. */
export type PublicationState = Readonly<
  Partial<Pick<NewPublicationRow, 'status' | 'lastError' | 'processedAt' | 'duplicateOfId'>>
>;

/**
 * Пишет переданные поля состояния разбора и ничего не решает — только пока публикация
 * `processing`: итог, который уже записал другой обработчик, не затирается (E3 разбора, packages/engine/README.md).
 */
export async function updatePublicationState(
  db: DbExecutor,
  id: string,
  state: PublicationState,
): Promise<Error | undefined> {
  const written = await db
    .update(publications)
    .set({ ...state })
    .where(and(eq(publications.id, id), eq(publications.status, 'processing')))
    .catch((cause: unknown) => new Error(`Writing state of publication ${id} failed`, { cause }));
  if (written instanceof Error) return written;
  return undefined;
}
