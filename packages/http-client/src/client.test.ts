import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { after, before, describe, test } from 'node:test';

import { AppError } from '@job-market/errors';
import { isAbortError } from '@spotsccc/error-as-value';

import { createHttpClient } from './client.ts';
import { HttpInvalidResponseError } from './errors/http-invalid-response-error.ts';
import { HttpNetworkError } from './errors/http-network-error.ts';
import { HttpStatusError } from './errors/http-status-error.ts';

type Recorded = { method: string; url: string; headers: IncomingMessage['headers']; body: string };

type Item = { readonly id: number };

function parseItems(data: unknown): Error | readonly Item[] {
  if (!Array.isArray(data)) return new Error('Expected an array');
  const items: Item[] = [];
  for (const entry of data as unknown[]) {
    if (typeof entry !== 'object' || entry === null || !('id' in entry)) {
      return new Error('Expected items with id');
    }
    const { id } = entry;
    if (typeof id !== 'number') return new Error('Expected numeric id');
    items.push({ id });
  }
  return items;
}

async function readBody(req: IncomingMessage): Promise<string> {
  req.setEncoding('utf8');
  let body = '';
  for await (const chunk of req) body += String(chunk);
  return body;
}

const recorded: Recorded[] = [];

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req);
  recorded.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
  const { pathname } = new URL(req.url ?? '/', 'http://localhost');

  switch (pathname) {
    case '/v2/items': {
      res.setHeader('Content-Type', 'application/json').end('[{"id":1},{"id":2}]');
      return;
    }
    case '/v2/wrong-shape': {
      res.end('{"id":"not-an-array"}');
      return;
    }
    case '/v2/not-json': {
      res.end('<html>oops</html>');
      return;
    }
    case '/v2/empty': {
      res.statusCode = 204;
      res.end();
      return;
    }
    case '/v2/slow': {
      setTimeout(() => {
        res.end('[]');
      }, 1000);
      return;
    }
    default: {
      res.statusCode = 404;
      res.end('{"error":"not found"}');
    }
  }
}

let server: Server;
let baseUrl: string;

before(async () => {
  server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      res.statusCode = 500;
      res.end(String(error));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address !== null && typeof address === 'object');
  baseUrl = `http://127.0.0.1:${address.port}/v2/`;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

describe('createHttpClient', () => {
  test('returns parsed data and keeps the base path when joining', async () => {
    const client = createHttpClient({ baseUrl, headers: { Authorization: 'Bearer secret' } });

    const items = await client.request({
      path: '/items',
      query: { limit: 10, clean: true, skipped: undefined },
      parse: parseItems,
    });

    assert.deepEqual(items, [{ id: 1 }, { id: 2 }]);
    const last = recorded.at(-1);
    assert.equal(last?.url, '/v2/items?limit=10&clean=true');
    assert.equal(last.headers.authorization, 'Bearer secret');
    assert.equal(last.headers.accept, 'application/json');
  });

  test('sends a JSON body with the request method', async () => {
    const client = createHttpClient({ baseUrl });

    const result = await client.request({
      method: 'POST',
      path: 'items',
      body: { query: 'typescript' },
      parse: parseItems,
    });

    assert.ok(!(result instanceof Error));
    const last = recorded.at(-1);
    assert.equal(last?.method, 'POST');
    assert.equal(last.headers['content-type'], 'application/json');
    assert.equal(last.body, '{"query":"typescript"}');
  });

  test('returns HttpStatusError for non-2xx responses', async () => {
    const client = createHttpClient({ baseUrl });

    const result = await client.request({ path: 'missing', parse: parseItems });

    assert.ok(result instanceof HttpStatusError);
    assert.ok(result instanceof AppError);
    assert.equal(result.status, 404);
    assert.equal(result.message, 'Request GET /missing failed with status 404');
  });

  test('returns HttpInvalidResponseError when the body is not JSON', async () => {
    const client = createHttpClient({ baseUrl });

    const result = await client.request({ path: 'not-json', parse: parseItems });

    assert.ok(result instanceof HttpInvalidResponseError);
    assert.ok(result.cause instanceof SyntaxError);
  });

  test('wraps a parse failure into HttpInvalidResponseError with the cause', async () => {
    const client = createHttpClient({ baseUrl });

    const result = await client.request({ path: 'wrong-shape', parse: parseItems });

    assert.ok(result instanceof HttpInvalidResponseError);
    assert.ok(result.cause instanceof Error);
    assert.equal(result.cause.message, 'Expected an array');
  });

  test('passes undefined to parse for an empty body', async () => {
    const client = createHttpClient({ baseUrl });

    const result = await client.request({
      method: 'DELETE',
      path: 'empty',
      parse: (data) => (data === undefined ? 'empty' : new Error('Expected no body')),
    });

    assert.equal(result, 'empty');
  });

  test('returns HttpNetworkError when the server is unreachable', async () => {
    const client = createHttpClient({ baseUrl: 'http://127.0.0.1:1' });

    const result = await client.request({ path: 'items', parse: parseItems });

    assert.ok(result instanceof HttpNetworkError);
    assert.ok(!isAbortError(result));
  });

  test('returns an abort-detectable HttpNetworkError when the signal aborts', async () => {
    const client = createHttpClient({ baseUrl });
    const controller = new AbortController();
    setTimeout(() => {
      controller.abort();
    }, 50);

    const result = await client.request({
      path: 'slow',
      signal: controller.signal,
      parse: parseItems,
    });

    assert.ok(result instanceof HttpNetworkError);
    assert.ok(isAbortError(result));
  });
});
