import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { after, before, beforeEach, describe, test } from 'node:test';

import { ApifyApiError } from 'apify-client';

import { createLinkedinChannel } from './channel.ts';
import { ActorOutputError } from './errors/actor-output-error.ts';
import { ActorRunError } from './errors/actor-run-error.ts';
import { ApifyRequestError } from './errors/apify-request-error.ts';

/** Пример элемента из документации актора, длинные строки укорочены. */
function postItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'post',
    id: '7330988768578920448',
    linkedinUrl:
      'https://www.linkedin.com/posts/nickbennett05_hiring-activity-7330988768578920448-Je01',
    content: "I'm #hiring. See the details below.",
    author: {
      universalName: null,
      publicIdentifier: 'nickbennett05',
      type: 'profile',
      name: 'Nick Bennett',
      linkedinUrl: 'https://www.linkedin.com/in/nickbennett05',
      info: 'UX Leadership at Amazon',
      website: null,
      websiteLabel: null,
      avatar: {
        url: 'https://media.licdn.com/x',
        width: 674,
        height: 674,
        expiresAt: 1748552400000,
      },
    },
    postedAt: {
      timestamp: 1747843925614,
      date: '2025-05-21T16:12:05.614Z',
      postedAgoShort: '1d',
      postedAgoText: '1 day ago',
    },
    postImages: [],
    engagement: { likes: 13, comments: 1, shares: 9, reactions: [{ type: 'LIKE', count: 12 }] },
    ...overrides,
  };
}

type Recorded = { method: string; pathname: string; authorization: string; body: string };

/** Что отвечает поддельный Apify в текущем тесте. */
type Scenario = {
  runStatus: string;
  items: unknown[];
  /** Статус ответа на запуск актора; не 2xx — ошибка API. */
  startStatus: number;
};

const ACTOR_ID = 'harvestapi~linkedin-post-search';
const TOKEN = 'test-token';

let scenario: Scenario;
const recorded: Recorded[] = [];

function run(status: string): Record<string, unknown> {
  return {
    id: 'run-1',
    actId: 'act-1',
    status,
    defaultDatasetId: 'dataset-1',
    startedAt: '2026-11-20T08:00:00.000Z',
  };
}

async function readBody(req: IncomingMessage): Promise<string> {
  req.setEncoding('utf8');
  let body = '';
  for await (const chunk of req) body += String(chunk);
  return body;
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json').end(JSON.stringify(data));
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req);
  const { pathname, searchParams } = new URL(req.url ?? '/', 'http://localhost');
  recorded.push({
    method: req.method ?? '',
    pathname,
    authorization: req.headers.authorization ?? '',
    body,
  });

  if (req.method === 'POST' && pathname === `/v2/actors/${ACTOR_ID}/runs`) {
    if (scenario.startStatus >= 300) {
      sendJson(res, scenario.startStatus, {
        error: { type: 'not-enough-usage-to-run-paid-actor', message: 'Not enough credits' },
      });
      return;
    }
    sendJson(res, 201, { data: run('RUNNING') });
    return;
  }
  if (req.method === 'GET' && pathname === '/v2/actor-runs/run-1') {
    sendJson(res, 200, { data: run(scenario.runStatus) });
    return;
  }
  if (req.method === 'GET' && pathname === '/v2/datasets/dataset-1/items') {
    const offset = Number(searchParams.get('offset') ?? 0);
    const limit = Number(searchParams.get('limit') ?? scenario.items.length);
    const page = scenario.items.slice(offset, offset + limit);
    res.setHeader('x-apify-pagination-total', String(scenario.items.length));
    res.setHeader('x-apify-pagination-offset', String(offset));
    res.setHeader('x-apify-pagination-limit', String(limit));
    res.setHeader('x-apify-pagination-count', String(page.length));
    sendJson(res, 200, page);
    return;
  }
  sendJson(res, 404, { error: { type: 'record-not-found', message: 'Not found' } });
}

let server: Server;
let baseUrl: string;

before(async () => {
  server = createServer((req, res) => {
    handle(req, res).catch(() => res.destroy());
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address !== null && typeof address === 'object');
  baseUrl = `http://127.0.0.1:${String(address.port)}`;
});

after(() => {
  server.close();
});

beforeEach(() => {
  scenario = { runStatus: 'SUCCEEDED', items: [], startStatus: 201 };
  recorded.length = 0;
});

function channel(): ReturnType<typeof createLinkedinChannel> {
  return createLinkedinChannel({ token: TOKEN, baseUrl, maxRetries: 0 });
}

const QUERY = { queries: ['hiring react developer'] };

describe('createLinkedinChannel', () => {
  test('runs the post search actor and returns parsed posts', async () => {
    scenario.items = [postItem()];

    const posts = await channel().searchPosts({
      queries: ['hiring react', 'react remote'],
      maxPosts: 20,
      postedLimit: 'week',
      sortBy: 'date',
    });

    assert.deepEqual(posts, [
      {
        id: '7330988768578920448',
        url: 'https://www.linkedin.com/posts/nickbennett05_hiring-activity-7330988768578920448-Je01',
        content: "I'm #hiring. See the details below.",
        postedAt: new Date('2025-05-21T16:12:05.614Z'),
        author: {
          name: 'Nick Bennett',
          url: 'https://www.linkedin.com/in/nickbennett05',
          headline: 'UX Leadership at Amazon',
          publicIdentifier: 'nickbennett05',
        },
      },
    ]);
    const start = recorded.find((r) => r.method === 'POST');
    assert.ok(start);
    assert.deepEqual(JSON.parse(start.body), {
      searchQueries: ['hiring react', 'react remote'],
      maxPosts: 20,
      postedLimit: 'week',
      sortBy: 'date',
      profileScraperMode: 'short',
      scrapeReactions: false,
      scrapeComments: false,
    });
    assert.equal(start.authorization, `Bearer ${TOKEN}`);
  });

  test('defaults maxPosts to 100 and omits unset filters', async () => {
    await channel().searchPosts(QUERY);

    const start = recorded.find((r) => r.method === 'POST');
    assert.ok(start);
    const body: unknown = JSON.parse(start.body);
    assert.ok(typeof body === 'object' && body !== null);
    assert.equal('maxPosts' in body && body.maxPosts, 100);
    assert.ok(!('postedLimit' in body));
    assert.ok(!('sortBy' in body));
  });

  test('rejects non-positive maxPosts and empty queries before calling Apify', async () => {
    await assert.rejects(channel().searchPosts({ ...QUERY, maxPosts: 0 }), RangeError);
    await assert.rejects(channel().searchPosts({ queries: [] }), RangeError);
    assert.equal(recorded.length, 0);
  });

  test('parses posts without text, headline and timestamp', async () => {
    scenario.items = [
      postItem({
        content: undefined,
        author: { name: 'Acme', linkedinUrl: 'https://www.linkedin.com/company/acme', info: null },
        postedAt: { date: '2026-11-19T10:00:00.000Z' },
      }),
    ];

    const posts = await channel().searchPosts(QUERY);

    assert.ok(!(posts instanceof Error));
    const [post] = posts;
    assert.ok(post);
    assert.equal(post.content, '');
    assert.deepEqual(post.author, {
      name: 'Acme',
      url: 'https://www.linkedin.com/company/acme',
      headline: null,
      publicIdentifier: null,
    });
    assert.deepEqual(post.postedAt, new Date('2026-11-19T10:00:00.000Z'));
  });

  test('skips items that are not posts', async () => {
    scenario.items = [postItem(), { type: 'comment', id: 'c1' }];

    const posts = await channel().searchPosts(QUERY);

    assert.ok(!(posts instanceof Error));
    assert.equal(posts.length, 1);
  });

  test('returns an empty list for an empty dataset', async () => {
    const posts = await channel().searchPosts(QUERY);

    assert.deepEqual(posts, []);
  });

  test('returns ActorRunError when the run did not succeed', async () => {
    scenario.runStatus = 'FAILED';

    const result = await channel().searchPosts(QUERY);

    assert.ok(result instanceof ActorRunError);
    assert.match(result.message, /run-1 finished with status FAILED/u);
    assert.ok(!recorded.some((r) => r.pathname.startsWith('/v2/datasets/')));
  });

  test('returns ActorOutputError with the parse failure as cause', async () => {
    scenario.items = [postItem(), postItem({ id: 42 })];

    const result = await channel().searchPosts(QUERY);

    assert.ok(result instanceof ActorOutputError);
    assert.match(result.message, /Item 1 of run run-1/u);
    assert.ok(result.cause instanceof Error);
    assert.equal(result.cause.message, 'Expected id to be a string');
  });

  test('returns ApifyRequestError with ApifyApiError as cause on API failure', async () => {
    scenario.startStatus = 402;

    const result = await channel().searchPosts(QUERY);

    assert.ok(result instanceof ApifyRequestError);
    assert.ok(result.cause instanceof ApifyApiError);
    assert.equal(result.cause.statusCode, 402);
    assert.equal(result.cause.type, 'not-enough-usage-to-run-paid-actor');
  });
});
