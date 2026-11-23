import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

import { and, eq, like } from 'drizzle-orm';

import { db, getDb } from '../client.ts';
import { authors, publications, sources } from './index.ts';
import {
  authorKey,
  findOriginals,
  insertPublication,
  markFailed,
  upsertAuthors,
} from './write-publication.ts';
import type { PublicationToSave } from './write-publication.ts';

/** Тесты идут в тестовую базу из `apps/web/.env.test`: `pnpm db:up && pnpm db:migrate:test`. */

const KEY = 'write-publication-test';
let sourceId = '';

function publication(
  number: number,
  overrides: Partial<PublicationToSave> = {},
): PublicationToSave {
  return {
    sourceId,
    connector: 'open-telegram',
    externalId: `${KEY}/${String(number)}`,
    url: `https://t.me/${KEY}/${String(number)}`,
    content: `Пост ${String(number)}`,
    postedAt: new Date('2026-11-20T10:00:00.000Z'),
    contentHash: `${KEY}-hash-${String(number)}`,
    status: 'vacancy',
    attempts: 1,
    ...overrides,
  };
}

async function removeTestRows(): Promise<void> {
  await db.delete(publications).where(like(publications.externalId, `${KEY}/%`));
  await db.delete(authors).where(like(authors.externalId, `${KEY}%`));
  await db.delete(sources).where(eq(sources.key, KEY));
}

async function attemptsOf(number: number): Promise<number | undefined> {
  const [row] = await db
    .select({ attempts: publications.attempts })
    .from(publications)
    .where(
      and(
        eq(publications.connector, 'open-telegram'),
        eq(publications.externalId, `${KEY}/${String(number)}`),
      ),
    );
  return row?.attempts;
}

describe('publication writes', () => {
  before(async () => {
    await removeTestRows();
    const [source] = await db
      .insert(sources)
      .values({ connector: 'open-telegram', key: KEY, platform: 'geekjobs', name: KEY })
      .returning({ id: sources.id });
    assert.ok(source !== undefined);
    sourceId = source.id;
  });

  beforeEach(async () => {
    await db.delete(publications).where(like(publications.externalId, `${KEY}/%`));
    await db.delete(authors).where(like(authors.externalId, `${KEY}%`));
  });

  after(async () => {
    await removeTestRows();
    await getDb().$client.end();
  });

  test('two posts of one channel in a batch give one author', async () => {
    const channel = {
      connector: 'open-telegram',
      externalId: KEY,
      name: 'Канал',
      url: `https://t.me/${KEY}`,
      headline: null,
    } as const;

    const ids = await upsertAuthors(db, [channel, channel]);

    assert.equal(ids.size, 1);
    const rows = await db.select().from(authors).where(eq(authors.externalId, KEY));
    assert.equal(rows.length, 1);
    assert.equal(ids.get(authorKey('open-telegram', KEY)), rows[0]?.id);
  });

  test('a new post of the author overwrites the headline and keeps the id', async () => {
    const author = {
      connector: 'linkedin',
      externalId: `${KEY}-in/jane`,
      name: 'Jane',
      url: 'https://www.linkedin.com/in/jane',
      headline: 'Engineer at Acme',
    } as const;
    const first = await upsertAuthors(db, [author]);

    const second = await upsertAuthors(db, [{ ...author, headline: 'Hiring at Bolt' }]);

    const key = authorKey('linkedin', author.externalId);
    assert.equal(second.get(key), first.get(key));
    const [row] = await db.select().from(authors).where(eq(authors.externalId, author.externalId));
    assert.equal(row?.headline, 'Hiring at Bolt');
  });

  test('a publication written by another run is not overwritten', async () => {
    const id = await insertPublication(db, publication(9120));

    const again = await insertPublication(db, publication(9120, { content: 'Другой текст' }));

    assert.ok(id !== null);
    assert.equal(again, null);
    const rows = await db
      .select()
      .from(publications)
      .where(eq(publications.externalId, `${KEY}/9120`));
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.content, 'Пост 9120');
  });

  test('a failed publication is retried in place', async () => {
    const failedId = await markFailed(db, publication(1), 'model timeout');
    assert.equal(await markFailed(db, publication(1), 'model timeout'), failedId);
    assert.equal(await attemptsOf(1), 2);

    const id = await insertPublication(db, publication(1));

    assert.equal(id, failedId);
    const [row] = await db
      .select()
      .from(publications)
      .where(eq(publications.id, failedId ?? ''));
    assert.equal(row?.status, 'vacancy');
    assert.equal(row.attempts, 3);
  });

  test('markFailed does not touch a publication that is already parsed', async () => {
    await insertPublication(db, publication(2));

    assert.equal(await markFailed(db, publication(2), 'model timeout'), null);

    assert.equal(await attemptsOf(2), 1);
  });

  test('originals are vacancies and not_vacancy, the earliest wins', async () => {
    const shared = `${KEY}-shared`;
    const earliest = await insertPublication(
      db,
      publication(10, {
        contentHash: shared,
        status: 'not_vacancy',
        postedAt: new Date('2026-11-01T00:00:00.000Z'),
      }),
    );
    await insertPublication(db, publication(11, { contentHash: shared }));
    const vacancy = await insertPublication(db, publication(12));
    await insertPublication(db, publication(13, { status: 'duplicate' }));
    await markFailed(db, publication(14), 'model timeout');

    const originals = await findOriginals(db, [
      shared,
      `${KEY}-hash-12`,
      `${KEY}-hash-13`,
      `${KEY}-hash-14`,
    ]);

    assert.deepEqual(
      originals,
      new Map([
        [shared, earliest],
        [`${KEY}-hash-12`, vacancy],
      ]),
    );
  });
});
