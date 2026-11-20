import { tryAsync } from '@spotsccc/error-as-value';
import { ApifyClient } from 'apify-client';

import { ActorOutputError } from './errors/actor-output-error.ts';
import { ActorRunError } from './errors/actor-run-error.ts';
import { ApifyRequestError } from './errors/apify-request-error.ts';
import { parsePost } from './parse-post.ts';
import type { LinkedinPost } from './parse-post.ts';

/** https://apify.com/harvestapi/linkedin-post-search */
export const LINKEDIN_POST_SEARCH_ACTOR_ID = 'harvestapi~linkedin-post-search';

const DEFAULT_MAX_POSTS = 100;

export type LinkedinChannelOptions = {
  readonly token: string;
  /** По умолчанию `https://api.apify.com`. */
  readonly baseUrl?: string;
  /** Повторы при 429, 5xx и сетевых ошибках, по умолчанию 8. */
  readonly maxRetries?: number;
  /** По умолчанию `harvestapi~linkedin-post-search`. Другой актор должен отдавать тот же вывод. */
  readonly actorId?: string;
};

/** Окно публикации, значения из схемы входа актора. */
export type PostedLimit = '1h' | '24h' | 'week' | 'month';

export type SearchPostsOptions = {
  /**
   * Запросы как в строке поиска LinkedIn: до 500 символов и 5 операторов AND/OR/NOT.
   * Каждый запрос — отдельный поиск, LinkedIn отдаёт по нему не больше 400–500 постов.
   */
  readonly queries: readonly string[];
  /**
   * Максимум постов на запрос, по умолчанию 100. Целое от 1: ноль у актора значит
   * «все», а платим за каждый пост.
   */
  readonly maxPosts?: number;
  readonly postedLimit?: PostedLimit;
  /** `date` — сначала новые. По умолчанию решает актор (релевантность). */
  readonly sortBy?: 'relevance' | 'date';
  /** Сколько секунд ждать окончания запуска. Без него ждём, пока запуск не закончится. */
  readonly waitSecs?: number;
};

export type LinkedinChannelError = ApifyRequestError | ActorRunError | ActorOutputError;

export type LinkedinChannel = {
  /** Запускает поиск постов, ждёт окончания и читает весь датасет запуска. */
  readonly searchPosts: (
    options: SearchPostsOptions,
  ) => Promise<LinkedinChannelError | readonly LinkedinPost[]>;
};

function buildInput(options: SearchPostsOptions): Record<string, unknown> {
  const maxPosts = options.maxPosts ?? DEFAULT_MAX_POSTS;
  if (!Number.isInteger(maxPosts) || maxPosts < 1) {
    throw new RangeError(`maxPosts must be a positive integer, got ${String(maxPosts)}`);
  }
  if (options.queries.length === 0) throw new RangeError('queries must not be empty');

  return {
    searchQueries: options.queries,
    maxPosts,
    ...(options.postedLimit === undefined ? {} : { postedLimit: options.postedLimit }),
    ...(options.sortBy === undefined ? {} : { sortBy: options.sortBy }),
    profileScraperMode: 'short',
    // Реакции и комментарии оплачиваются как отдельные посты и приходят другими элементами.
    scrapeReactions: false,
    scrapeComments: false,
  };
}

function parsePosts(items: readonly unknown[], runId: string): ActorOutputError | LinkedinPost[] {
  const posts: LinkedinPost[] = [];
  for (const [index, item] of items.entries()) {
    const post = parsePost(item);
    if (post instanceof Error) return new ActorOutputError({ index, runId, cause: post });
    if (post !== null) posts.push(post);
  }
  return posts;
}

export function createLinkedinChannel(options: LinkedinChannelOptions): LinkedinChannel {
  const actorId = options.actorId ?? LINKEDIN_POST_SEARCH_ACTOR_ID;
  const client = new ApifyClient({
    token: options.token,
    ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
    ...(options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries }),
  });

  async function searchPosts(
    searchOptions: SearchPostsOptions,
  ): Promise<LinkedinChannelError | readonly LinkedinPost[]> {
    const input = buildInput(searchOptions);

    const run = await client
      .actor(actorId)
      .call(input, {
        log: null,
        ...(searchOptions.waitSecs === undefined ? {} : { waitSecs: searchOptions.waitSecs }),
      })
      .catch((cause: unknown) => new ApifyRequestError({ actorId, cause }));
    if (run instanceof Error) return run;

    if (run.status !== 'SUCCEEDED') {
      return new ActorRunError({ runId: run.id, status: run.status });
    }

    // Итератор сам листает страницы датасета и бросает при ошибке запроса.
    const items = await tryAsync(
      async (): Promise<unknown[]> => {
        const collected: unknown[] = [];
        for await (const item of client.dataset(run.defaultDatasetId).listItems()) {
          collected.push(item);
        }
        return collected;
      },
      (cause: unknown) => new ApifyRequestError({ actorId, cause }),
    );
    if (items instanceof Error) return items;

    return parsePosts(items, run.id);
  }

  return { searchPosts };
}
