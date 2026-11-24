import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';

import { createTelegramChannel } from './channel.ts';
import { TelegramPageError } from './errors/telegram-page-error.ts';
import { TelegramRequestError } from './errors/telegram-request-error.ts';

/** Поддельный t.me: отдаёт заданный ответ и запоминает запросы. */
let respond: (request: IncomingMessage, response: ServerResponse) => void = () => {
  // Ответ задаёт каждый тест.
};
const requests: string[] = [];
let server: Server;
let baseUrl = '';

before(async () => {
  server = createServer((request, response) => {
    requests.push(request.url ?? '');
    respond(request, response);
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
  requests.length = 0;
});

describe('createTelegramChannel', () => {
  test('fetches the preview page with the before cursor and parses it', async () => {
    const html = await readFile(
      path.join(import.meta.dirname, 'fixtures', 'forproducts.html'),
      'utf8',
    );
    respond = (_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(html);
    };

    const page = await createTelegramChannel({ baseUrl }).fetchPage('@ForProducts', 10_908);

    assert.ok(!(page instanceof Error), page instanceof Error ? page.message : '');
    assert.deepEqual(requests, ['/s/forproducts?before=10908']);
    assert.equal(page.messages.length, 20);
  });

  test('returns a request error for a non-2xx status', async () => {
    respond = (_request, response) => {
      response.writeHead(429);
      response.end('Too Many Requests');
    };

    const page = await createTelegramChannel({ baseUrl }).fetchPage('forproducts');

    assert.ok(page instanceof TelegramRequestError);
    assert.match(String(page.cause), /HTTP 429/u);
  });

  test('returns a request error on timeout', async () => {
    respond = () => {
      // Не отвечаем: клиент должен сдаться по таймауту.
    };

    const page = await createTelegramChannel({ baseUrl, timeoutMs: 50 }).fetchPage('forproducts');

    assert.ok(page instanceof TelegramRequestError);
  });

  test('returns a page error when the preview is off', async () => {
    respond = (_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end(
        '<html><body>If you have Telegram, you can contact @geeksjobs right away.</body></html>',
      );
    };

    const page = await createTelegramChannel({ baseUrl }).fetchPage('geeksjobs');

    assert.ok(page instanceof TelegramPageError);
  });
});
