import { ActorOutputError } from '@job-market/apify';
import type { ActorRunError, Apify, ApifyRequestError } from '@job-market/apify';
import { and, authors, db, eq, inArray, publications, sources } from '@job-market/db';
import { log } from '@job-market/logger';
import { z } from 'zod';

import type { Reader } from '../reader.ts';
import { stripSections } from '../section.ts';
import { linkedinPath } from './linkedin-url.ts';

/** https://apify.com/apimaestro/linkedin-post-detail — выбран в spike Э0. */
export const LINKEDIN_POST_ACTOR_ID = 'apimaestro~linkedin-post-detail';

const WAIT_SECS = 60;

const moduleLog = log.with({ module: 'enricher', reader: 'linkedin-post' });

/** `/posts/twinby_…-activity-7525883513603076096-IOJy`, `/feed/update/urn:li:activity:7302346926123798528`. */
const POST_PATHS = [
  /^\/posts\/[^/]*-activity-(\d+)(?:-[^/]*)?\/?$/u,
  /^\/feed\/update\/urn:li:activity:(\d+)\/?$/u,
];

/**
 * Только поля, которые идут в раздел. Несуществующий пост актор отдаёт элементом с
 * `post.id: null` и пустым автором — он проходит схему и пропускается.
 */
const PostItemSchema = z.object({
  post: z.object({
    id: z.string().nullable(),
    text: z.string().nullish(),
  }),
  author: z
    .object({
      name: z.string().nullish(),
      profile_url: z.string().nullish(),
    })
    .nullish(),
});

type PostAuthor = { readonly name: string | null; readonly url: string | null };

/** Строка автора и текст поста — одинаково для поста из базы и от актора. */
function postBody(author: PostAuthor | null, text: string): string | null {
  const content = text.trim();
  if (content === '') return null;
  const name = author?.name?.trim() ?? '';
  if (name === '') return content;
  const url = author?.url?.trim() ?? '';
  return `${url === '' ? name : `${name} (${url})`}\n${content}`;
}

export function parsePostUrl(url: string): string | null {
  const path = linkedinPath(url);
  if (path === null) return null;
  for (const pattern of POST_PATHS) {
    const id = pattern.exec(path)?.[1];
    if (id !== undefined) return id;
  }
  return null;
}

/**
 * Посты, которые уже собрал коннектор linkedin: id → тело раздела. Пост без текста тоже
 * попадает в ответ — `null`, актор его не прочитает лучше.
 */
async function postsFromDb(ids: readonly string[]): Promise<Map<string, string | null>> {
  const rows = await db
    .select({
      externalId: publications.externalId,
      content: publications.content,
      authorName: authors.name,
      authorUrl: authors.url,
    })
    .from(publications)
    .innerJoin(sources, eq(sources.id, publications.sourceId))
    .leftJoin(authors, eq(authors.id, publications.authorId))
    .where(
      and(
        eq(sources.connector, 'linkedin'),
        eq(publications.platform, 'linkedin'),
        inArray(publications.externalId, [...ids]),
      ),
    );

  return new Map(
    rows.map((row) => [
      row.externalId,
      postBody({ name: row.authorName, url: row.authorUrl }, stripSections(row.content)),
    ]),
  );
}

/**
 * Читатель постов LinkedIn: сначала посты, которые уже есть в базе, остальные — одним
 * запуском актора.
 */
export function createLinkedinPostReader(apify: Apify): Reader {
  async function fetch(
    ids: readonly string[],
  ): Promise<ApifyRequestError | ActorRunError | ActorOutputError | ReadonlyMap<string, string>> {
    const bodies = new Map<string, string>();

    let known: Error | Map<string, string | null> = await postsFromDb(ids).catch(
      (cause: unknown) => new Error('LinkedIn posts lookup failed', { cause }),
    );
    if (known instanceof Error) {
      // Без базы посты всё равно читаются — актором; решение принято здесь, поэтому и запись.
      moduleLog.warn('LinkedIn posts lookup failed, reading them with the actor', {
        err: known,
      });
      known = new Map();
    }
    for (const [id, body] of known) {
      if (body !== null) bodies.set(id, body);
    }

    const rest = ids.filter((id) => !known.has(id));
    if (rest.length === 0) return bodies;

    const run = await apify.runActor(
      LINKEDIN_POST_ACTOR_ID,
      { post_urls: rest },
      { waitSecs: WAIT_SECS },
    );
    if (run instanceof Error) return run;

    const wanted = new Set(rest);
    for (const [index, item] of run.items.entries()) {
      const parsed = PostItemSchema.safeParse(item);
      if (!parsed.success) {
        return new ActorOutputError({ index, runId: run.runId, cause: parsed.error });
      }
      const { post, author } = parsed.data;
      if (post.id === null || !wanted.has(post.id)) continue;
      const body = postBody(
        { name: author?.name ?? null, url: author?.profile_url ?? null },
        post.text ?? '',
      );
      if (body !== null) bodies.set(post.id, body);
    }
    return bodies;
  }

  return { kind: 'linkedin-post', label: 'Пост LinkedIn', parseUrl: parsePostUrl, fetch };
}
