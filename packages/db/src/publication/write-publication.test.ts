import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

import { and, eq, inArray, like } from 'drizzle-orm';

import { db, getDb } from '../client.ts';
import { authors, publicationLinks, publications, sources } from './index.ts';
import {
  addPublications,
  authorKey,
  findOriginals,
  insertPublication,
  markFailed,
  saveCursor,
  setOutcome,
  upsertAuthors,
} from './write-publication.ts';
import type { NewPublicationToSave, PublicationToSave } from './write-publication.ts';

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

function newPublication(
  number: number,
  links: NewPublicationToSave['links'] = [],
): NewPublicationToSave {
  const { status: _status, attempts: _attempts, ...row } = publication(number);
  return { publication: { ...row, status: 'pending' }, links };
}

async function linksOf(number: number): Promise<(typeof publicationLinks.$inferSelect)[]> {
  const [row] = await db
    .select({ id: publications.id })
    .from(publications)
    .where(eq(publications.externalId, `${KEY}/${String(number)}`));
  return db
    .select()
    .from(publicationLinks)
    .where(eq(publicationLinks.publicationId, row?.id ?? ''))
    .orderBy(publicationLinks.position);
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

  test('addPublications writes only new publications and leaves a failed one as it was', async () => {
    await markFailed(db, publication(30, { content: 'Старый текст' }), 'model timeout');
    const read = {
      url: 'https://www.linkedin.com/jobs/view/1',
      targetUrl: null,
      status: 'read',
      reader: 'linkedin-job',
      error: null,
    } as const;
    const short = {
      url: 'https://lnkd.in/abc',
      targetUrl: 'https://www.LinkedIn.com/posts/x',
      status: 'no_data',
      reader: 'linkedin-post',
      error: null,
    } as const;

    const ids = await addPublications(db, [
      newPublication(31, [read, short]),
      newPublication(30, [read]),
      newPublication(32),
    ]);

    assert.deepEqual([...ids.keys()].toSorted(), [
      authorKey('open-telegram', `${KEY}/31`),
      authorKey('open-telegram', `${KEY}/32`),
    ]);
    const [failed] = await db
      .select()
      .from(publications)
      .where(eq(publications.externalId, `${KEY}/30`));
    assert.equal(failed?.status, 'failed');
    assert.equal(failed.attempts, 1);
    assert.equal(failed.lastError, 'model timeout');
    assert.equal(failed.content, 'Старый текст');
    assert.deepEqual(await linksOf(30), []);
    assert.deepEqual(
      (await linksOf(31)).map((link) => [link.position, link.url, link.host]),
      [
        [0, read.url, 'www.linkedin.com'],
        [1, short.url, 'www.linkedin.com'],
      ],
    );

    const again = await addPublications(db, [newPublication(31, [read]), newPublication(32)]);

    assert.equal(again.size, 0);
    assert.equal((await linksOf(31)).length, 2);
  });

  test('setOutcome keeps the note only for trash and clears reason and note of a vacancy', async () => {
    const rowsToAdd = [newPublication(40), newPublication(41), newPublication(42)];
    const ids = await addPublications(db, rowsToAdd);
    const id = (n: number): string =>
      ids.get(authorKey('open-telegram', `${KEY}/${String(n)}`)) ?? '';
    const [trash, vacancy, empty] = [id(40), id(41), id(42)];
    await db
      .update(publications)
      .set({ notVacancyReason: 'trash', note: 'прошлый итог' })
      .where(inArray(publications.id, [vacancy, empty]));

    await setOutcome(db, trash, { status: 'not_vacancy', reason: 'trash', note: 'Ищет' });
    await setOutcome(db, vacancy, { status: 'vacancy' });
    await setOutcome(db, empty, { status: 'not_vacancy', reason: 'empty' });

    const rows = await db
      .select()
      .from(publications)
      .where(inArray(publications.id, [...ids.values()]));
    const byId = new Map(rows.map((row) => [row.id, [row.status, row.notVacancyReason, row.note]]));
    assert.deepEqual(byId.get(trash), ['not_vacancy', 'trash', 'Ищет']);
    assert.deepEqual(byId.get(vacancy), ['vacancy', null, null]);
    assert.deepEqual(byId.get(empty), ['not_vacancy', 'empty', null]);
    assert.ok(rows.every((row) => row.processedAt !== null));
  });

  test('saveCursor changes only the cursor of the source', async () => {
    const nextRunAt = new Date('2026-11-21T00:00:00.000Z');
    await db
      .update(sources)
      .set({ consecutiveFailures: 2, nextRunAt, lastError: 'HTTP 503' })
      .where(eq(sources.id, sourceId));

    await saveCursor(db, sourceId, { cursorId: 10 });

    const [row] = await db.select().from(sources).where(eq(sources.id, sourceId));
    assert.deepEqual(row?.cursor, { cursorId: 10 });
    assert.equal(row.consecutiveFailures, 2);
    assert.deepEqual(row.nextRunAt, nextRunAt);
    assert.equal(row.lastError, 'HTTP 503');
  });
});
