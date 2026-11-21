'use server';

import { createLinkedinChannel } from '@job-market/channel-linkedin';
import type { LinkedinPost, SearchPostsOptions } from '@job-market/channel-linkedin';
import { log as rootLog } from '@job-market/logger';
import { z } from 'zod';

import { findSavedPosts } from '../../dedup/index.ts';
import { mapConcurrent } from '../../map-concurrent.ts';
import { processPost, savePostWithVacancies } from '../../post-processing/index.ts';
import type { Post } from '../../post-processing/index.ts';
import { MAX_POSTS_LIMIT, POSTED_LIMITS, SORT_OPTIONS } from './search-state.ts';
import type { PostVerdictView, PostView, SearchState } from './search-state.ts';

const TOKEN_ENV = 'LINKEDINN_CHANNEL_KEY';

const log = rootLog.with({ module: 'linkedin', action: 'searchLinkedinPosts' });

/** Сколько постов разбираем моделями одновременно: держимся в лимитах AI Gateway. */
const PROCESSING_CONCURRENCY = 5;

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

function toView(post: LinkedinPost, verdict: PostVerdictView): PostView {
  return {
    id: post.id,
    url: post.url,
    content: post.content,
    postedAt: post.postedAt.toISOString(),
    authorName: post.author.name,
    authorUrl: post.author.url,
    authorHeadline: post.author.headline,
    verdict,
  };
}

function toPost(post: LinkedinPost): Post {
  return {
    source: 'linkedin',
    externalId: post.id,
    url: post.url,
    content: post.content,
    postedAt: post.postedAt,
    authorName: post.author.name,
    authorUrl: post.author.url,
    authorHeadline: post.author.headline,
    authorHandle: post.author.publicIdentifier,
  };
}

type PostOutcome = { readonly verdict: PostVerdictView; readonly savedVacancies: number };

/** Разбирает пост моделями и сохраняет вакансию в базу. Ошибки логирует и не пробрасывает. */
async function processAndSave(post: LinkedinPost): Promise<PostOutcome> {
  const postLog = log.with({ postId: post.id, postUrl: post.url });

  const processed = await processPost(toPost(post));
  if (processed instanceof Error) {
    postLog.error('LinkedIn post processing failed', { err: processed });
    return { verdict: { status: 'error' }, savedVacancies: 0 };
  }
  if (processed.kind === 'not_vacancy') {
    postLog.debug('LinkedIn post is not a vacancy', {
      reason: processed.reason,
      note: processed.note,
    });
    return { verdict: { status: 'not_vacancy', note: processed.note }, savedVacancies: 0 };
  }

  const saved = await savePostWithVacancies(processed.post, processed.vacancies);
  if (saved instanceof Error) {
    postLog.error('LinkedIn vacancy save failed', { err: saved });
    return { verdict: { status: 'error' }, savedVacancies: 0 };
  }
  postLog.info('LinkedIn vacancy saved', {
    dbPostId: saved,
    vacanciesCount: processed.vacancies.length,
  });
  return {
    verdict: { status: 'vacancy', titles: processed.vacancies.map((vacancy) => vacancy.title) },
    savedVacancies: processed.vacancies.length,
  };
}

function describeError(error: Readonly<Error>): string {
  const cause = error.cause instanceof Error ? `: ${error.cause.message}` : '';
  return `${error.message}${cause}`;
}

type ProcessedPosts = Pick<
  Extract<SearchState, { status: 'ok' }>,
  'posts' | 'savedVacancies' | 'failedPosts'
>;

async function processPosts(posts: readonly LinkedinPost[]): Promise<ProcessedPosts> {
  // Разные запросы находят одни и те же посты: разбираем каждый один раз.
  const uniquePosts = [...new Map(posts.map((post) => [post.id, post])).values()];

  // Посты, которые уже есть в базе, моделями повторно не разбираем.
  const lookup = await findSavedPosts(
    'linkedin',
    uniquePosts.map((post) => post.id),
  );
  // Без дедупликации разбираем всё: сохранение — upsert, дублей в базе не будет.
  if (lookup instanceof Error) log.error('LinkedIn dedup lookup failed', { err: lookup });
  const known: ReadonlySet<string> = lookup instanceof Error ? new Set() : lookup;
  if (known.size > 0) log.info('LinkedIn posts already saved, skipping', { count: known.size });

  const outcomes = await mapConcurrent(
    uniquePosts,
    PROCESSING_CONCURRENCY,
    async (post): Promise<PostOutcome> =>
      known.has(post.id)
        ? { verdict: { status: 'duplicate' }, savedVacancies: 0 }
        : processAndSave(post),
  );
  return {
    posts: uniquePosts.map((post, index) =>
      toView(post, outcomes[index]?.verdict ?? { status: 'error' }),
    ),
    savedVacancies: outcomes.reduce((sum, outcome) => sum + outcome.savedVacancies, 0),
    failedPosts: outcomes.filter((outcome) => outcome.verdict.status === 'error').length,
  };
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

  const processed = await processPosts(posts);
  const totalElapsedMs = Date.now() - startedAt;
  log.info('LinkedIn posts processed', {
    postsCount: processed.posts.length,
    savedVacancies: processed.savedVacancies,
    failedPosts: processed.failedPosts,
    elapsedMs: totalElapsedMs,
  });
  return { status: 'ok', ...processed, elapsedMs: totalElapsedMs };
}
