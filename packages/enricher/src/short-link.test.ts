import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { after, before, describe, test } from 'node:test';

import { expandShortLink, isShortLink } from './short-link.ts';

/** Ответы сервера по пути: статус и `Location`. */
const ROUTES: Readonly<Record<string, { status: number; location?: string }>> = {
  '/absolute': { status: 301, location: 'https://www.linkedin.com/posts/x-share-1-a/?utm=1' },
  '/relative': { status: 302, location: '/p/next' },
  '/no-location': { status: 301 },
  '/interstitial': { status: 200 },
  '/missing': { status: 404 },
  '/limited': { status: 429 },
  '/broken': { status: 503 },
};

let server: Server;
let base: string;

before(async () => {
  server = createServer((req, res) => {
    const route = ROUTES[req.url ?? ''] ?? { status: 404 };
    res.statusCode = route.status;
    if (route.location !== undefined) res.setHeader('Location', route.location);
    res.end('<html>body</html>');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address !== null && typeof address === 'object');
  base = `http://127.0.0.1:${String(address.port)}`;
});

/** Адрес на тестовом сервере. */
function at(path: string): string {
  return `${base}${path}`;
}

after(async () => {
  server.close();
  await once(server, 'close');
});

describe('isShortLink', () => {
  const cases: [string, boolean][] = [
    ['https://lnkd.in/p/eNgfASQj', true],
    ['https://LNKD.IN/eNgfASQj', true],
    ['https://www.linkedin.com/jobs/view/1/', false],
    ['https://example.com/lnkd.in/x', false],
    ['not a url', false],
  ];
  for (const [url, expected] of cases) {
    test(`${url} → ${String(expected)}`, () => {
      assert.equal(isShortLink(url), expected);
    });
  }
});

describe('expandShortLink', () => {
  test('returns the redirect target without following it', async () => {
    assert.equal(
      await expandShortLink(at('/absolute')),
      'https://www.linkedin.com/posts/x-share-1-a/?utm=1',
    );
  });

  test('resolves a relative Location against the short link', async () => {
    assert.equal(await expandShortLink(at('/relative')), at('/p/next'));
  });

  for (const path of ['/no-location', '/interstitial', '/missing']) {
    test(`returns null for a response without a redirect: ${path}`, async () => {
      assert.equal(await expandShortLink(at(path)), null);
    });
  }

  for (const path of ['/limited', '/broken']) {
    test(`returns an error when the service fails: ${path}`, async () => {
      assert.ok((await expandShortLink(at(path))) instanceof Error);
    });
  }

  test('returns an error when nothing answers', async () => {
    assert.ok((await expandShortLink('http://127.0.0.1:1/x')) instanceof Error);
  });
});
