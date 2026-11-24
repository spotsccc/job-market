import { ActorOutputError } from '@job-market/apify';
import type { ActorRunError, Apify, ApifyRequestError } from '@job-market/apify';
import { and, authors, db, eq, inArray, publications } from '@job-market/db';
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
const ACTIVITY_PATHS = [
  /^\/posts\/[^/]*-activity-(\d+)(?:-[^/]*)?\/?$/u,
  /^\/feed\/update\/urn:li:activity:(\d+)\/?$/u,
];

/**
 * `/posts/…-share-7523022657647177728-soyO`, `/feed/update/urn:li:share:7523022657647177728`:
 * так ведут ссылки lnkd.in. Share — другой id того же поста, не activity.
 */
const SHARE_PATHS = [
  /^\/posts\/[^/]*-share-(\d+)(?:-[^/]*)?\/?$/u,
  /^\/feed\/update\/urn:li:share:(\d+)\/?$/u,
];

/**
 * Id поста по share: в базе и в `post.id` актора посты лежат по activity, поэтому share
 * помечается, чтобы не спутать их.
 */
const SHARE_PREFIX = 'share:';

/**
 * Только поля, которые идут в раздел. Несуществующий пост актор отдаёт элементом с
 * `post.id: null` и пустым автором — он проходит схему и пропускается.
 */
const PostItemSchema = z.object({
  post: z.object({
    id: z.string().nullable(),
    text: z.string().nullish(),
    urn: z.object({ share_urn: z.string().nullish() }).nullish(),
  }),
  author: z
    .object({
      name: z.string().nullish(),
      profile_url: z.string().nullish(),
    })
    .nullish(),
});

type PostItem = z.infer<typeof PostItemSchema>;

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

/** Activity id поста или `share:<id>`. */
export function parsePostUrl(url: string): string | null {
  const path = linkedinPath(url);
  if (path === null) return null;
  for (const pattern of ACTIVITY_PATHS) {
    const id = pattern.exec(path)?.[1];
    if (id !== undefined) return id;
  }
  for (const pattern of SHARE_PATHS) {
    const id = pattern.exec(path)?.[1];
    if (id !== undefined) return `${SHARE_PREFIX}${id}`;
  }
  return null;
}

/** Что актор получает на вход: activity id как есть, share — ссылкой на него. */
function actorInput(id: string): string {
  return id.startsWith(SHARE_PREFIX)
    ? `https://www.linkedin.com/feed/update/urn:li:share:${id.slice(SHARE_PREFIX.length)}`
    : id;
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
    .leftJoin(authors, eq(authors.id, publications.authorId))
    .where(and(eq(publications.connector, 'linkedin'), inArray(publications.externalId, [...ids])));

  return new Map(
    rows.map((row) => [
      row.externalId,
      postBody({ name: row.authorName, url: row.authorUrl }, stripSections(row.content)),
    ]),
  );
}

/** Под каким id пост просили: activity или, если просили по share, `share:<share_urn>`. */
function requestedId(post: PostItem['post'], wanted: readonly string[]): string | null {
  if (post.id !== null && wanted.includes(post.id)) return post.id;
  const shareId = post.urn?.share_urn ?? null;
  if (shareId !== null && wanted.includes(`${SHARE_PREFIX}${shareId}`)) {
    return `${SHARE_PREFIX}${shareId}`;
  }
  return null;
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
      { post_urls: rest.map((id) => actorInput(id)) },
      { waitSecs: WAIT_SECS },
    );
    if (run instanceof Error) return run;

    for (const [index, item] of run.items.entries()) {
      const parsed = PostItemSchema.safeParse(item);
      if (!parsed.success) {
        return new ActorOutputError({ index, runId: run.runId, cause: parsed.error });
      }
      const { post, author } = parsed.data;
      const id = requestedId(post, rest);
      if (id === null) continue;
      const body = postBody(
        { name: author?.name ?? null, url: author?.profile_url ?? null },
        post.text ?? '',
      );
      if (body !== null) bodies.set(id, body);
    }
    return bodies;
  }

  return { kind: 'linkedin-post', label: 'Пост LinkedIn', parseUrl: parsePostUrl, fetch };
}
