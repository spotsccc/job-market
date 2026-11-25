import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { after, before, describe, test } from 'node:test';

import {
  HttpInvalidResponseError,
  HttpNetworkError,
  HttpStatusError,
} from '@job-market/http-client';

import { createGreenhouseChannel } from './channel.ts';
import { GreenhouseRequestError } from './errors/greenhouse-request-error.ts';

const fixture = readFileSync(new URL('fixtures/wrike-job.json', import.meta.url), 'utf8');

/** Пути запросов к локальному Greenhouse. */
const requested: string[] = [];

let server: Server;
let baseUrl = '';

before(async () => {
  server = createServer((req, res) => {
    requested.push(req.url ?? '');
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    switch (pathname) {
      case '/v1/boards/wrike/jobs': {
        res
          .setHeader('Content-Type', 'application/json')
          .end(`{"jobs":[${fixture}],"meta":{"total":1}}`);
        return;
      }
      case '/v1/boards/stub/jobs': {
        res.setHeader('Content-Type', 'text/html').end('<html><body>Board is closed</body></html>');
        return;
      }
      case '/v1/boards/slow/jobs': {
        setTimeout(() => {
          res.end('{"jobs":[]}');
        }, 1000);
        return;
      }
      default: {
        res.statusCode = 404;
        res.end('{"status":404,"error":"Job not found"}');
      }
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address !== null && typeof address === 'object');
  baseUrl = `http://127.0.0.1:${String(address.port)}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

describe('Greenhouse channel', () => {
  test('reads the board with job texts and maps a real job', async () => {
    const jobs = await createGreenhouseChannel({ baseUrl }).fetchJobs('wrike');

    assert.ok(!(jobs instanceof Error), jobs instanceof Error ? String(jobs.cause) : '');
    assert.equal(requested.at(-1), '/v1/boards/wrike/jobs?content=true');
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]?.id, 4_664_056_005);
    assert.equal(jobs[0].companyName, 'Wrike');
    assert.equal(jobs[0].firstPublished, '2026-02-19T05:41:46-05:00');
  });

  test('encodes the board token in the path', async () => {
    await createGreenhouseChannel({ baseUrl }).fetchJobs('a b/c');

    assert.equal(requested.at(-1), '/v1/boards/a%20b%2Fc/jobs?content=true');
  });

  test('a missing board is GreenhouseRequestError with the status as the cause', async () => {
    const result = await createGreenhouseChannel({ baseUrl }).fetchJobs('acme');

    assert.ok(result instanceof GreenhouseRequestError);
    assert.equal(result.board, 'acme');
    assert.ok(result.cause instanceof HttpStatusError);
  });

  test('an HTML page instead of jobs is an invalid response', async () => {
    const result = await createGreenhouseChannel({ baseUrl }).fetchJobs('stub');

    assert.ok(result instanceof GreenhouseRequestError);
    assert.ok(result.cause instanceof HttpInvalidResponseError);
  });

  test('a board slower than the timeout is a network error', async () => {
    const result = await createGreenhouseChannel({ baseUrl, timeoutMs: 50 }).fetchJobs('slow');

    assert.ok(result instanceof GreenhouseRequestError);
    assert.ok(result.cause instanceof HttpNetworkError);
  });
});
