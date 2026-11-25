import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

import {
  asc,
  authors,
  db,
  eq,
  getDb,
  like,
  platforms,
  publications,
  sources,
  vacancies,
} from '@job-market/db';
import type { PublicationRow, SourceRow } from '@job-market/db';

import type { Connector, DrainResult } from '../contract.ts';
import { createConnectors, createLinkedinChannel } from '../index.ts';
import { mockModel, roleOutput } from '../models.test-utils.ts';
import { fakeTelegram } from '../open-telegram/fake-telegram.test-utils.ts';
import type { GreenhouseJob } from './channel.ts';
import { fakeGreenhouse, greenhouseJob } from './fake-greenhouse.test-utils.ts';
import type { FakeGreenhouseOptions } from './fake-greenhouse.test-utils.ts';

/**
 * Тесты идут в тестовую базу из `apps/web/.env.test`. Токен доски — префикс файла: с него
 * начинаются ключ источника, id публикаций и автора (E7).
 */
const BOARD = 'test_connectors_greenhouse_wrike';
const NOW = new Date('2026-11-25T12:00:00.000Z');

let sourceId = '';

const job = (id: number, firstPublished: string): GreenhouseJob =>
  greenhouseJob({
    id,
    absoluteUrl: `https://job-boards.greenhouse.io/wrike/jobs/${String(id)}`,
    title: `Account Development Manager ${String(id)}`,
    firstPublished,
  });

function registry(
  jobs: readonly GreenhouseJob[],
  options: FakeGreenhouseOptions = {},
): {
  readonly connector: Connector;
  readonly classifier: ReturnType<typeof mockModel>;
  readonly extractor: ReturnType<typeof mockModel>;
} {
  const classifier = mockModel({ verdict: 'not_vacancy', note: 'Классификатор не нужен' });
  const extractor = mockModel({
    vacancies: [
      roleOutput({ title: 'Account Development Manager', company: 'Wrike', occupation: 'root' }),
    ],
  });
  const connectors = createConnectors({
    telegram: fakeTelegram(new Map()),
    linkedin: createLinkedinChannel({ token: 'test-token' }),
    greenhouse: fakeGreenhouse(new Map([[BOARD, jobs]]), options),
    models: { classifier, extractor },
    readers: [],
  });
  const connector = connectors.get('greenhouse');
  assert.ok(connector !== undefined);
  return { connector, classifier, extractor };
}

async function sourceRow(): Promise<SourceRow> {
  const [found] = await db.select().from(sources).where(eq(sources.id, sourceId));
  assert.ok(found !== undefined);
  return found;
}

async function drain(connector: Connector): Promise<DrainResult> {
  const result = await connector.drain(await sourceRow(), {
    now: NOW,
    deadline: Date.now() + 60_000,
  });
  assert.ok(!(result instanceof Error), result instanceof Error ? String(result.cause) : '');
  return result;
}

async function boardPublications(): Promise<PublicationRow[]> {
  return db
    .select()
    .from(publications)
    .where(like(publications.externalId, `${BOARD}/%`))
    .orderBy(asc(publications.externalId));
}

async function removeRows(): Promise<void> {
  await db.delete(publications).where(like(publications.externalId, `${BOARD}/%`));
  await db.delete(authors).where(eq(authors.externalId, BOARD));
}

before(async () => {
  await removeRows();
  await db.delete(sources).where(eq(sources.key, BOARD));
  await db.insert(platforms).values({ id: 'greenhouse', name: 'Greenhouse' }).onConflictDoNothing();
  const [created] = await db
    .insert(sources)
    .values({ connector: 'greenhouse', key: BOARD, platform: 'greenhouse', name: 'Wrike' })
    .returning({ id: sources.id });
  assert.ok(created !== undefined);
  sourceId = created.id;
});

beforeEach(async () => {
  await removeRows();
  await db.update(sources).set({ cursor: null }).where(eq(sources.id, sourceId));
});

after(async () => {
  await removeRows();
  await db.delete(sources).where(eq(sources.id, sourceId));
  await getDb().$client.end();
});

describe('greenhouse connector', () => {
  test('writes the new jobs of a board once, with the company as the author', async () => {
    const jobs = [
      job(1, '2025-03-01T10:00:00-05:00'),
      job(2, '2026-10-01T10:00:00Z'),
      job(3, '2026-11-24T10:00:00Z'),
    ];

    const first = await drain(registry(jobs).connector);

    assert.equal(first.status, 'done');
    assert.equal(first.inserted, 3);
    const rows = await boardPublications();
    assert.deepEqual(
      rows.map((row) => [row.connector, row.status]),
      [
        ['greenhouse', 'pending'],
        ['greenhouse', 'pending'],
        ['greenhouse', 'pending'],
      ],
    );
    const [author] = await db.select().from(authors).where(eq(authors.externalId, BOARD));
    assert.equal(author?.name, 'Wrike');
    assert.ok(rows.every((row) => row.authorId === author.id));
    assert.deepEqual((await sourceRow()).cursor, {
      publishedAfter: '2026-11-24T10:00:00.000Z',
    });

    const again = await drain(registry(jobs).connector);
    assert.equal(again.inserted, 0);

    const next = await drain(registry([...jobs, job(4, '2026-11-25T09:00:00Z')]).connector);
    assert.equal(next.inserted, 1);
    assert.equal((await boardPublications()).length, 4);
  });

  test('a board that does not answer fails the poll and keeps the cursor and publications', async () => {
    const jobs = [job(1, '2026-11-24T10:00:00Z')];
    await drain(registry(jobs).connector);
    const { cursor } = await sourceRow();

    const failed = await drain(registry(jobs, { failOnCall: 1 }).connector);

    assert.equal(failed.status, 'failed');
    assert.equal(failed.inserted, 0);
    assert.deepEqual((await sourceRow()).cursor, cursor);
    assert.equal((await boardPublications()).length, 1);
  });

  test('mines a job with the extractor only, the company shown as the author', async () => {
    const { connector, classifier, extractor } = registry([job(1, '2026-11-24T10:00:00Z')]);
    await drain(connector);
    const [row] = await boardPublications();
    assert.ok(row !== undefined);

    const result = await connector.mine({
      id: row.id,
      status: row.status,
      connector: 'greenhouse',
      content: row.content,
      postedAt: row.postedAt,
      author: { name: 'Wrike', url: `https://job-boards.greenhouse.io/${BOARD}`, headline: null },
    });

    assert.deepEqual(result, { status: 'vacancy', vacancies: 1 });
    assert.equal(classifier.doGenerateCalls.length, 0);
    const prompt = JSON.stringify(extractor.doGenerateCalls[0]?.prompt);
    assert.match(prompt, /Источник: Доска вакансий компании/u);
    assert.match(prompt, /Автор: Wrike/u);
    const saved = await db.select().from(vacancies).where(eq(vacancies.publicationId, row.id));
    assert.deepEqual(
      saved.map((vacancy) => vacancy.title),
      ['Account Development Manager'],
    );
  });
});
