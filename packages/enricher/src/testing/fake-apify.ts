import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { createApify } from '@job-market/apify';
import type { Apify } from '@job-market/apify';

/** Запуск актора, который получил поддельный Apify. */
export type RecordedRun = { readonly actorId: string; readonly input: unknown };

/** Что отвечает поддельный Apify: элементы датасета и статус запуска. */
export type FakeApifyScenario = { items: unknown[]; runStatus: string };

type State = { readonly runs: RecordedRun[]; scenario: FakeApifyScenario };

export type FakeApify = {
  readonly apify: Apify;
  readonly runs: readonly RecordedRun[];
  /** Сценарий текущего теста; `reset` ставит пустой датасет и `SUCCEEDED`. */
  readonly scenario: FakeApifyScenario;
  readonly reset: () => void;
  readonly close: () => Promise<void>;
};

const START_RUN = /^\/v2\/actors\/([^/]+)\/runs$/u;

function run(status: string): Record<string, unknown> {
  return {
    id: 'run-1',
    actId: 'act-1',
    status,
    defaultDatasetId: 'dataset-1',
    startedAt: '2026-11-23T08:00:00.000Z',
  };
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- запрос node:http — поток, readonly его не сделать
async function readBody(req: IncomingMessage): Promise<string> {
  req.setEncoding('utf8');
  let body = '';
  for await (const chunk of req) body += String(chunk);
  return body;
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- ответ node:http изменяем по природе
function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json').end(JSON.stringify(data));
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- ответ node:http изменяем по природе
function sendPage(res: ServerResponse, items: readonly unknown[], search: URLSearchParams): void {
  const offset = Number(search.get('offset') ?? 0);
  const limit = Number(search.get('limit') ?? items.length);
  const page = items.slice(offset, offset + limit);
  res.setHeader('x-apify-pagination-total', String(items.length));
  res.setHeader('x-apify-pagination-offset', String(offset));
  res.setHeader('x-apify-pagination-limit', String(limit));
  res.setHeader('x-apify-pagination-count', String(page.length));
  sendJson(res, 200, page);
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- запрос и ответ node:http изменяемы по природе
async function handle(state: State, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req);
  const { pathname, searchParams } = new URL(req.url ?? '/', 'http://localhost');
  const start = START_RUN.exec(pathname);
  if (req.method === 'POST' && start !== null) {
    state.runs.push({ actorId: decodeURIComponent(start[1] ?? ''), input: JSON.parse(body) });
    sendJson(res, 201, { data: run('RUNNING') });
  } else if (req.method === 'GET' && pathname === '/v2/actor-runs/run-1') {
    sendJson(res, 200, { data: run(state.scenario.runStatus) });
  } else if (req.method === 'GET' && pathname === '/v2/datasets/dataset-1/items') {
    sendPage(res, state.scenario.items, searchParams);
  } else {
    sendJson(res, 404, { error: { type: 'record-not-found', message: 'Not found' } });
  }
}

/** Поддельный API Apify на `node:http`: запуск любого актора, статус запуска и датасет. */
export async function startFakeApify(): Promise<FakeApify> {
  const state: State = { runs: [], scenario: { items: [], runStatus: 'SUCCEEDED' } };
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- запрос и ответ node:http изменяемы по природе
  const server = createServer((req, res) => {
    handle(state, req, res).catch(() => res.destroy());
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address !== null && typeof address === 'object');

  return {
    apify: createApify({
      token: 'test-token',
      baseUrl: `http://127.0.0.1:${String(address.port)}`,
      maxRetries: 0,
    }),
    runs: state.runs,
    get scenario() {
      return state.scenario;
    },
    reset() {
      state.runs.length = 0;
      state.scenario = { items: [], runStatus: 'SUCCEEDED' };
    },
    async close() {
      server.close();
      await once(server, 'close');
    },
  };
}
