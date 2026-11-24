import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

import { authors, contentHash, db, eq, markFailed, sources } from '@job-market/db';
import { z } from 'zod';

import type { Connector, ParsedPublication, ParseResult } from './contract.ts';
import { NOW, telegramConnector, testSource } from './drain.test-utils.ts';
import type { TestSource } from './drain.test-utils.ts';
import { telegramMessage } from './open-telegram/fake-telegram.test-utils.ts';
import { testConnector } from './test-connector.test-utils.ts';

/** Тесты идут в тестовую базу из `.env.test`: `pnpm db:up && pnpm db:migrate:test`. */
const PREFIX = 'test_connectors_drain_';

let source: TestSource;
let channel = '';

const message = (id: number, content?: string): ReturnType<typeof telegramMessage> =>
  telegramMessage(channel, id, {
    now: NOW,
    daysAgo: 1,
    ...(content === undefined ? {} : { content }),
  });

const channelOf = (messages: readonly ReturnType<typeof message>[]): Connector =>
  telegramConnector(new Map([[channel, messages]]));

const parsed = (id: number, overrides: Partial<ParsedPublication> = {}): ParsedPublication => ({
  externalId: `${channel}/${String(id)}`,
  url: `https://t.me/${channel}/${String(id)}`,
  content: `Вакансия ${String(id)}`,
  publishedAt: NOW,
  author: null,
  ...overrides,
});

/** Коннектор, `parse` которого отвечает заданным результатом. */
const parsing = (result: Error | ParseResult<unknown>): Connector =>
  testConnector('open-telegram', { parse: () => Promise.resolve(result) });

const setCursor = async (cursor: unknown): Promise<void> => {
  await db.update(sources).set({ cursor }).where(eq(sources.id, source.id()));
};

before(async () => {
  source = await testSource(PREFIX);
  channel = source.key;
});

beforeEach(async () => source.reset());

after(async () => source.close());

describe('drain of a Telegram channel', () => {
  test('writes the channel and its cursor once, and leaves the schedule alone', async () => {
    const history = Array.from({ length: 10 }, (_, index) =>
      message(index + 1, index === 4 ? '🔥🔥🔥' : undefined),
    );
    const lastFetchedAt = new Date('2026-11-19T00:00:00.000Z');
    await db
      .update(sources)
      .set({ consecutiveFailures: 2, lastFetchedAt })
      .where(eq(sources.id, source.id()));
    const { nextRunAt } = await source.row();

    const result = await source.drain(channelOf(history));

    assert.deepEqual(result, { status: 'done', inserted: 10, cursor: { cursorId: 10 } });
    const rows = await source.publications();
    assert.equal(rows.length, 10);
    // Пост из одних эмодзи тоже ждёт разбора: пустоту определяет классификатор.
    assert.ok(rows.every((row) => row.status === 'pending'));
    const channelAuthors = await db.select().from(authors).where(eq(authors.externalId, channel));
    assert.equal(channelAuthors.length, 1);
    assert.ok(
      rows.every((row) => row.authorId === channelAuthors[0]?.id && row.sourceId === source.id()),
    );
    const drained = await source.row();
    assert.deepEqual(drained.cursor, { cursorId: 10 });
    assert.equal(drained.consecutiveFailures, 2);
    assert.deepEqual(drained.nextRunAt, nextRunAt);
    assert.deepEqual(drained.lastFetchedAt, lastFetchedAt);

    await setCursor(null);
    const again = await source.drain(channelOf(history));

    assert.equal(again.inserted, 0);
    assert.equal((await source.publications()).length, 10);
  });

  test('a publication written before stays as it was, even when it failed', async () => {
    await markFailed(
      db,
      {
        sourceId: source.id(),
        connector: 'open-telegram',
        externalId: `${channel}/2`,
        url: `https://t.me/${channel}/2`,
        content: 'Старый текст',
        postedAt: NOW,
        contentHash: contentHash('Старый текст'),
      },
      'model timeout',
    );

    const result = await source.drain(channelOf([message(1), message(2), message(3)]));

    assert.equal(result.inserted, 2);
    const failed = await source.publication(`${channel}/2`);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.content, 'Старый текст');
  });
});

describe('drain results', () => {
  test('parse failed: nothing is written and the cursor stays', async () => {
    await setCursor({ cursorId: 3 });

    const result = await source.drain(parsing(new Error('HTTP 503')));

    assert.equal(result.status, 'failed');
    assert.equal(result.error?.message, 'HTTP 503');
    assert.equal((await source.publications()).length, 0);
    assert.deepEqual((await source.row()).cursor, { cursorId: 3 });
  });

  test('a service failure mid-pass writes what was read and the new cursor', async () => {
    const connector = parsing({
      publications: [1, 2, 3, 4, 5].map((id) => parsed(id)),
      cursor: { passTopId: 9, resumeBeforeId: 5 },
      more: false,
      error: new Error('HTTP 429'),
    });

    const result = await source.drain(connector);

    assert.equal(result.status, 'failed');
    assert.equal(result.inserted, 5);
    assert.deepEqual((await source.row()).cursor, { passTopId: 9, resumeBeforeId: 5 });
  });

  test('more to read: more, and the cursor is written', async () => {
    const connector = parsing({
      publications: [parsed(1)],
      cursor: { runId: 'run-1' },
      more: true,
    });

    const result = await source.drain(connector);

    assert.equal(result.status, 'more');
    assert.deepEqual((await source.row()).cursor, { runId: 'run-1' });
  });

  test('a publication without a date is posted now', async () => {
    const connector = parsing({
      publications: [parsed(1, { publishedAt: null })],
      cursor: null,
      more: false,
    });

    await source.drain(connector);

    assert.deepEqual((await source.publication(`${channel}/1`)).postedAt, NOW);
  });

  test('a config of another shape fails without calling parse', async () => {
    let called = false;
    const connector = testConnector('open-telegram', {
      configSchema: z.strictObject({ channel: z.string() }),
      parse: () => {
        called = true;
        return Promise.resolve({ publications: [], cursor: null, more: false });
      },
    });

    const result = await source.drain(connector);

    assert.equal(result.status, 'failed');
    assert.ok(result.error instanceof Error);
    assert.equal(called, false);
  });

  test('a write the database rejects writes nothing and is an Error', async () => {
    await setCursor({ cursorId: 3 });
    const author = {
      externalId: `${PREFIX}author`,
      name: 'Автор',
      url: 'https://t.me/a',
      headline: null,
    };
    const connector = parsing({
      publications: [parsed(1, { author }), parsed(2, { author, content: 'Текст с \u0000' })],
      cursor: { cursorId: 9 },
      more: false,
    });

    const result = await connector.drain(await source.row(), {
      now: NOW,
      deadline: Date.now() + 60_000,
    });

    assert.ok(result instanceof Error);
    assert.equal((await source.publications()).length, 0);
    const written = await db
      .select()
      .from(authors)
      .where(eq(authors.externalId, author.externalId));
    assert.equal(written.length, 0);
    assert.deepEqual((await source.row()).cursor, { cursorId: 3 });
  });
});
