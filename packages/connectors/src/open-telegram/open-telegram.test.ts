import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { DEPTH_DAYS } from '../contract.ts';
import type { ParseResult, Processor } from '../contract.ts';
import { fakeTelegram, telegramMessage } from './fake-telegram.test-utils.ts';
import type { FakeTelegram } from './fake-telegram.test-utils.ts';
import { openTelegram } from './index.ts';
import type { TelegramMessage } from './parse-page.ts';
import type { TelegramCursor } from './parse.ts';

const NOW = new Date('2026-11-20T12:00:00.000Z');
const SINCE = new Date(NOW.getTime() - DEPTH_DAYS * 24 * 60 * 60 * 1000);
const CHANNEL = 'forhr';

const process: Processor = () => Promise.resolve(new Error('not used'));

function message(id: number, daysAgo: number, content?: string): TelegramMessage {
  return telegramMessage(CHANNEL, id, {
    now: NOW,
    daysAgo,
    ...(content === undefined ? {} : { content }),
  });
}

async function parse(
  telegram: FakeTelegram,
  cursor: TelegramCursor | null,
  deadline = Date.now() + 60_000,
): Promise<ParseResult<TelegramCursor>> {
  const result = await openTelegram({ telegram, process }).parse({
    config: {},
    cursor,
    key: CHANNEL,
    since: SINCE,
    deadline,
  });
  assert.ok(!(result instanceof Error), result instanceof Error ? result.message : '');
  return result;
}

/** Id публикаций по возрастанию номера: страницы идут от новых к старым. */
const ids = (result: ParseResult<TelegramCursor>): string[] =>
  result.publications
    .map((publication) => publication.externalId)
    .toSorted((a, b) => Number(a.split('/')[1]) - Number(b.split('/')[1]));

describe('open-telegram parse', () => {
  test('first pass takes the last 30 days, the next one only what is newer', async () => {
    const history = Array.from({ length: 10 }, (_, index) => message(index + 1, 20 - index));
    const telegram = fakeTelegram(new Map([[CHANNEL, history]]));

    const first = await parse(telegram, null);

    assert.equal(first.publications.length, 10);
    assert.deepEqual(first.cursor, { cursorId: 10 });
    assert.equal(first.more, false);
    assert.equal(first.error, undefined);

    history.push(message(11, 0), message(12, 0));
    const second = await parse(telegram, first.cursor);

    assert.deepEqual(ids(second), [`${CHANNEL}/11`, `${CHANNEL}/12`]);
    assert.deepEqual(second.cursor, { cursorId: 12 });
  });

  test('stops at the depth boundary', async () => {
    // Номера 1–10 через три дня: 1–2 старше 30 дней, 3 — ровно на границе и попадает.
    const history = Array.from({ length: 10 }, (_, index) => message(index + 1, 36 - index * 3));

    const result = await parse(fakeTelegram(new Map([[CHANNEL, history]])), null);

    assert.deepEqual(
      ids(result),
      [3, 4, 5, 6, 7, 8, 9, 10].map((id) => `${CHANNEL}/${String(id)}`),
    );
    assert.deepEqual(result.cursor, { cursorId: 10 });
  });

  test('a failed page keeps what was read and the next call resumes without a gap', async () => {
    const history = Array.from({ length: 12 }, (_, index) => message(index + 1, 12 - index));
    const messages = new Map([[CHANNEL, history]]);

    const failed = await parse(fakeTelegram(messages, { pageSize: 7, failOnCall: 2 }), null);

    assert.deepEqual(
      ids(failed),
      [6, 7, 8, 9, 10, 11, 12].map((id) => `${CHANNEL}/${String(id)}`),
    );
    assert.deepEqual(failed.cursor, { passTopId: 12, resumeBeforeId: 6 });
    assert.ok(failed.error instanceof Error);

    const resumed = await parse(fakeTelegram(messages, { pageSize: 7 }), failed.cursor);

    assert.deepEqual(
      ids(resumed),
      [1, 2, 3, 4, 5].map((id) => `${CHANNEL}/${String(id)}`),
    );
    assert.deepEqual(resumed.cursor, { cursorId: 12 });
  });

  test('a resumed pass keeps the cursor of earlier passes', async () => {
    const history = Array.from({ length: 9 }, (_, index) => message(index + 1, 9 - index));
    const telegram = fakeTelegram(new Map([[CHANNEL, history]]));

    const result = await parse(telegram, { cursorId: 3, passTopId: 9, resumeBeforeId: 7 });

    assert.deepEqual(ids(result), [`${CHANNEL}/4`, `${CHANNEL}/5`, `${CHANNEL}/6`]);
    assert.deepEqual(result.cursor, { cursorId: 9 });
  });

  test('a failed first page is an Error', async () => {
    const telegram = fakeTelegram(new Map([[CHANNEL, [message(1, 1)]]]), { failOnCall: 1 });

    const result = await openTelegram({ telegram, process }).parse({
      config: {},
      cursor: { cursorId: 5 },
      key: CHANNEL,
      since: SINCE,
      deadline: Date.now() + 60_000,
    });

    assert.ok(result instanceof Error);
  });

  test('after the deadline no page is fetched and the pass continues next time', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 0 });
    const history = Array.from({ length: 9 }, (_, index) => message(index + 1, 9 - index));
    const telegram = fakeTelegram(new Map([[CHANNEL, history]]));
    const slow: FakeTelegram = {
      calls: 0,
      async fetchPage(channel, before) {
        const page = await telegram.fetchPage(channel, before);
        t.mock.timers.tick(2000);
        return page;
      },
    };

    const result = await parse(slow, null, 1000);

    assert.deepEqual(ids(result), [`${CHANNEL}/7`, `${CHANNEL}/8`, `${CHANNEL}/9`]);
    assert.deepEqual(result.cursor, { passTopId: 9, resumeBeforeId: 7 });
    assert.equal(result.more, true);

    const late = await parse(telegram, { cursorId: 4 }, 0);
    assert.deepEqual(late, { publications: [], cursor: { cursorId: 4 }, more: true });
  });

  test('maps a message to a publication of the channel', async () => {
    const telegram = fakeTelegram(
      new Map([[CHANNEL, [message(9119, 1, ''), message(9120, 1, '**Product Manager**')]]]),
    );

    const result = await parse(telegram, null);

    assert.deepEqual(result.publications, [
      {
        externalId: 'forhr/9119',
        url: 'https://t.me/forhr/9119',
        content: '',
        publishedAt: message(9119, 1).postedAt,
        author: {
          externalId: 'forhr',
          name: 'Канал forhr',
          url: 'https://t.me/forhr',
          headline: null,
        },
      },
      {
        externalId: 'forhr/9120',
        url: 'https://t.me/forhr/9120',
        content: '**Product Manager**',
        publishedAt: message(9120, 1).postedAt,
        author: {
          externalId: 'forhr',
          name: 'Канал forhr',
          url: 'https://t.me/forhr',
          headline: null,
        },
      },
    ]);
  });

  test('a cursor of another shape is a first pass', () => {
    const { cursorSchema } = openTelegram({ telegram: fakeTelegram(new Map()), process });

    assert.equal(cursorSchema.safeParse({}).success, false);
    assert.equal(cursorSchema.safeParse({ passTopId: 9 }).success, false);
    assert.equal(cursorSchema.safeParse({ cursorId: '10' }).success, false);
    assert.equal(cursorSchema.safeParse({ cursorId: 10 }).success, true);
    assert.equal(cursorSchema.safeParse({ passTopId: 9, resumeBeforeId: 7 }).success, true);
  });

  test('reads the channel from config, else from the source key', async () => {
    const telegram = fakeTelegram(
      new Map([
        ['forhr', [message(1, 1)]],
        ['geekjobs', [telegramMessage('geekjobs', 1, { now: NOW, daysAgo: 1 })]],
      ]),
    );
    const connector = openTelegram({ telegram, process });

    const result = await connector.parse({
      config: { channel: 'geekjobs' },
      cursor: null,
      key: CHANNEL,
      since: SINCE,
      deadline: Date.now() + 60_000,
    });

    assert.ok(!(result instanceof Error));
    assert.deepEqual(ids(result), ['geekjobs/1']);
    assert.equal(connector.configSchema.safeParse({ channel: '@forhr' }).success, false);
    assert.equal(connector.configSchema.safeParse({ channel: '' }).success, false);
    assert.equal(connector.configSchema.safeParse({}).success, true);
  });
});
