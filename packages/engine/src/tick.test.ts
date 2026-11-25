import assert from 'node:assert/strict';
import { after, beforeEach, describe, test } from 'node:test';

import { createConnectors, createLinkedinChannel } from '@job-market/connectors';
import type { Connector } from '@job-market/connectors';
import { fakeTelegram, telegramMessage, testConnector } from '@job-market/connectors/test-utils';
import { authors, db, eq, getDb, inArray, like, publications, sources } from '@job-market/db';
import type { NewSourceRow, SourceRow } from '@job-market/db';
import { fakeReader } from '@job-market/enricher/test-utils';

import { handleDrainSourceJob } from './drain-source-job.ts';
import { memoryJobQueue } from './memory-job-queue.test-utils.ts';
import type { MemoryJobQueue } from './memory-job-queue.test-utils.ts';
import { spreadDelay } from './schedule.ts';
import { tick } from './tick.ts';

/**
 * Тесты идут в тестовую базу из `.env.test`: `pnpm db:up && pnpm db:migrate:test`. Тик видит
 * все источники своих коннекторов (E4 тика), поэтому `NOW` — в 2001 году, а `next_run_at` источников
 * файла — не позже него. Источники других тестов стоят на `now()` базы или на `infinity`, и тик
 * их не берёт. Ключи источников файла начинаются с `PREFIX`, тест удаляет только свои строки.
 */
const PREFIX = 'test_engine_tick_';

const NOW = new Date('2001-01-01T05:15:00.000Z');
const MINUTE_MS = 60 * 1000;
const minutesFromNow = (minutes: number): Date => new Date(NOW.getTime() + minutes * MINUTE_MS);

let created = 0;

/** Строка нового источника open-telegram, пора опросить; поля можно переопределить. */
function sourceValues(overrides: Partial<NewSourceRow> = {}): NewSourceRow {
  created += 1;
  const key = `${PREFIX}${String(created)}`;
  return {
    connector: 'open-telegram',
    key,
    platform: 'geekjobs',
    name: key,
    intervalMinutes: 60,
    nextRunAt: minutesFromNow(-15),
    ...overrides,
  };
}

async function createSources(rows: readonly NewSourceRow[]): Promise<SourceRow[]> {
  return db
    .insert(sources)
    .values([...rows])
    .returning();
}

async function createSource(overrides: Partial<NewSourceRow> = {}): Promise<SourceRow> {
  const [row] = await createSources([sourceValues(overrides)]);
  assert.ok(row !== undefined);
  return row;
}

/** `next_run_at` источников файла по id. */
async function runTimes(): Promise<Map<string, Date>> {
  const rows = await db
    .select({ id: sources.id, nextRunAt: sources.nextRunAt })
    .from(sources)
    .where(like(sources.key, `${PREFIX}%`));
  return new Map(rows.map((row) => [row.id, row.nextRunAt]));
}

/** Реестр из одного коннектора open-telegram: `drain` тик не зовёт. */
const telegramOnly: ReadonlyMap<string, Connector> = new Map([
  ['open-telegram', testConnector('open-telegram')],
]);

/** Очередь в памяти, которая считает вызовы `enqueue`. */
function countingQueue(failOnBatch?: number): MemoryJobQueue & {
  readonly batches: () => readonly number[];
} {
  const queue = memoryJobQueue(failOnBatch === undefined ? {} : { failOnBatch });
  const batches: number[] = [];
  return {
    jobs: queue.jobs,
    batches: () => batches,
    enqueue: async (jobs) => {
      batches.push(jobs.length);
      return queue.enqueue(jobs);
    },
  };
}

const sortedIds = (ids: Iterable<string>): string[] => [...ids].toSorted();

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

// Перед каждым тестом: источник, который оставил должным прошлый тест, попал бы в тик этого.
beforeEach(removeRows);

after(async () => {
  await removeRows();
  await getDb().$client.end();
});

describe('tick', () => {
  test('queues a job for each due source and moves its next run, leaving the rest', async () => {
    const due = await createSources([
      sourceValues({ nextRunAt: minutesFromNow(-60) }),
      sourceValues({ nextRunAt: NOW }),
      sourceValues({ intervalMinutes: 1440 }),
    ]);
    const rest = await createSources([
      sourceValues({ enabled: false }),
      sourceValues({ nextRunAt: minutesFromNow(60) }),
      sourceValues({ connector: 'linkedin', platform: 'linkedin' }),
    ]);
    const before = await runTimes();
    const queue = memoryJobQueue();

    const result = await tick({ now: NOW, connectors: telegramOnly, queue });

    assert.deepEqual(result, { due: 3, enqueued: 3 });
    assert.deepEqual(
      queue.jobs.toSorted((a, b) => a.sourceId.localeCompare(b.sourceId)),
      due
        .map((source) => ({
          sourceId: source.id,
          delaySeconds: spreadDelay(source.id),
          idempotencyKey: `${source.id}:2001-01-01T05:15:00.000Z`,
        }))
        .toSorted((a, b) => a.sourceId.localeCompare(b.sourceId)),
    );
    const moved = await runTimes();
    for (const source of due) {
      assert.deepEqual(moved.get(source.id), minutesFromNow(source.intervalMinutes));
    }
    for (const source of rest) {
      assert.deepEqual(moved.get(source.id), before.get(source.id));
    }
  });

  test('takes at most the limit, the earliest next runs first', async () => {
    const [latest, earliest, middle] = await createSources([
      sourceValues({ nextRunAt: minutesFromNow(-10) }),
      sourceValues({ nextRunAt: minutesFromNow(-30) }),
      sourceValues({ nextRunAt: minutesFromNow(-20) }),
    ]);
    assert.ok(latest !== undefined && earliest !== undefined && middle !== undefined);
    const queue = memoryJobQueue();

    const result = await tick({ now: NOW, connectors: telegramOnly, queue, limit: 2 });

    assert.deepEqual(result, { due: 2, enqueued: 2 });
    assert.deepEqual(
      sortedIds(queue.jobs.map((job) => job.sourceId)),
      sortedIds([earliest.id, middle.id]),
    );
    assert.deepEqual((await runTimes()).get(latest.id), minutesFromNow(-10));
  });

  test('two ticks at once queue each due source once (E1)', async () => {
    const due = await createSources([sourceValues(), sourceValues(), sourceValues()]);
    const queue = memoryJobQueue();

    const results = await Promise.all([
      tick({ now: NOW, connectors: telegramOnly, queue }),
      tick({ now: NOW, connectors: telegramOnly, queue }),
    ]);
    const repeat = await tick({ now: NOW, connectors: telegramOnly, queue });

    const taken = results.reduce((sum, result) => {
      assert.ok(!(result instanceof Error));
      return sum + result.due;
    }, 0);
    assert.equal(taken, 3);
    assert.deepEqual(repeat, { due: 0, enqueued: 0 });
    assert.deepEqual(
      sortedIds(queue.jobs.map((job) => job.sourceId)),
      sortedIds(due.map((source) => source.id)),
    );
  });

  test('a backlog over the limit goes in batches of 100, the rest to the next tick (E3)', async () => {
    await createSources(Array.from({ length: 2500 }, () => sourceValues()));
    const first = countingQueue();
    const second = countingQueue();

    const firstResult = await tick({ now: NOW, connectors: telegramOnly, queue: first });
    const secondResult = await tick({ now: NOW, connectors: telegramOnly, queue: second });

    assert.deepEqual(firstResult, { due: 2000, enqueued: 2000 });
    assert.deepEqual(
      first.batches(),
      Array.from({ length: 20 }, () => 100),
    );
    assert.deepEqual(secondResult, { due: 500, enqueued: 500 });
    assert.deepEqual(second.batches(), [100, 100, 100, 100, 100]);
  });

  test('a failed batch returns its sources and the later ones to the next tick (E2)', async () => {
    await createSources(
      Array.from({ length: 500 }, (_, index) =>
        sourceValues({ nextRunAt: minutesFromNow(-1000 + index) }),
      ),
    );
    const before = await runTimes();
    const failing = countingQueue(3);

    const result = await tick({ now: NOW, connectors: telegramOnly, queue: failing });

    assert.ok(result instanceof Error);
    assert.equal(
      result.message,
      'Enqueueing drain jobs failed: 200 of 500 sent, 300 sources returned to the next tick',
    );
    assert.deepEqual(failing.batches(), [100, 100, 100]);
    assert.equal(failing.jobs.length, 200);
    const sent = new Set(failing.jobs.map((job) => job.sourceId));
    const afterFailure = await runTimes();
    const returned = [...before.keys()].filter((id) => !sent.has(id));
    for (const id of returned) {
      assert.deepEqual(afterFailure.get(id), before.get(id));
    }
    for (const id of sent) {
      assert.deepEqual(afterFailure.get(id), minutesFromNow(60));
    }

    const next = memoryJobQueue();
    const retry = await tick({ now: NOW, connectors: telegramOnly, queue: next });

    assert.deepEqual(retry, { due: 300, enqueued: 300 });
    assert.deepEqual(sortedIds(next.jobs.map((job) => job.sourceId)), sortedIds(returned));
  });

  test('the jobs of a tick drain the Telegram channel into the database', async () => {
    const source = await createSource();
    const messages = Array.from({ length: 10 }, (_, index) =>
      telegramMessage(source.key, index + 1, { now: NOW, daysAgo: 1 }),
    );
    const connectors = createConnectors({
      telegram: fakeTelegram(new Map([[source.key, messages]])),
      linkedin: createLinkedinChannel({ token: 'test-token' }),
      models: { classifier: 'unused-in-drain', extractor: 'unused-in-drain' },
      readers: [fakeReader({ match: () => null })],
    });
    const queue = memoryJobQueue();
    // Заданиям разбора тест считает только число: поля задания ему не нужны.
    const mineQueue = memoryJobQueue<{ readonly publicationId: string }>();

    const result = await tick({ now: NOW, connectors, queue });
    const drained = await Promise.all(
      queue.jobs.map(async (job) =>
        handleDrainSourceJob({
          sourceId: job.sourceId,
          connectors,
          queue,
          mineQueue,
          now: NOW,
          deadline: Date.now() + 600_000,
        }),
      ),
    );

    assert.deepEqual(result, { due: 1, enqueued: 1 });
    assert.deepEqual(drained, [{ status: 'done', inserted: 10 }]);
    const written = await db
      .select({ id: publications.id })
      .from(publications)
      .where(eq(publications.sourceId, source.id));
    assert.equal(written.length, 10);
    assert.equal(mineQueue.jobs.length, 10);
    const [row] = await db
      .select({ cursor: sources.cursor })
      .from(sources)
      .where(eq(sources.id, source.id));
    assert.deepEqual(row?.cursor, { cursorId: 10 });
  });
});
