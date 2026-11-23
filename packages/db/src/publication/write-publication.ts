import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import type { DbExecutor } from '../client.ts';
import type { NewAuthorRow } from './author.ts';
import { authors } from './author.ts';
import type { NewPublicationRow } from './publication.ts';
import { publications } from './publication.ts';
import type { Connector } from './values.ts';

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
