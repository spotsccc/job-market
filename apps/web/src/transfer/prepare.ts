import { contentHash, findOriginals, listOccupations } from '@job-market/db';
import type { DbExecutor, LegacyPostRow, VacancyToSave } from '@job-market/db';
import { enrich } from '@job-market/enricher';
import type { Reader } from '@job-market/enricher';
import { extract } from '@job-market/extractor';
import type { ExtractedRole, OccupationNode } from '@job-market/extractor';
import { locateVacancies } from '@job-market/geo/server';
import type { LocatedPlaces } from '@job-market/geo/server';
import { NoObjectGeneratedError } from 'ai';
import type { LanguageModel } from 'ai';

import { mapPost } from './map-post.ts';
import type { Prepared } from './outcome.ts';
import type { TransferSummary } from './summary.ts';

/** Столько вызовов экстрактора идут одновременно. */
const EXTRACT_CONCURRENCY = 5;

export type PrepareOptions = {
  readonly readers: readonly Reader[];
  readonly model: LanguageModel | undefined;
};

/** Задачи по `limit` одновременно; ответы — в порядке задач. */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Map<number, R>();
  let next = 0;
  async function worker(): Promise<void> {
    for (let index = next; index < items.length; index = next) {
      next += 1;
      const item = items[index];
      // oxlint-disable-next-line no-await-in-loop -- воркер берёт задачи по одной
      if (item !== undefined) results.set(index, await run(item));
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => worker()));
  return items.flatMap((_, index) => {
    const result = results.get(index);
    return result === undefined ? [] : [result];
  });
}

/**
 * Посты пачки с текстом после енричера (П8). Ссылка, которая не прочиталась, поста не
 * останавливает: он идёт в экстрактор без её раздела, а статус ссылки пишется в
 * `publication_links`. Хэш — по тексту поста без разделов (П8; П4,
 * packages/db/src/publication/README.md).
 */
async function enrichPosts(
  posts: readonly LegacyPostRow[],
  readers: readonly Reader[],
  summary: TransferSummary,
): Promise<Prepared[]> {
  const enriched = await enrich(
    posts.map((post) => post.content),
    { readers },
  );
  return posts.map((post, index) => {
    const enrichment = enriched[index];
    const links = enrichment?.links ?? [];
    for (const link of links) summary.links[link.status] += 1;
    return {
      post,
      mapped: mapPost(post),
      content: enrichment?.text ?? post.content,
      hash: contentHash(post.content),
      links,
      outcome: { kind: 'pending' },
    };
  });
}

/**
 * Итоги без модели: пустой текст (П5) и копии (П4, E7). Оригинал ищется в базе и среди
 * записанного раньше в этом запуске; первая копия хэша в пачке идёт в экстрактор, остальные
 * ждут её итог. Ответ — посты для экстрактора.
 */
async function settleWithoutModel(
  db: DbExecutor,
  prepared: readonly Prepared[],
  runOriginals: ReadonlyMap<string, string>,
): Promise<Prepared[]> {
  const originals = await findOriginals(
    db,
    prepared.map((item) => item.hash),
  );
  const leaders = new Map<string, string>();
  const toExtract: Prepared[] = [];
  for (const item of prepared.filter((candidate) => candidate.outcome.kind === 'pending')) {
    const original = originals.get(item.hash) ?? runOriginals.get(item.hash);
    const leader = leaders.get(item.hash);
    if (item.post.content.trim() === '') {
      item.outcome = { kind: 'not_vacancy', reason: 'empty' };
    } else if (original !== undefined) {
      item.outcome = { kind: 'duplicate', originalId: original };
    } else if (leader === undefined) {
      leaders.set(item.hash, item.post.id);
      toExtract.push(item);
    } else {
      item.outcome = { kind: 'follower', leaderId: leader };
    }
  }
  return toExtract;
}

type Found = { readonly item: Prepared; readonly roles: readonly ExtractedRole[] };

/** Экстрактор для оригиналов пачки: ошибка, в том числе ответ без ролей, — `failed` (П5, П6). */
async function extractRoles(
  db: DbExecutor,
  toExtract: readonly Prepared[],
  model: LanguageModel | undefined,
): Promise<Found[]> {
  const occupations: readonly OccupationNode[] = (await listOccupations(db)).map((node) => ({
    id: node.id,
    parentId: node.parentId,
    name: node.name,
    description: node.description,
    archived: node.archivedAt !== null,
  }));
  const extracted = await mapLimit(toExtract, EXTRACT_CONCURRENCY, async (item) =>
    extract(
      {
        connector: item.mapped.publication.connector,
        content: item.content,
        postedAt: item.post.postedAt,
        author: {
          name: item.post.authorName,
          url: item.post.authorUrl,
          headline: item.post.authorHeadline,
        },
      },
      { occupations, ...(model === undefined ? {} : { model }) },
    ),
  );
  return toExtract.flatMap((item, index) => {
    const result = extracted[index];
    if (result === undefined) return [];
    if (result instanceof Error) {
      // Модель ответила, но не по схеме (например, без ролей, П5): вызов сам по себе прошёл.
      const rejected = NoObjectGeneratedError.isInstance(result.cause);
      item.outcome = { kind: 'failed', error: result, fromModel: !rejected };
      return [];
    }
    return [{ item, roles: result }];
  });
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

/**
 * Места всех ролей пачки — одним вызовом справочника; его сбой — ошибка всех постов (П6; П16,
 * packages/extractor/README.md).
 */
async function locateRoles(db: DbExecutor, found: readonly Found[]): Promise<void> {
  const located = await locateVacancies(
    db,
    found.flatMap(({ roles }) => roles),
  );
  let offset = 0;
  for (const { item, roles } of found) {
    if (located instanceof Error) {
      item.outcome = { kind: 'failed', error: located, fromModel: false };
      continue;
    }
    const places = located.slice(offset, offset + roles.length);
    offset += roles.length;
    item.outcome = {
      kind: 'vacancy',
      roles: roles.flatMap((role, index) => {
        const rolePlaces = places[index];
        return rolePlaces === undefined ? [] : [toVacancy(role, rolePlaces)];
      }),
    };
  }
}

/**
 * Итог каждого поста пачки до записи: текст с разделами (П8), пустой текст и копии без
 * модели (П4, П5), экстрактор и справочник (П6; П16, packages/extractor/README.md). В базу
 * ничего не пишет.
 */
export async function prepareBatch(
  db: DbExecutor,
  posts: readonly LegacyPostRow[],
  options: PrepareOptions,
  runOriginals: ReadonlyMap<string, string>,
  summary: TransferSummary,
): Promise<readonly Prepared[]> {
  const prepared = await enrichPosts(posts, options.readers, summary);
  const toExtract = await settleWithoutModel(db, prepared, runOriginals);
  const found = await extractRoles(db, toExtract, options.model);
  await locateRoles(db, found);
  return prepared;
}
