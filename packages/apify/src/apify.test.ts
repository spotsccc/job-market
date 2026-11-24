import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { after, before, beforeEach, describe, test } from 'node:test';

import { ApifyApiError } from 'apify-client';

import { createApify, isOutOfCredits } from './apify.ts';
import { ActorRunError } from './errors/actor-run-error.ts';
import { ApifyRequestError } from './errors/apify-request-error.ts';

type Recorded = {
  method: string;
  pathname: string;
  search: URLSearchParams;
  authorization: string;
  body: string;
};

/** Что отвечает поддельный Apify в текущем тесте. */
type Scenario = {
  runStatus: string;
  items: unknown[];
  /** Статус ответа на запуск актора; не 2xx — ошибка API. */
  startStatus: number;
};

const ACTOR_ID = 'apimaestro~linkedin-job-detail';
const TOKEN = 'test-token';
/** Страница датасета — один элемент, чтобы датасет из двух элементов листался. */
const PAGE_SIZE = 1;

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
    search: searchParams,
    authorization: req.headers.authorization ?? '',
    body,
  });

  if (req.method === 'POST' && pathname === `/v2/actors/${ACTOR_ID}/runs`) {
    if (scenario.startStatus >= 300) {
      sendJson(res, scenario.startStatus, {
        error: { type: 'concurrent-runs-limit-exceeded', message: 'Too many runs' },
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
    const page = scenario.items.slice(offset, offset + PAGE_SIZE);
    res.setHeader('x-apify-pagination-total', String(scenario.items.length));
    res.setHeader('x-apify-pagination-offset', String(offset));
    res.setHeader('x-apify-pagination-limit', String(PAGE_SIZE));
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

function apify(): ReturnType<typeof createApify> {
  return createApify({ token: TOKEN, baseUrl, maxRetries: 0 });
}

describe('createApify', () => {
  test('runs the actor with the input and reads every dataset page in order', async () => {
    scenario.items = [{ n: 1 }, { n: 2 }];

    const result = await apify().runActor(ACTOR_ID, { job_id: ['4479627327'] });

    assert.deepEqual(result, { runId: 'run-1', items: [{ n: 1 }, { n: 2 }] });
    const start = recorded.find((r) => r.method === 'POST');
    assert.ok(start);
    assert.deepEqual(JSON.parse(start.body), { job_id: ['4479627327'] });
    assert.equal(start.authorization, `Bearer ${TOKEN}`);
    const pages = recorded.filter((r) => r.pathname === '/v2/datasets/dataset-1/items');
    assert.ok(pages.length >= 2, `expected paging, got ${String(pages.length)} requests`);
  });

  test('passes waitSecs to Apify', async () => {
    await apify().runActor(ACTOR_ID, {}, { waitSecs: 60 });

    const waits = recorded.map((r) => r.search.get('waitForFinish')).filter((w) => w !== null);
    assert.ok(waits.length > 0, 'no request carried waitForFinish');
    assert.ok(
      waits.every((w) => Number(w) <= 60),
      `waitForFinish over 60: ${waits.join(', ')}`,
    );
  });

  test('returns ActorRunError with the run id when the run did not succeed', async () => {
    scenario.runStatus = 'FAILED';

    const result = await apify().runActor(ACTOR_ID, {});

    assert.ok(result instanceof ActorRunError);
    assert.match(result.message, /run-1 finished with status FAILED/u);
    assert.ok(!recorded.some((r) => r.pathname.startsWith('/v2/datasets/')));
  });

  test('returns ApifyRequestError with ApifyApiError as cause on API failure', async () => {
    scenario.startStatus = 402;

    const result = await apify().runActor(ACTOR_ID, {});

    assert.ok(result instanceof ApifyRequestError);
    assert.ok(result.cause instanceof ApifyApiError);
    assert.equal(result.cause.statusCode, 402);
    assert.equal(result.cause.type, 'concurrent-runs-limit-exceeded');
  });

  test('returns ApifyRequestError when Apify is unreachable', async () => {
    const closed = createServer();
    closed.listen(0, '127.0.0.1');
    await once(closed, 'listening');
    const address = closed.address();
    assert.ok(address !== null && typeof address === 'object');
    closed.close();
    await once(closed, 'close');

    const result = await createApify({
      token: TOKEN,
      baseUrl: `http://127.0.0.1:${String(address.port)}`,
      maxRetries: 0,
    }).runActor(ACTOR_ID, {});

    assert.ok(result instanceof ApifyRequestError);
  });

  test('startActor returns the run id without waiting for the run', async () => {
    const result = await apify().startActor(ACTOR_ID, { job_id: ['1'] });

    assert.equal(result, 'run-1');
    assert.ok(!recorded.some((r) => r.pathname === '/v2/actor-runs/run-1'));
  });

  test('collectRun reports a run that is still going after waitSecs', async () => {
    scenario.runStatus = 'RUNNING';

    const result = await apify().collectRun('run-1', 1);

    assert.equal(result, 'running');
    assert.ok(!recorded.some((r) => r.pathname.startsWith('/v2/datasets/')));
  });

  test('collectRun reads the dataset of a finished run', async () => {
    scenario.items = [{ n: 1 }, { n: 2 }];

    const result = await apify().collectRun('run-1', 60);

    assert.deepEqual(result, { runId: 'run-1', items: [{ n: 1 }, { n: 2 }] });
  });

  test('collectRun returns ActorRunError for a failed run', async () => {
    scenario.runStatus = 'FAILED';

    const result = await apify().collectRun('run-1', 60);

    assert.ok(result instanceof ActorRunError);
  });

  test('isOutOfCredits tells 402 from other API failures', async () => {
    scenario.startStatus = 402;
    const outOfCredits = await apify().startActor(ACTOR_ID, {});
    scenario.startStatus = 404;
    const notFound = await apify().startActor(ACTOR_ID, {});

    assert.ok(outOfCredits instanceof Error && notFound instanceof Error);
    assert.equal(isOutOfCredits(outOfCredits), true);
    assert.equal(isOutOfCredits(notFound), false);
  });
});
