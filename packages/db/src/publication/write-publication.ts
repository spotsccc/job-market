import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import type { Database, DbExecutor } from '../client.ts';
import type { NewAuthorRow } from './author.ts';
import { authors } from './author.ts';
import { publicationLinks } from './publication-link.ts';
import type { NewPublicationRow } from './publication.ts';
import { publications } from './publication.ts';
import { sourceRuns } from './source-run.ts';
import type { SourceRunToSave } from './source-run.ts';
import { sources } from './source.ts';
import type { NewSourceRow, SourceRow } from './source.ts';
import type { Connector } from './values.ts';
import { linkRows } from './write-links.ts';
import type { LinkToSave } from './write-links.ts';

/**
 * Запись публикаций и их авторов. Функции принимают клиент или транзакцию и не открывают
 * свою: границу транзакции держит вызывающий (перенос, потом движок). Сбой базы — исключение
 * drizzle: оно откатывает транзакцию вызывающего.
 */

/** Автор для записи: ключ `(connector, externalId)` и то, что перезаписывается. */
export type AuthorToSave = Readonly<
  Pick<NewAuthorRow, 'connector' | 'externalId' | 'name' | 'url' | 'headline'>
>;

/** Публикация для записи: строка `publications` без служебных столбцов. */
export type PublicationToSave = Readonly<
  Omit<NewPublicationRow, 'createdAt' | 'updatedAt' | 'claimedAt'>
>;

/** Ключ автора в ответе `upsertAuthors`: id автора уникален только внутри коннектора. */
export function authorKey(connector: Connector, externalId: string): string {
  return `${connector}:${externalId}`;
}

/**
 * Вставляет новых авторов и перезаписывает `name`, `url` и `headline` найденных по
 * `(connector, external_id)` (П3). Повтор одного автора во входе пишется один раз —
 * последним значением. Ответ — id по `authorKey`.
 */
export async function upsertAuthors(
  db: DbExecutor,
  rows: readonly AuthorToSave[],
): Promise<ReadonlyMap<string, string>> {
  const unique = new Map(rows.map((row) => [authorKey(row.connector, row.externalId), row]));
  if (unique.size === 0) return new Map();
  const saved = await db
    .insert(authors)
    .values([...unique.values()])
    .onConflictDoUpdate({
      target: [authors.connector, authors.externalId],
      set: {
        name: sql`excluded.name`,
        url: sql`excluded.url`,
        headline: sql`excluded.headline`,
        updatedAt: new Date(),
      },
    })
    .returning({ id: authors.id, connector: authors.connector, externalId: authors.externalId });
  return new Map(saved.map((row) => [authorKey(row.connector, row.externalId), row.id]));
}

/**
 * Столбцы, которые повторная попытка разбора перезаписывает у публикации `failed`. Источник
 * и id остаются прежними, `attempts` растёт на 1.
 */
const RETRY_SET = {
  url: sql`excluded.url`,
  content: sql`excluded.content`,
  postedAt: sql`excluded.posted_at`,
  contentHash: sql`excluded.content_hash`,
  status: sql`excluded.status`,
  attempts: sql`${publications.attempts} + 1`,
  processedAt: sql`excluded.processed_at`,
  lastError: sql`excluded.last_error`,
  notVacancyReason: sql`excluded.not_vacancy_reason`,
  note: sql`excluded.note`,
  duplicateOfId: sql`excluded.duplicate_of_id`,
  authorId: sql`excluded.author_id`,
  updatedAt: sql`now()`,
};

/**
 * Пишет публикацию с итогом разбора. Новая вставляется; публикация `failed` с тем же
 * `(connector, external_id)` перезаписывается — это повтор разбора (П6). Если публикация
 * уже записана с другим статусом — её записал другой запуск (E6): ничего не меняется,
 * ответ `null`. Иначе — id публикации.
 */
export async function insertPublication(
  db: DbExecutor,
  row: PublicationToSave,
): Promise<string | null> {
  const [saved] = await db
    .insert(publications)
    .values(row)
    .onConflictDoUpdate({
      target: [publications.connector, publications.externalId],
      set: RETRY_SET,
      setWhere: eq(publications.status, 'failed'),
    })
    .returning({ id: publications.id });
  return saved?.id ?? null;
}

/**
 * Пишет публикацию, разбор которой упал (П6): `failed`, `last_error`, `attempts` + 1. Если
 * публикация уже есть и не `failed`, её не трогает и отвечает `null`.
 */
export async function markFailed(
  db: DbExecutor,
  row: PublicationToSave,
  error: string,
): Promise<string | null> {
  return insertPublication(db, {
    ...row,
    status: 'failed',
    attempts: 1,
    lastError: error,
    notVacancyReason: null,
    note: null,
    duplicateOfId: null,
  });
}

/**
 * Оригиналы по хэшам текста (П4): публикации со статусом `vacancy` или `not_vacancy`. Если
 * у хэша их несколько — самая ранняя. Ответ — id по хэшу; хэша без оригинала в ответе нет.
 */
export async function findOriginals(
  db: DbExecutor,
  hashes: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  if (hashes.length === 0) return new Map();
  const rows = await db
    .select({ id: publications.id, contentHash: publications.contentHash })
    .from(publications)
    .where(
      and(
        inArray(publications.contentHash, [...new Set(hashes)]),
        inArray(publications.status, ['vacancy', 'not_vacancy']),
      ),
    )
    .orderBy(asc(publications.postedAt), asc(publications.id));
  const originals = new Map<string, string>();
  for (const row of rows) {
    if (!originals.has(row.contentHash)) originals.set(row.contentHash, row.id);
  }
  return originals;
}

/** Новая публикация коннектора и ссылки её текста — отчёт енричера по порядку. */
export type NewPublicationToSave = {
  readonly publication: Readonly<
    Pick<
      NewPublicationRow,
      | 'sourceId'
      | 'connector'
      | 'externalId'
      | 'url'
      | 'content'
      | 'postedAt'
      | 'payload'
      | 'contentHash'
      | 'status'
      | 'authorId'
    >
  >;
  readonly links: readonly LinkToSave[];
};

/**
 * Пишет новые публикации коннектора и их ссылки (П10, П13 в packages/connectors/README.md). Публикация с тем
 * же `(connector, external_id)` пропускается в любом статусе, её ссылки не пишутся: уже
 * записанная не меняется. Ответ — id новых публикаций по `authorKey(connector, externalId)`.
 */
export async function addPublications(
  db: DbExecutor,
  rows: readonly NewPublicationToSave[],
): Promise<ReadonlyMap<string, string>> {
  if (rows.length === 0) return new Map();
  const saved = await db
    .insert(publications)
    .values(rows.map(({ publication }) => ({ ...publication })))
    .onConflictDoNothing({ target: [publications.connector, publications.externalId] })
    .returning({
      id: publications.id,
      connector: publications.connector,
      externalId: publications.externalId,
    });
  const ids = new Map(saved.map((row) => [authorKey(row.connector, row.externalId), row.id]));
  const links = rows.flatMap(({ publication, links: publicationLinksToSave }) => {
    const id = ids.get(authorKey(publication.connector, publication.externalId));
    return id === undefined ? [] : linkRows(id, publicationLinksToSave);
  });
  if (links.length > 0) await db.insert(publicationLinks).values(links);
  return ids;
}

/**
 * Итог разбора публикации: вакансия, не вакансия с причиной или дубль — все её роли уже
 * сохранены из других публикаций, `originalId` — публикация первой такой роли (П20). Пояснение
 * есть только у `trash`: пустой публикации объяснять нечего.
 */
export type PublicationOutcome =
  | { readonly status: 'vacancy' }
  | { readonly status: 'duplicate'; readonly originalId: string }
  | { readonly status: 'not_vacancy'; readonly reason: 'empty' }
  | { readonly status: 'not_vacancy'; readonly reason: 'trash'; readonly note: string };

/**
 * Пишет итог разбора (П12 в packages/connectors/README.md): статус, причину для `not_vacancy` и пояснение для
 * `trash`, оригинал для `duplicate`, `processed_at` — сейчас. Поля других итогов стираются.
 */
export async function setOutcome(
  db: DbExecutor,
  publicationId: string,
  outcome: PublicationOutcome,
): Promise<void> {
  await db
    .update(publications)
    .set({
      status: outcome.status,
      notVacancyReason: outcome.status === 'not_vacancy' ? outcome.reason : null,
      note: outcome.status === 'not_vacancy' && outcome.reason === 'trash' ? outcome.note : null,
      duplicateOfId: outcome.status === 'duplicate' ? outcome.originalId : null,
      processedAt: sql`now()`,
    })
    .where(eq(publications.id, publicationId));
}

/**
 * Пишет курсор источника (П9 в packages/connectors/README.md). Остальные столбцы — расписание опроса — пишет
 * движок.
 */
export async function saveCursor(db: DbExecutor, sourceId: string, cursor: unknown): Promise<void> {
  await db.update(sources).set({ cursor }).where(eq(sources.id, sourceId));
}

/**
 * Источник по id для движка: `undefined` — строки нет. Сбой базы — `Error`: движок отдаёт его
 * очереди, и та повторяет задание.
 */
export async function getSource(
  db: DbExecutor,
  id: string,
): Promise<Error | SourceRow | undefined> {
  return db
    .select()
    .from(sources)
    .where(eq(sources.id, id))
    .then(([row]) => row)
    .catch((cause: unknown) => new Error(`Reading source ${id} failed`, { cause }));
}

/** Поля расписания опроса источника. Какие из них писать, решает движок. */
export type SourceSchedule = Readonly<
  Partial<
    Pick<
      NewSourceRow,
      'lastFetchedAt' | 'lastSuccessAt' | 'consecutiveFailures' | 'lastError' | 'nextRunAt'
    >
  >
>;

/**
 * Пишет итог прохода `drain` (П9 в packages/db/src/monitoring/README.md): переданные поля расписания источника и
 * строку `source_runs` — одной транзакцией: она своя, поэтому нужен клиент, а не транзакция
 * вызывающего. Ничего не решает: поля, которого нет в `schedule`,
 * не меняет, `null` пишет как NULL; курсор не трогает — его пишет `saveCursor`. `Error` — сбой
 * базы: не записано ни расписание, ни строка истории.
 */
export async function recordDrain(
  db: Database,
  sourceId: string,
  schedule: SourceSchedule,
  run: SourceRunToSave,
): Promise<Error | undefined> {
  const written = await db
    .transaction(async (tx) => {
      await tx
        .update(sources)
        .set({ ...schedule })
        .where(eq(sources.id, sourceId));
      await tx.insert(sourceRuns).values({ ...run, sourceId });
    })
    .catch(
      (cause: unknown) => new Error(`Recording drain of source ${sourceId} failed`, { cause }),
    );
  if (written instanceof Error) return written;
  return undefined;
}
