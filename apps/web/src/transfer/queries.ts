import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  legacyPosts,
  or,
  publications,
  sources,
  sql,
} from '@job-market/db';
import type { DbExecutor, LegacyPostRow } from '@job-market/db';

import type { MappedPost } from './map-post.ts';

/** После стольких неудачных попыток пост больше не берётся (П1, П6). */
export const MAX_ATTEMPTS = 3;

/** Где остановилась прошлая пачка запуска. */
export type Cursor = { readonly postedAt: Date; readonly id: string };

/**
 * Следующая пачка (П1): посты без публикации или с публикацией `failed` и попыток меньше
 * трёх, после курсора по `(posted_at, id)`, от старых к новым. Курсор не даёт взять пост
 * дважды за запуск — и в пробном, где публикаций не остаётся.
 */
export async function nextBatch(
  db: DbExecutor,
  after: Cursor | null,
  size: number,
): Promise<LegacyPostRow[]> {
  const rows = await db
    .select({ post: legacyPosts })
    .from(legacyPosts)
    .leftJoin(publications, eq(publications.id, legacyPosts.id))
    .where(
      and(
        or(
          isNull(publications.id),
          and(eq(publications.status, 'failed'), sql`${publications.attempts} < ${MAX_ATTEMPTS}`),
        ),
        after === null
          ? undefined
          : sql`(${legacyPosts.postedAt}, ${legacyPosts.id}) > (${after.postedAt.toISOString()}::timestamptz, ${after.id}::uuid)`,
      ),
    )
    .orderBy(asc(legacyPosts.postedAt), asc(legacyPosts.id))
    .limit(size);
  return rows.map((row) => row.post);
}

/** Ключ источника в ответе `sourceIds`. */
export function sourceKey(source: MappedPost['source']): string {
  return `${source.connector}:${source.key}`;
}

/** Id источников пачки по `sourceKey`: их заводит миграция `0010_occupations_sources`. */
export async function sourceIds(
  db: DbExecutor,
  posts: readonly MappedPost[],
): Promise<ReadonlyMap<string, string>> {
  const keys = [...new Set(posts.map((post) => post.source.key))];
  const rows = await db
    .select({ id: sources.id, connector: sources.connector, key: sources.key })
    .from(sources)
    .where(inArray(sources.key, keys));
  return new Map(rows.map((row) => [sourceKey(row), row.id]));
}
