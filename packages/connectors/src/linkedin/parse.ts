import { ActorRunError } from '@job-market/apify';

import type { ParsedAuthor, ParsedPublication, ParseInput, ParseResult } from '../contract.ts';
import type { LinkedinChannel, PostedLimit } from './channel.ts';
import type { LinkedinPost, LinkedinPostAuthor } from './parse-post.ts';

export type LinkedinConfig = {
  readonly queries: readonly string[];
  readonly maxPosts: number;
  readonly postedLimit?: PostedLimit | undefined;
  readonly sortBy?: 'relevance' | 'date' | undefined;
};

/** Курсор есть, только пока запуск поиска идёт: следующий опрос его дождётся (П5). */
export type LinkedinCursor = { readonly runId: string };

/** Дольше одного запроса к Apify ожидание не тянется: дальше — следующий опрос. */
const MAX_WAIT_SECS = 60;

/** Id автора (П7): `in/<handle>` у человека, путь страницы `company/<имя>` у компании. */
function authorId(author: LinkedinPostAuthor): string {
  if (author.publicIdentifier !== null) return `in/${author.publicIdentifier}`;
  const url = URL.parse(author.url);
  const path = url?.pathname.replaceAll(/^\/+|\/+$/gu, '') ?? '';
  return path === '' ? author.url : path;
}

function toAuthor(author: LinkedinPostAuthor): ParsedAuthor {
  return {
    externalId: authorId(author),
    name: author.name,
    url: author.url,
    headline: author.headline,
  };
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- в публикации `Date`, глубоко readonly его не сделать
function toPublication(post: LinkedinPost): ParsedPublication {
  return {
    externalId: post.id,
    url: post.url,
    content: post.content,
    publishedAt: post.postedAt,
    author: toAuthor(post.author),
  };
}

/**
 * Поиск постов LinkedIn через актор Apify (П4–П7). Без курсора запускает поиск, с курсором —
 * ждёт уже запущенный. Запуск не закончился до `deadline` — `more` и курсор `{ runId }`. Посты
 * старше `since` не берутся. Запуск закончился не `SUCCEEDED` — курсор сбрасывается, чтобы
 * следующий опрос начал новый поиск, и `error`; не запустился — `Error`.
 */
export async function parseLinkedin(
  channel: LinkedinChannel,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- в публикации `Date`, глубоко readonly его не сделать
  input: ParseInput<LinkedinConfig, LinkedinCursor>,
): Promise<Error | ParseResult<LinkedinCursor>> {
  if (Date.now() >= input.deadline) {
    return { publications: [], cursor: input.cursor, more: true };
  }

  let runId = input.cursor?.runId;
  if (runId === undefined) {
    const started = await channel.startSearch({
      queries: input.config.queries,
      maxPosts: input.config.maxPosts,
      postedLimit: input.config.postedLimit,
      sortBy: input.config.sortBy,
    });
    if (started instanceof Error) return started;
    runId = started;
  }

  const waitSecs = Math.min(
    MAX_WAIT_SECS,
    Math.max(0, Math.floor((input.deadline - Date.now()) / 1000)),
  );
  const posts = await channel.collectSearch(runId, waitSecs);
  if (posts === 'running') return { publications: [], cursor: { runId }, more: true };
  if (posts instanceof ActorRunError) {
    return { publications: [], cursor: null, more: false, error: posts };
  }
  if (posts instanceof Error) return posts;

  const since = input.since.getTime();
  return {
    publications: posts
      // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- в публикации `Date`, глубоко readonly его не сделать
      .filter((post) => post.postedAt.getTime() >= since)
      // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- в сообщении и публикации `Date`, глубоко readonly его не сделать
      .map((post) => toPublication(post)),
    cursor: null,
    more: false,
  };
}
