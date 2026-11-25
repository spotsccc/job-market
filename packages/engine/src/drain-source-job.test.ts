// oxlint-disable max-lines -- случаи обработчика делят одну тестовую базу и помощники
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import { createConnectors, createLinkedinChannel } from '@job-market/connectors';
import type { Connector, ParseResult } from '@job-market/connectors';
import { fakeTelegram, telegramMessage, testConnector } from '@job-market/connectors/test-utils';
import {
  asc,
  authors,
  db,
  eq,
  getDb,
  inArray,
  like,
  publications,
  sourceRuns,
  sources,
  sql,
} from '@job-market/db';
import type { NewSourceRow, SourceRow, SourceRunRow } from '@job-market/db';
import { fakeReader } from '@job-market/enricher/test-utils';

import { handleDrainSourceJob } from './drain-source-job.ts';
import type { MineJob } from './job-queue.ts';
import { memoryJobQueue } from './memory-job-queue.test-utils.ts';
import type { MemoryJobQueue } from './memory-job-queue.test-utils.ts';

/**
 * Тесты идут в тестовую базу из `.env.test`: `pnpm db:up && pnpm db:migrate:test`. Ключи
 * источников, публикаций и авторов начинаются с `PREFIX`, а `next_run_at` источников —
 * `infinity`: тесты других пакетов на той же базе их не берут (E5).
 */
const PREFIX = 'test_engine_job_';

const NOW = new Date('2026-11-20T12:00:00.000Z');
const HOUR_MS = 60 * 60 * 1000;
const DEADLINE = (): number => Date.now() + 600_000;

let created = 0;

/** Новый источник open-telegram с каналом по ключу; поля по умолчанию можно переопределить. */
async function createSource(overrides: Partial<NewSourceRow> = {}): Promise<SourceRow> {
  created += 1;
  const key = `${PREFIX}${String(created)}`;
  const [row] = await db
    .insert(sources)
    .values({
      connector: 'open-telegram',
      key,
      platform: 'geekjobs',
      name: key,
      intervalMinutes: 60,
      nextRunAt: sql`'infinity'`,
      ...overrides,
    })
    .returning();
  assert.ok(row !== undefined);
  return row;
}

async function sourceRow(id: string): Promise<SourceRow> {
  const [row] = await db.select().from(sources).where(eq(sources.id, id));
  assert.ok(row !== undefined);
  return row;
}

/** Строка как JSON без `updated_at`: `infinity` в `next_run_at` сравнивается как `null`. */
function plain(row: SourceRow): unknown {
  const { updatedAt: _updatedAt, ...rest } = row;
  return JSON.parse(JSON.stringify(rest));
}

/** Строка после задания — строка до него с изменёнными `changes`, остальное прежнее. */
async function assertChanged(previous: SourceRow, changes: Partial<SourceRow>): Promise<void> {
  const row = await sourceRow(previous.id);
  assert.deepEqual(plain(row), plain({ ...previous, ...changes }));
}

/** Строки истории опросов источника по порядку записи (П9 плана мониторинга). */
async function runsOf(
  source: Pick<SourceRow, 'id'>,
): Promise<Pick<SourceRunRow, 'status' | 'inserted' | 'error' | 'startedAt'>[]> {
  return db
    .select({
      status: sourceRuns.status,
      inserted: sourceRuns.inserted,
      error: sourceRuns.error,
      startedAt: sourceRuns.startedAt,
    })
    .from(sourceRuns)
    .where(eq(sourceRuns.sourceId, source.id))
    .orderBy(asc(sourceRuns.finishedAt), asc(sourceRuns.id));
}

/** Реестр из одного коннектора. */
const only = (connector: Connector): ReadonlyMap<string, Connector> =>
  new Map([[connector.id, connector]]);

/** Коннектор, `parse` которого отвечает заданным результатом и считает вызовы. */
function parsing(result: () => Error | ParseResult<unknown>): {
  readonly connectors: ReadonlyMap<string, Connector>;
  readonly calls: () => number;
} {
  let calls = 0;
  const connector = testConnector('open-telegram', {
    parse: async () => {
      await Promise.resolve();
      calls += 1;
      return result();
    },
  });
  return { connectors: only(connector), calls: () => calls };
}

/** Реестр `createConnectors` с поддельным t.me: модели и ссылки LinkedIn `drain` не зовёт. */
function telegramRegistry(channel: string): ReadonlyMap<string, Connector> {
  const messages = Array.from({ length: 10 }, (_, index) =>
    telegramMessage(channel, index + 1, {
      now: NOW,
      daysAgo: 1,
      ...(index === 4 ? { content: '🔥🔥🔥' } : {}),
    }),
  );
  return createConnectors({
    telegram: fakeTelegram(new Map([[channel, messages]])),
    linkedin: createLinkedinChannel({ token: 'test-token' }),
    models: { classifier: 'unused-in-drain', extractor: 'unused-in-drain' },
    readers: [fakeReader({ match: () => null })],
  });
}

/** Очереди и время задания; не заданные — новые очереди в памяти и `NOW`. */
type RunOptions = {
  readonly queue?: MemoryJobQueue;
  readonly mineQueue?: MemoryJobQueue<MineJob>;
  readonly now?: Date;
};

async function run(
  source: Pick<SourceRow, 'id'>,
  connectors: ReadonlyMap<string, Connector>,
  options: RunOptions = {},
): ReturnType<typeof handleDrainSourceJob> {
  return handleDrainSourceJob({
    sourceId: source.id,
    connectors,
    queue: options.queue ?? memoryJobQueue(),
    mineQueue: options.mineQueue ?? memoryJobQueue<MineJob>(),
    now: options.now ?? NOW,
    deadline: DEADLINE(),
  });
}

/** Задания разбора, которые обработчик опроса кладёт на новые публикации источника (П7). */
async function firstMineJobs(source: Pick<SourceRow, 'id'>): Promise<MineJob[]> {
  const rows = await db
    .select({ id: publications.id })
    .from(publications)
    .where(eq(publications.sourceId, source.id));
  return rows.map(({ id }) => ({ publicationId: id, delaySeconds: 0, idempotencyKey: `${id}:0` }));
}

/** Задания очереди по `publicationId`: порядок отправки тестам не важен. */
const sorted = (jobs: readonly MineJob[]): MineJob[] =>
  jobs.toSorted((a, b) => a.publicationId.localeCompare(b.publicationId));

const publication = (key: string, id: number, content = `Вакансия ${String(id)}`) => ({
  externalId: `${key}/${String(id)}`,
  url: `https://t.me/${key}/${String(id)}`,
  content,
  publishedAt: NOW,
  author: null,
});

/** Удаляет источники файла, их публикации и авторов-каналы. */
async function removeRows(): Promise<void> {
  const ours = db
    .select({ id: sources.id })
    .from(sources)
    .where(like(sources.key, `${PREFIX}%`));
  await db.delete(publications).where(inArray(publications.sourceId, ours));
  await db.delete(authors).where(like(authors.externalId, `${PREFIX}%`));
  await db.delete(sources).where(like(sources.key, `${PREFIX}%`));
}

// Строки прогона, упавшего до `after`, заняли бы ключи источников.
before(removeRows);

after(async () => {
  await removeRows();
  await getDb().$client.end();
});

describe('handleDrainSourceJob', () => {
  test('drains a Telegram channel, records the success, and a repeat adds nothing', async () => {
    const source = await createSource({ consecutiveFailures: 2, lastError: 'HTTP 503' });
    const connectors = telegramRegistry(source.key);
    const mineQueue = memoryJobQueue<MineJob>();

    const first = await run(source, connectors, { mineQueue });
    const repeat = await run(source, connectors, { mineQueue });

    assert.deepEqual(first, { status: 'done', inserted: 10 });
    assert.deepEqual(repeat, { status: 'done', inserted: 0 });
    await assertChanged(source, {
      cursor: { cursorId: 10 },
      lastFetchedAt: NOW,
      lastSuccessAt: NOW,
      consecutiveFailures: 0,
      lastError: null,
    });
    const statuses = await db
      .select({ status: publications.status })
      .from(publications)
      .where(eq(publications.sourceId, source.id));
    assert.equal(statuses.filter((row) => row.status === 'pending').length, 10);
    // Разбор — на каждую новую публикацию, пост из эмодзи тоже; повтор новых не дал.
    assert.deepEqual(await runsOf(source), [
      { status: 'done', inserted: 10, error: null, startedAt: NOW },
      { status: 'done', inserted: 0, error: null, startedAt: NOW },
    ]);
    assert.deepEqual(sorted(mineQueue.jobs), sorted(await firstMineJobs(source)));
  });

  test('a failed drain counts the failure, pauses the source and queues nothing', async () => {
    const source = await createSource({ consecutiveFailures: 2, lastError: 'HTTP 429' });
    const { connectors } = parsing(() => new Error('HTTP 503'));
    const queue = memoryJobQueue();
    // Пауза от далёкого `now`: источник не становится должным для тестов тика (E5).
    const now = new Date('2100-01-01T00:00:00.000Z');

    const result = await run(source, connectors, { queue, now });

    assert.deepEqual(result, { status: 'failed', inserted: 0 });
    await assertChanged(source, {
      lastFetchedAt: now,
      consecutiveFailures: 3,
      lastError: 'HTTP 503',
      nextRunAt: new Date(now.getTime() + 8 * HOUR_MS),
    });
    assert.deepEqual(queue.jobs, []);
    // Текст ошибки истории — тот же, что у источника (П10 плана мониторинга).
    assert.deepEqual(await runsOf(source), [
      { status: 'failed', inserted: 0, error: 'HTTP 503', startedAt: now },
    ]);
  });

  test('an unfinished drain records only the fetch time and queues a continuation', async () => {
    const lastSuccessAt = new Date('2026-11-18T00:00:00.000Z');
    const source = await createSource({
      consecutiveFailures: 1,
      lastError: 'HTTP 503',
      lastSuccessAt,
    });
    const { connectors } = parsing(() => ({
      publications: [publication(source.key, 1)],
      cursor: { page: 1 },
      more: true,
    }));
    const queue = memoryJobQueue();
    const mineQueue = memoryJobQueue<MineJob>();

    const result = await run(source, connectors, { queue, mineQueue });

    assert.deepEqual(result, { status: 'requeued', inserted: 1 });
    assert.deepEqual(mineQueue.jobs, await firstMineJobs(source));
    await assertChanged(source, { cursor: { page: 1 }, lastFetchedAt: NOW });
    assert.deepEqual(
      queue.jobs.map(({ sourceId, delaySeconds }) => ({ sourceId, delaySeconds })),
      [{ sourceId: source.id, delaySeconds: 60 }],
    );
    assert.deepEqual(await runsOf(source), [
      { status: 'more', inserted: 1, error: null, startedAt: NOW },
    ]);
  });

  test('continuations with different cursors get different keys, with the same — the same', async () => {
    const source = await createSource();
    let page = 1;
    const { connectors } = parsing(() => ({ publications: [], cursor: { page }, more: true }));
    const queue = memoryJobQueue();

    await run(source, connectors, { queue });
    await run(source, connectors, { queue });
    page = 2;
    await run(source, connectors, { queue });

    const keys = queue.jobs.map((job) => job.idempotencyKey);
    assert.equal(keys.length, 3);
    assert.equal(keys[0], keys[1]);
    assert.notEqual(keys[1], keys[2]);
  });

  test('skips a disabled source, a missing one and one without a registered connector', async () => {
    const disabled = await createSource({ enabled: false });
    const unregistered = await createSource({ connector: 'linkedin', platform: 'linkedin' });
    const { connectors, calls } = parsing(() => new Error('drain is not expected'));

    assert.deepEqual(await run(disabled, connectors), { status: 'skipped', inserted: 0 });
    assert.deepEqual(await run({ id: randomUUID() }, connectors), {
      status: 'skipped',
      inserted: 0,
    });
    assert.deepEqual(await run(unregistered, connectors), { status: 'skipped', inserted: 0 });

    assert.equal(calls(), 0);
    await assertChanged(disabled, {});
    await assertChanged(unregistered, {});
    assert.deepEqual(await runsOf(disabled), []);
    assert.deepEqual(await runsOf(unregistered), []);
  });

  test('returns the database failure of drain and leaves the source as it was', async () => {
    const source = await createSource({ consecutiveFailures: 1 });
    const { connectors } = parsing(() => ({
      publications: [publication(source.key, 1, 'текст с \u0000')],
      cursor: { page: 1 },
      more: false,
    }));
    const mineQueue = memoryJobQueue<MineJob>();

    const result = await run(source, connectors, { mineQueue });

    assert.ok(result instanceof Error);
    await assertChanged(source, {});
    assert.deepEqual(mineQueue.jobs, []);
    assert.deepEqual(await runsOf(source), []);
  });

  test('a repeat after the schedule was not written continues from the new cursor', async () => {
    const source = await createSource();
    const connectors = telegramRegistry(source.key);
    const connector = connectors.get('open-telegram');
    assert.ok(connector !== undefined);
    // drain записал публикации и курсор, а запись расписания не случилась (E4).
    const drained = await connector.drain(source, { now: NOW, deadline: DEADLINE() });
    assert.ok(!(drained instanceof Error));
    assert.equal(drained.inserted, 10);

    const result = await run(source, connectors);

    assert.deepEqual(result, { status: 'done', inserted: 0 });
    await assertChanged(source, {
      cursor: { cursorId: 10 },
      lastFetchedAt: NOW,
      lastSuccessAt: NOW,
    });
    // Первый проход истории не оставил: его расписание не записалось. Повтор пишет одну строку.
    assert.deepEqual(await runsOf(source), [
      { status: 'done', inserted: 0, error: null, startedAt: NOW },
    ]);
  });

  test('returns the failure to send the continuation, with the cursor already written', async () => {
    const source = await createSource();
    const { connectors } = parsing(() => ({ publications: [], cursor: { page: 1 }, more: true }));

    const result = await run(source, connectors, { queue: memoryJobQueue({ failOnBatch: 1 }) });

    assert.ok(result instanceof Error);
    assert.deepEqual((await sourceRow(source.id)).cursor, { page: 1 });
  });

  test('a service failure mid-pass still queues mining of what was read', async () => {
    const source = await createSource();
    const { connectors } = parsing(() => ({
      publications: [1, 2, 3, 4, 5].map((id) => publication(source.key, id)),
      cursor: { page: 1 },
      more: false,
      error: new Error('HTTP 429'),
    }));
    const mineQueue = memoryJobQueue<MineJob>();
    // Пауза от далёкого `now`: источник не становится должным для тестов тика (E5).
    const now = new Date('2100-01-01T00:00:00.000Z');

    const result = await run(source, connectors, { mineQueue, now });

    assert.deepEqual(result, { status: 'failed', inserted: 5 });
    assert.equal(mineQueue.jobs.length, 5);
    assert.deepEqual(await runsOf(source), [
      { status: 'failed', inserted: 5, error: 'HTTP 429', startedAt: now },
    ]);
    assert.deepEqual(sorted(mineQueue.jobs), sorted(await firstMineJobs(source)));
  });

  test('returns the failure to send mining, with the schedule written and no continuation', async () => {
    const source = await createSource();
    const { connectors } = parsing(() => ({
      publications: [publication(source.key, 1)],
      cursor: { page: 1 },
      more: true,
    }));
    const queue = memoryJobQueue();

    const result = await run(source, connectors, {
      queue,
      mineQueue: memoryJobQueue<MineJob>({ failOnBatch: 1 }),
    });

    assert.ok(result instanceof Error);
    await assertChanged(source, { cursor: { page: 1 }, lastFetchedAt: NOW });
    assert.deepEqual(queue.jobs, []);
  });
});
