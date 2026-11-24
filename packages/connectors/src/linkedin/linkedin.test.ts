import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ActorRunError, ApifyRequestError } from '@job-market/apify';
import type { RunningRun } from '@job-market/apify';

import { DEPTH_DAYS } from '../contract.ts';
import type { ParseResult, Processor } from '../contract.ts';
import type { LinkedinChannel, LinkedinChannelError, SearchPostsOptions } from './channel.ts';
import { linkedin } from './index.ts';
import type { LinkedinPost } from './parse-post.ts';
import type { LinkedinCursor } from './parse.ts';

const NOW = new Date('2026-11-20T12:00:00.000Z');
const SINCE = new Date(NOW.getTime() - DEPTH_DAYS * 24 * 60 * 60 * 1000);
const CONFIG = { queries: ['hiring react developer'], maxPosts: 50 };

const process: Processor = () => Promise.resolve(new Error('not used'));

function post(id: number, overrides: Partial<LinkedinPost> = {}): LinkedinPost {
  return {
    id: String(7_330_988_768_578_920_000 + id),
    url: `https://www.linkedin.com/posts/jane-doe_hiring-activity-${String(id)}`,
    content: `Hiring #${String(id)}`,
    postedAt: new Date(NOW.getTime() - 24 * 60 * 60 * 1000),
    author: {
      name: 'Jane Doe',
      url: 'https://www.linkedin.com/in/jane-doe',
      headline: 'Hiring at Acme',
      publicIdentifier: 'jane-doe',
    },
    ...overrides,
  };
}

type Collected = LinkedinChannelError | RunningRun | readonly LinkedinPost[];

/** Поддельный канал: запуск отдаёт `run-1`, ожидание — заданный ответ. */
function fakeChannel(collected: Collected): LinkedinChannel & {
  readonly started: SearchPostsOptions[];
  readonly collected: string[];
} {
  const started: SearchPostsOptions[] = [];
  const collectedRuns: string[] = [];
  return {
    started,
    collected: collectedRuns,
    startSearch: (options) => {
      started.push(options);
      return Promise.resolve('run-1');
    },
    collectSearch: (runId) => {
      collectedRuns.push(runId);
      return Promise.resolve(collected);
    },
  };
}

async function parse(
  channel: LinkedinChannel,
  cursor: LinkedinCursor | null = null,
  deadline = Date.now() + 60_000,
): Promise<Error | ParseResult<LinkedinCursor>> {
  return linkedin({ linkedin: channel, process }).parse({
    config: CONFIG,
    cursor,
    key: 'manual',
    since: SINCE,
    deadline,
  });
}

describe('linkedin parse', () => {
  test('a finished search gives its posts and no cursor', async () => {
    const channel = fakeChannel(Array.from({ length: 30 }, (_, index) => post(index)));

    const result = await parse(channel);

    assert.ok(!(result instanceof Error));
    assert.equal(result.publications.length, 30);
    assert.equal(result.cursor, null);
    assert.equal(result.more, false);
    assert.deepEqual(channel.started, [
      { queries: CONFIG.queries, maxPosts: 50, postedLimit: undefined, sortBy: undefined },
    ]);
  });

  test('a search longer than the deadline returns its run id to wait for next time', async () => {
    const channel = fakeChannel('running');

    const result = await parse(channel);

    assert.deepEqual(result, { publications: [], cursor: { runId: 'run-1' }, more: true });
  });

  test('a call with the run id waits for that run and does not start a new one', async () => {
    const channel = fakeChannel([post(1)]);

    const result = await parse(channel, { runId: 'run-7' });

    assert.ok(!(result instanceof Error));
    assert.equal(result.publications.length, 1);
    assert.equal(channel.started.length, 0);
    assert.deepEqual(channel.collected, ['run-7']);
  });

  test('a failed run drops the cursor, so the next call starts a new search', async () => {
    const channel = fakeChannel(new ActorRunError({ runId: 'run-7', status: 'FAILED' }));

    const result = await parse(channel, { runId: 'run-7' });

    assert.ok(!(result instanceof Error));
    assert.ok(result.error instanceof ActorRunError);
    assert.equal(result.cursor, null);
  });

  test('a search that does not start is an Error', async () => {
    const channel: LinkedinChannel = {
      startSearch: () =>
        Promise.resolve(
          new ApifyRequestError({
            actorId: 'harvestapi~linkedin-post-search',
            cause: new Error('402'),
          }),
        ),
      collectSearch: () => Promise.resolve([]),
    };

    assert.ok((await parse(channel)) instanceof ApifyRequestError);
  });

  test('after the deadline no search is started', async () => {
    const channel = fakeChannel([post(1)]);

    const result = await parse(channel, null, Date.now() - 1);

    assert.deepEqual(result, { publications: [], cursor: null, more: true });
    assert.equal(channel.started.length, 0);
  });

  test('maps a post: id without prefix, author by profile path with headline', async () => {
    const company = post(2, {
      author: {
        name: 'Acme',
        url: 'https://www.linkedin.com/company/acme/',
        headline: null,
        publicIdentifier: null,
      },
    });
    const old = post(3, { postedAt: new Date(SINCE.getTime() - 1) });

    const result = await parse(fakeChannel([post(1), company, old]));

    assert.ok(!(result instanceof Error));
    assert.deepEqual(result.publications, [
      {
        externalId: post(1).id,
        url: post(1).url,
        content: 'Hiring #1',
        publishedAt: post(1).postedAt,
        author: {
          externalId: 'in/jane-doe',
          name: 'Jane Doe',
          url: 'https://www.linkedin.com/in/jane-doe',
          headline: 'Hiring at Acme',
        },
      },
      {
        externalId: company.id,
        url: company.url,
        content: 'Hiring #2',
        publishedAt: company.postedAt,
        author: {
          externalId: 'company/acme',
          name: 'Acme',
          url: 'https://www.linkedin.com/company/acme/',
          headline: null,
        },
      },
    ]);
  });

  test('config takes 1 to 100 posts and at least one query', () => {
    const { configSchema } = linkedin({ linkedin: fakeChannel([]), process });

    assert.equal(configSchema.safeParse(CONFIG).success, true);
    assert.equal(configSchema.safeParse({ ...CONFIG, maxPosts: 101 }).success, false);
    assert.equal(configSchema.safeParse({ ...CONFIG, maxPosts: 0 }).success, false);
    assert.equal(configSchema.safeParse({ ...CONFIG, queries: [] }).success, false);
    assert.equal(configSchema.safeParse({}).success, false);
  });
});
