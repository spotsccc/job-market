import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

import { authors, db, eq, getDb, inArray, publications, sources } from '@job-market/db';

import { formatSection } from '../section.ts';
import { startFakeApify } from '../testing/fake-apify.ts';
import type { FakeApify } from '../testing/fake-apify.ts';
import { fixtureItem, loadFixture } from '../testing/fixtures.ts';
import { createLinkedinPostReader, LINKEDIN_POST_ACTOR_ID, parsePostUrl } from './linkedin-post.ts';

/** Тесты идут в тестовую базу из `apps/web/.env.test`: `pnpm db:up && pnpm db:migrate:test`. */

const KEY = 'enricher-test-linkedin';
/** Пост, который уже собрал коннектор linkedin. */
const KNOWN_ID = '7000000000000000042';
/** Пост из фикстуры Э0, его в базе нет. */
const FIXTURE_ID = '7525883513603076096';
const AUTHOR = 'Jane Doe (https://www.linkedin.com/in/jane-doe)';

let fake: FakeApify;

async function removeTestRows(): Promise<void> {
  await db.delete(publications).where(inArray(publications.externalId, [KNOWN_ID, FIXTURE_ID]));
  await db.delete(authors).where(eq(authors.externalId, `in/${KEY}`));
  await db.delete(sources).where(eq(sources.key, KEY));
}

before(async () => {
  fake = await startFakeApify();
  await removeTestRows();
  const [source] = await db
    .insert(sources)
    .values({ connector: 'linkedin', key: KEY, platform: 'linkedin', name: 'React в Европе' })
    .returning({ id: sources.id });
  const [author] = await db
    .insert(authors)
    .values({
      connector: 'linkedin',
      externalId: `in/${KEY}`,
      name: 'Jane Doe',
      url: 'https://www.linkedin.com/in/jane-doe',
    })
    .returning({ id: authors.id });
  assert.ok(source !== undefined && author !== undefined);
  await db.insert(publications).values({
    sourceId: source.id,
    connector: 'linkedin',
    externalId: KNOWN_ID,
    url: `https://www.linkedin.com/feed/update/urn:li:activity:${KNOWN_ID}`,
    content:
      'Ищем React-разработчика' +
      formatSection('Вакансия LinkedIn', 'https://www.linkedin.com/jobs/view/1/', 'Описание'),
    postedAt: new Date('2026-11-20T10:00:00.000Z'),
    contentHash: 'hash',
    authorId: author.id,
  });
});

after(async () => {
  await removeTestRows();
  await fake.close();
  await getDb().$client.end();
});

beforeEach(() => {
  fake.reset();
});

describe('parsePostUrl', () => {
  const cases: [string, string | null][] = [
    [
      'https://www.linkedin.com/posts/twinby_%D1%81%D0%B5-activity-7525883513603076096-IOJy?utm_source=share&utm_medium=member_desktop',
      FIXTURE_ID,
    ],
    [
      'https://www.linkedin.com/feed/update/urn:li:activity:7302346926123798528',
      '7302346926123798528',
    ],
    [
      'https://www.linkedin.com/feed/update/urn%3Ali%3Aactivity%3A7302346926123798528/',
      '7302346926123798528',
    ],
    [
      'https://www.linkedin.com/posts/%D0%B2%D0%B0%D0%BA%D0%B0%D0%BD%D1%81%D0%B8%D1%8F-share-7523022657647177728-soyO/?utm_source=share',
      'share:7523022657647177728',
    ],
    [
      'https://www.linkedin.com/feed/update/urn:li:share:7523022657647177728/',
      'share:7523022657647177728',
    ],
    ['https://www.linkedin.com/in/jane-doe', null],
    ['https://www.linkedin.com/jobs/view/4479627327/', null],
    ['https://example.com/posts/x-activity-1-a', null],
  ];
  for (const [url, id] of cases) {
    test(`${url} → ${String(id)}`, () => {
      assert.equal(parsePostUrl(url), id);
    });
  }
});

describe('createLinkedinPostReader', () => {
  test('takes a collected post from the database without its sections and runs no actor', async () => {
    const result = await createLinkedinPostReader(fake.apify).fetch([KNOWN_ID]);

    assert.deepEqual(result, new Map([[KNOWN_ID, `${AUTHOR}\nИщем React-разработчика`]]));
    assert.deepEqual(fake.runs, []);
  });

  test('reads posts missing from the database with the actor', async () => {
    fake.scenario.items = loadFixture('post-detail');

    const result = await createLinkedinPostReader(fake.apify).fetch([KNOWN_ID, FIXTURE_ID]);

    assert.deepEqual(fake.runs, [
      { actorId: LINKEDIN_POST_ACTOR_ID, input: { post_urls: [FIXTURE_ID] } },
    ]);
    assert.ok(!(result instanceof Error));
    assert.equal(result.get(KNOWN_ID), `${AUTHOR}\nИщем React-разработчика`);
    const body = result.get(FIXTURE_ID) ?? '';
    assert.match(
      body,
      /^Twinby \(https:\/\/www\.linkedin\.com\/company\/twinby\/posts\)\nСейчас мы в поиске\u00A0Event & Special Projects Manager/u,
    );
  });

  test('returns no data for a post the actor did not find or that has no text', async () => {
    const empty = fixtureItem('post-detail');
    const post: unknown = empty['post'];
    assert.ok(typeof post === 'object' && post !== null);
    fake.scenario.items = [
      ...loadFixture('post-detail-not-found'),
      { ...empty, post: { ...post, text: '' } },
    ];

    const result = await createLinkedinPostReader(fake.apify).fetch([
      '7000000000000000001',
      FIXTURE_ID,
    ]);

    assert.deepEqual(result, new Map());
  });

  test('reads every post with the actor when the database lookup fails', async (t) => {
    t.mock.method(getDb(), 'select', () => {
      throw new Error('connection refused');
    });
    fake.scenario.items = loadFixture('post-detail');

    const result = await createLinkedinPostReader(fake.apify).fetch([KNOWN_ID, FIXTURE_ID]);

    assert.deepEqual(fake.runs, [
      { actorId: LINKEDIN_POST_ACTOR_ID, input: { post_urls: [KNOWN_ID, FIXTURE_ID] } },
    ]);
    assert.ok(!(result instanceof Error));
    assert.deepEqual([...result.keys()], [FIXTURE_ID]);
  });

  test('asks the actor for a post linked by share and recognizes it by share_urn', async () => {
    fake.scenario.items = loadFixture('post-detail');
    const shareId = 'share:7525883512286294017';

    const result = await createLinkedinPostReader(fake.apify).fetch([shareId]);

    assert.deepEqual(fake.runs, [
      {
        actorId: LINKEDIN_POST_ACTOR_ID,
        input: {
          post_urls: ['https://www.linkedin.com/feed/update/urn:li:share:7525883512286294017'],
        },
      },
    ]);
    assert.ok(!(result instanceof Error));
    assert.deepEqual([...result.keys()], [shareId]);
  });
});
