'use server';

import { createLinkedinChannel } from '@job-market/channel-linkedin';
import type { LinkedinPost, SearchPostsOptions } from '@job-market/channel-linkedin';
import { log as rootLog } from '@job-market/logger';
import { z } from 'zod';

import { MAX_POSTS_LIMIT, POSTED_LIMITS, SORT_OPTIONS } from './search-state.ts';
import type { PostView, SearchState } from './search-state.ts';

const TOKEN_ENV = 'LINKEDINN_CHANNEL_KEY';

const log = rootLog.with({ module: 'linkedin', action: 'searchLinkedinPosts' });

/** Пустое значение `<select>` — «не задано». */
function optionalEnum<const T extends readonly [string, ...string[]]>(values: T) {
  return z.preprocess((value) => (value === '' ? undefined : value), z.enum(values).optional());
}

const MAX_POSTS_MESSAGE = `Постов на запрос — целое от 1 до ${String(MAX_POSTS_LIMIT)}`;

const searchInputSchema = z.object({
  queries: z
    .string()
    .transform((value) =>
      value
        .split('\n')
        .map((query) => query.trim())
        .filter((query) => query !== ''),
    )
    .pipe(
      z
        .array(z.string().max(500, 'Запрос длиннее 500 символов'))
        .min(1, 'Введите хотя бы один запрос'),
    ),
  maxPosts: z.coerce
    .number()
    .int(MAX_POSTS_MESSAGE)
    .min(1, MAX_POSTS_MESSAGE)
    .max(MAX_POSTS_LIMIT, MAX_POSTS_MESSAGE),
  postedLimit: optionalEnum(POSTED_LIMITS),
  sortBy: optionalEnum(SORT_OPTIONS),
}) satisfies z.ZodType<SearchPostsOptions>;

function toView(post: LinkedinPost): PostView {
  return {
    id: post.id,
    url: post.url,
    content: post.content,
    postedAt: post.postedAt.toISOString(),
    authorName: post.author.name,
    authorUrl: post.author.url,
    authorHeadline: post.author.headline,
  };
}

function describeError(error: Readonly<Error>): string {
  const cause = error.cause instanceof Error ? `: ${error.cause.message}` : '';
  return `${error.message}${cause}`;
}

export async function searchLinkedinPosts(
  _previous: SearchState,
  formData: Readonly<FormData>,
): Promise<SearchState> {
  const token = process.env[TOKEN_ENV];
  if (token === undefined || token === '') {
    log.error('LinkedIn token is not set', { env: TOKEN_ENV });
    return { status: 'error', message: `Не задан ${TOKEN_ENV}` };
  }

  const parsed = searchInputSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? 'Некорректный ввод';
    log.warn('Invalid LinkedIn search input', { reason: message });
    return { status: 'error', message };
  }
  const options = parsed.data;

  const startedAt = Date.now();
  const posts = await createLinkedinChannel({ token }).searchPosts(options);
  const elapsedMs = Date.now() - startedAt;
  if (posts instanceof Error) {
    log.error('LinkedIn post search failed', {
      err: posts,
      queries: options.queries,
      elapsedMs,
    });
    return { status: 'error', message: describeError(posts) };
  }

  log.info('LinkedIn post search done', {
    queries: options.queries,
    maxPosts: options.maxPosts,
    postsCount: posts.length,
    elapsedMs,
  });
  return { status: 'ok', posts: posts.map((post) => toView(post)), elapsedMs };
}
