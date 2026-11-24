import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { after, before, beforeEach, describe, test } from 'node:test';

import { createApify } from '@job-market/apify';
import { contentHash, db, eq, publicationLinks } from '@job-market/db';
import type { PublicationLinkRow, PublicationRow } from '@job-market/db';
import type { Reader } from '@job-market/enricher';
import { fakeReader } from '@job-market/enricher/test-utils';
import type { FakeReader } from '@job-market/enricher/test-utils';

import { testSource, NOW } from './drain.test-utils.ts';
import type { TestSource } from './drain.test-utils.ts';
import { testConnector } from './test-connector.test-utils.ts';

/** Чтение ссылок LinkedIn в `drain` (П13, E8). Тестовая база из `.env.test`. */
const PREFIX = 'test_connectors_links_';
const JOB_URL = 'https://www.linkedin.com/jobs/view/4479627327';
const POST_URL = 'https://www.linkedin.com/posts/jane_hiring-activity-7330988768578920448-Je01';

let source: TestSource;

function jobReader(failCalls = 0): FakeReader {
  return fakeReader({
    kind: 'linkedin-job',
    label: 'Вакансия LinkedIn',
    match: (url) => /linkedin\.com\/jobs\/view\/(\d+)/u.exec(url)?.[1] ?? null,
    items: { '4479627327': 'Product Manager · Acme\nВести продукт.' },
    failCalls,
  });
}

function postReader(): FakeReader {
  return fakeReader({
    kind: 'linkedin-post',
    label: 'Пост LinkedIn',
    match: (url) => /activity-(\d+)/u.exec(url)?.[1] ?? null,
    items: { '7330988768578920448': 'Нанимаем дизайнера.' },
  });
}

/** `drain` одной публикации канала с текстом `text` и читателями `readers`. */
async function drainText(
  text: string,
  readers: readonly Reader[],
  deadline?: number,
): Promise<{ readonly status: string; readonly row: PublicationRow }> {
  const connector = testConnector('open-telegram', {
    readers,
    parse: () =>
      Promise.resolve({
        publications: [
          {
            externalId: `${source.key}/1`,
            url: `https://t.me/${source.key}/1`,
            content: text,
            publishedAt: NOW,
            author: null,
          },
        ],
        cursor: null,
        more: false,
      }),
  });
  const result = await source.drain(connector, deadline);
  return { status: result.status, row: await source.publication(`${source.key}/1`) };
}

async function linksOf(row: PublicationRow): Promise<PublicationLinkRow[]> {
  return db
    .select()
    .from(publicationLinks)
    .where(eq(publicationLinks.publicationId, row.id))
    .orderBy(publicationLinks.position);
}

before(async () => {
  source = await testSource(PREFIX);
});

beforeEach(async () => source.reset());

after(async () => source.close());

describe('drain reads LinkedIn links', () => {
  test('appends what the link holds and hashes the text without it', async () => {
    const text = `Ищем продакта: ${JOB_URL}`;

    const { row } = await drainText(text, [jobReader()]);

    assert.match(
      row.content,
      /\n\n--- Вакансия LinkedIn по ссылке https:\/\/www\.linkedin\.com\/jobs\/view\/4479627327\nProduct Manager/u,
    );
    assert.equal(row.contentHash, contentHash(text));
    assert.deepEqual(
      (await linksOf(row)).map((link) => [
        link.position,
        link.url,
        link.status,
        link.reader,
        link.host,
      ]),
      [[0, JOB_URL, 'read', 'linkedin-job', 'www.linkedin.com']],
    );
  });

  test('retries a failed link and reads it on the third call', async () => {
    const reader = jobReader(2);

    const { row } = await drainText(`Вакансия ${JOB_URL}`, [reader]);

    assert.equal(reader.calls.length, 3);
    assert.match(row.content, /--- Вакансия LinkedIn по ссылке/u);
  });

  test('a link that never reads leaves the publication without a section', async () => {
    const reader = jobReader(10);

    const { status, row } = await drainText(`Вакансия ${JOB_URL}`, [reader]);

    assert.equal(status, 'done');
    assert.equal(reader.calls.length, 3);
    assert.equal(row.content, `Вакансия ${JOB_URL}`);
    const [link] = await linksOf(row);
    assert.equal(link?.status, 'failed');
    assert.match(link.error ?? '', /Fake reader failed on call 3/u);
  });

  test('a retry keeps the section that was read and reads only the rest', async () => {
    const jobs = jobReader(10);
    const posts = postReader();

    const { row } = await drainText(`Вакансия ${JOB_URL} и пост ${POST_URL}`, [jobs, posts]);

    assert.equal(jobs.calls.length, 3);
    assert.equal(posts.calls.length, 1);
    assert.match(row.content, /--- Пост LinkedIn по ссылке/u);
    assert.doesNotMatch(row.content, /--- Вакансия LinkedIn/u);
  });

  test('does not retry when the deadline is less than a minute away', async () => {
    const reader = jobReader(10);

    await drainText(`Вакансия ${JOB_URL}`, [reader], Date.now() + 30_000);

    assert.equal(reader.calls.length, 1);
  });

  test('does not retry when Apify is out of credits', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(402, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: { type: 'not-enough-usage', message: 'No credits' } }));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address !== null && typeof address === 'object');
    const apify = createApify({
      token: 'test',
      baseUrl: `http://127.0.0.1:${String(address.port)}`,
      maxRetries: 0,
    });
    const calls: (readonly string[])[] = [];
    const reader: Reader = {
      kind: 'linkedin-job',
      label: 'Вакансия LinkedIn',
      parseUrl: (url) => /jobs\/view\/(\d+)/u.exec(url)?.[1] ?? null,
      fetch: async (ids) => {
        calls.push(ids);
        const run = await apify.runActor('apimaestro~linkedin-job-detail', { job_id: ids });
        return run instanceof Error ? run : new Map<string, string>();
      },
    };

    try {
      await drainText(`Вакансия ${JOB_URL}`, [reader]);
    } finally {
      server.close();
    }

    assert.equal(calls.length, 1);
  });
});
