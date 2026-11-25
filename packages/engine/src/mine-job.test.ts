// oxlint-disable max-lines -- случаи обработчика делят одну тестовую базу и помощники
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import type { Connector, ProcessOutcome } from '@job-market/connectors';
import { extractedRole, testConnector } from '@job-market/connectors/test-utils';
import type { TestConnectorParts } from '@job-market/connectors/test-utils';
import {
  authors,
  companies,
  companyKeys,
  db,
  eq,
  getDb,
  inArray,
  like,
  publications,
  sources,
  sql,
  vacancies,
} from '@job-market/db';
import type { NewPublicationRow, PublicationRow } from '@job-market/db';

import type { MineJob } from './job-queue.ts';
import { memoryJobQueue } from './memory-job-queue.test-utils.ts';
import type { MemoryJobQueue } from './memory-job-queue.test-utils.ts';
import { handleMineJob } from './mine-job.ts';

/**
 * Тесты идут в тестовую базу из `.env.test`: `pnpm db:up && pnpm db:migrate:test`. Ключ
 * источника, `external_id` и `content_hash` публикаций, авторы и компании начинаются с
 * `PREFIX`, а `next_run_at` источника — `infinity`: тесты других пакетов их не берут (E6 разбора).
 */
const PREFIX = 'test_engine_mine_';
const COMPANY = `${PREFIX}Acme`;
const NOW = new Date('2026-11-20T12:00:00.000Z');
const MINUTE_MS = 60 * 1000;

let sourceId = '';
let created = 0;

/** Новая публикация open-telegram; поля по умолчанию можно переопределить. */
async function addPublication(overrides: Partial<NewPublicationRow> = {}): Promise<PublicationRow> {
  created += 1;
  const externalId = `${PREFIX}forhr/${String(created)}`;
  const [row] = await db
    .insert(publications)
    .values({
      sourceId,
      connector: 'open-telegram',
      externalId,
      url: `https://t.me/${externalId}`,
      content: `Product Manager и Designer в Acme, ${String(created)}`,
      postedAt: NOW,
      contentHash: `${PREFIX}${String(created)}`,
      ...overrides,
    })
    .returning();
  assert.ok(row !== undefined);
  return row;
}

async function publicationRow(id: string): Promise<PublicationRow> {
  const [row] = await db.select().from(publications).where(eq(publications.id, id));
  assert.ok(row !== undefined);
  return row;
}

/** Публикация, которую получает `process`. */
type PublicationForModel = Parameters<NonNullable<TestConnectorParts['process']>>[0];

/** Коннектор open-telegram, `process` которого отвечает заданным итогом и запоминает вызовы. */
function processing(
  result: (
    publication: PublicationForModel,
  ) => Error | ProcessOutcome | Promise<Error | ProcessOutcome>,
): {
  readonly connectors: ReadonlyMap<string, Connector>;
  readonly calls: readonly PublicationForModel[];
} {
  const calls: PublicationForModel[] = [];
  const connector = testConnector('open-telegram', {
    process: async (publication) => {
      calls.push(publication);
      return result(publication);
    },
  });
  return { connectors: new Map([[connector.id, connector]]), calls };
}

function rolesTitled(...titles: readonly string[]): ProcessOutcome {
  return {
    kind: 'vacancy',
    roles: titles.map((title) => extractedRole({ company: COMPANY, title })),
  };
}

async function run(
  publication: Pick<PublicationRow, 'id'>,
  connectors: ReadonlyMap<string, Connector>,
  queue: MemoryJobQueue<MineJob> = memoryJobQueue<MineJob>(),
): ReturnType<typeof handleMineJob> {
  return handleMineJob({ publicationId: publication.id, connectors, queue, now: NOW });
}

/** Удаляет публикации файла с их вакансиями, источник, авторов и компании. */
async function removeRows(): Promise<void> {
  await db.delete(publications).where(like(publications.externalId, `${PREFIX}%`));
  await db.delete(authors).where(like(authors.externalId, `${PREFIX}%`));
  await db.delete(sources).where(like(sources.key, `${PREFIX}%`));
  const found = await db
    .select({ id: companies.id })
    .from(companies)
    .where(like(companies.name, `${PREFIX}%`));
  const ids = found.map((company) => company.id);
  if (ids.length === 0) return;
  await db.delete(companyKeys).where(inArray(companyKeys.companyId, ids));
  await db.delete(companies).where(inArray(companies.id, ids));
}

before(async () => {
  await removeRows();
  const [source] = await db
    .insert(sources)
    .values({
      connector: 'open-telegram',
      key: `${PREFIX}forhr`,
      platform: 'geekjobs',
      name: PREFIX,
      nextRunAt: sql`'infinity'`,
    })
    .returning({ id: sources.id });
  assert.ok(source !== undefined);
  sourceId = source.id;
});

after(async () => {
  await removeRows();
  await getDb().$client.end();
});

describe('handleMineJob', () => {
  test('mines a pending publication, and a repeated delivery skips it', async () => {
    const publication = await addPublication();
    const { connectors, calls } = processing(() => rolesTitled('Product Manager', 'Designer'));

    const first = await run(publication, connectors);
    const repeat = await run(publication, connectors);

    assert.deepEqual(first, { status: 'vacancy', vacancies: 2 });
    assert.deepEqual(repeat, { status: 'skipped', vacancies: 0 });
    assert.equal(calls.length, 1);
    const row = await publicationRow(publication.id);
    assert.equal(row.status, 'vacancy');
    assert.equal(row.attempts, 1);
    assert.deepEqual(row.claimedAt, NOW);
    const saved = await db
      .select({ id: vacancies.id })
      .from(vacancies)
      .where(eq(vacancies.publicationId, publication.id));
    assert.equal(saved.length, 2);
  });

  test('gives process the publication with its author or without one, and returns not_vacancy', async () => {
    const [author] = await db
      .insert(authors)
      .values({
        connector: 'open-telegram',
        externalId: `${PREFIX}forhr`,
        name: 'For HR',
        url: 'https://t.me/forhr',
      })
      .returning({ id: authors.id });
    assert.ok(author !== undefined);
    const withAuthor = await addPublication({ authorId: author.id });
    const withoutAuthor = await addPublication();
    const { connectors, calls } = processing(() => ({
      kind: 'not_vacancy',
      reason: 'trash',
      note: 'резюме',
    }));

    assert.deepEqual(await run(withAuthor, connectors), { status: 'not_vacancy', vacancies: 0 });
    await run(withoutAuthor, connectors);

    assert.deepEqual(
      calls.map(({ content, postedAt, author: from }) => ({ content, postedAt, author: from })),
      [
        {
          content: withAuthor.content,
          postedAt: NOW,
          author: { name: 'For HR', url: 'https://t.me/forhr', headline: null },
        },
        { content: withoutAuthor.content, postedAt: NOW, author: null },
      ],
    );
  });

  test('returns duplicate when mine finds all roles saved from another publication', async () => {
    const original = await addPublication();
    const copy = await addPublication();
    // Роли, которых нет у публикаций других случаев файла.
    const { connectors } = processing(() => rolesTitled('Data Analyst', 'QA Engineer'));
    await run(original, connectors);

    const result = await run(copy, connectors);

    assert.deepEqual(result, { status: 'duplicate', vacancies: 0 });
    const row = await publicationRow(copy.id);
    assert.equal(row.status, 'duplicate');
    assert.equal(row.duplicateOfId, original.id);
    assert.equal(row.attempts, 1);
  });

  test('takes a processing publication only after the claim timed out', async () => {
    const fresh = await addPublication({
      status: 'processing',
      attempts: 1,
      claimedAt: new Date(NOW.getTime() - 5 * MINUTE_MS),
    });
    const stale = await addPublication({
      status: 'processing',
      attempts: 1,
      claimedAt: new Date(NOW.getTime() - 20 * MINUTE_MS),
    });
    const { connectors, calls } = processing(() => ({ kind: 'not_vacancy', reason: 'empty' }));

    assert.deepEqual(await run(fresh, connectors), { status: 'skipped', vacancies: 0 });
    assert.deepEqual(await run(stale, connectors), { status: 'not_vacancy', vacancies: 0 });
    assert.equal(calls.length, 1);
    assert.equal((await publicationRow(stale.id)).attempts, 2);
  });

  test('skips a publication of an unregistered connector and a missing one', async () => {
    const publication = await addPublication();
    const linkedin = testConnector('linkedin');
    const connectors = new Map([[linkedin.id, linkedin]]);

    assert.deepEqual(await run(publication, connectors), { status: 'skipped', vacancies: 0 });
    assert.deepEqual(await run({ id: randomUUID() }, connectors), {
      status: 'skipped',
      vacancies: 0,
    });
    assert.deepEqual(await publicationRow(publication.id), publication);
  });

  test('marks a copy of a mined text as duplicate without calling the models', async () => {
    const original = await addPublication({ status: 'vacancy' });
    const copy = await addPublication({ contentHash: original.contentHash });
    const { connectors, calls } = processing(() => new Error('process is not expected'));

    const result = await run(copy, connectors);

    assert.deepEqual(result, { status: 'duplicate', vacancies: 0 });
    assert.equal(calls.length, 0);
    const row = await publicationRow(copy.id);
    assert.equal(row.status, 'duplicate');
    assert.equal(row.duplicateOfId, original.id);
    assert.deepEqual(row.processedAt, NOW);
  });

  test('returns a failed attempt to pending and queues its retry', async () => {
    const publication = await addPublication();
    const { connectors } = processing(() => new Error('HTTP 429'));
    const queue = memoryJobQueue<MineJob>();

    const result = await run(publication, connectors, queue);

    assert.deepEqual(result, { status: 'retrying', vacancies: 0 });
    const row = await publicationRow(publication.id);
    assert.equal(row.status, 'pending');
    assert.equal(row.lastError, 'HTTP 429');
    assert.deepEqual(queue.jobs, [
      { publicationId: publication.id, delaySeconds: 300, idempotencyKey: `${publication.id}:1` },
    ]);
  });

  test('fails the publication on the third failed attempt', async () => {
    const publication = await addPublication({ attempts: 2 });
    const { connectors } = processing(() => new Error('HTTP 429'));
    const queue = memoryJobQueue<MineJob>();

    const result = await run(publication, connectors, queue);

    assert.deepEqual(result, { status: 'failed', vacancies: 0 });
    const row = await publicationRow(publication.id);
    assert.equal(row.status, 'failed');
    assert.equal(row.attempts, 3);
    assert.deepEqual(row.processedAt, NOW);
    assert.deepEqual(queue.jobs, []);
  });

  test('returns the failure to send a retry, and the next delivery takes the publication', async () => {
    const publication = await addPublication();
    const { connectors, calls } = processing(() => new Error('HTTP 429'));

    const result = await run(publication, connectors, memoryJobQueue<MineJob>({ failOnBatch: 1 }));

    assert.ok(result instanceof Error);
    const row = await publicationRow(publication.id);
    assert.equal(row.status, 'pending');
    assert.equal(row.attempts, 1);
    await run(publication, connectors);
    assert.equal(calls.length, 2);
    assert.equal((await publicationRow(publication.id)).attempts, 2);
  });

  test('a failure does not overwrite the outcome another handler already wrote', async () => {
    const publication = await addPublication();
    // Первый обработчик записал итог, пока второй ждал модель (E3 разбора).
    const { connectors } = processing(async () => {
      await db
        .update(publications)
        .set({ status: 'vacancy' })
        .where(eq(publications.id, publication.id));
      return new Error('HTTP 429');
    });

    await run(publication, connectors);

    assert.equal((await publicationRow(publication.id)).status, 'vacancy');
  });
});
