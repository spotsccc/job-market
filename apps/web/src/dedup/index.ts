import type { PostSource } from '@job-market/core';
import { and, db, eq, inArray, posts } from '@job-market/db';

/**
 * Какие из постов источника `source` уже есть в базе. Возвращает их `externalId` —
 * такие посты повторно не разбираем. Один запрос на всю пачку.
 */
export async function findSavedPosts(
  source: PostSource,
  externalIds: readonly string[],
): Promise<Error | ReadonlySet<string>> {
  if (externalIds.length === 0) return new Set();
  // `async`-обёртка: `db` бросает синхронно, если не задан DATABASE_URL, — `.catch` ниже ловит и это.
  async function query(): Promise<ReadonlySet<string>> {
    const rows = await db
      .select({ externalId: posts.externalId })
      .from(posts)
      .where(and(eq(posts.source, source), inArray(posts.externalId, [...externalIds])));
    return new Set(rows.map((row) => row.externalId));
  }
  return query().catch(
    (cause: unknown) => new Error(`Looking up saved ${source} posts failed`, { cause }),
  );
}
