/* oxlint-disable max-lines -- краулер и очередь делят таблицу, поэтому их тесты в одном файле */
import assert from 'node:assert/strict';
import { after, beforeEach, describe, test } from 'node:test';

import type { ChannelPage, TelegramChannel, TelegramMessage } from '@job-market/channel-telegram';
import { TelegramRequestError } from '@job-market/channel-telegram';
import {
  and,
  asc,
  db,
  eq,
  getDb,
  inArray,
  posts,
  sql,
  telegramChannels,
  telegramMessages,
  vacancies,
} from '@job-market/db';
import { MockLanguageModelV4 } from 'ai/test';

import type { PostProcessingModels } from '../post-processing/index.ts';
import { contentHash } from './content-hash.ts';
import { crawlChannels } from './crawl.ts';
import type { CrawlOptions } from './crawl.ts';
import { runTelegramJob } from './job.ts';
import { MAX_ATTEMPTS, processQueue } from './process-queue.ts';

/**
 * Тесты идут в тестовую базу из `.env.test`: `pnpm db:up && pnpm db:migrate:test`.
 * Краулер и очередь в одном файле: очередь берёт любые сообщения таблицы, а файлы
 * тестов `node --test` гоняет параллельно. Каналы тестов начинаются с `test_`.
 */

const CHANNELS = ['test_alpha', 'test_beta'] as const;
const NOW = new Date('2026-11-20T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

/** Сообщение `id` канала, опубликованное `daysAgo` дней назад. */
function message(
  channel: string,
  id: number,
  daysAgo: number,
  content = `Вакансия ${String(id)}`,
): TelegramMessage {
  return {
    channel,
    id,
    url: `https://t.me/${channel}/${String(id)}`,
    content,
    postedAt: new Date(NOW.getTime() - daysAgo * DAY_MS),
    authorName: `Канал ${channel}`,
  };
}

/**
 * Поддельный t.me: страницы по `pageSize` сообщений из списка, как у превью — самые
 * новые с номером меньше `before`, по возрастанию. `failOnCall` — номер вызова, на
 * котором отвечаем ошибкой.
 */
function fakeTelegram(
  messages: Map<string, TelegramMessage[]>,
  options: { readonly pageSize?: number; readonly failOnCall?: number } = {},
): Pick<TelegramChannel, 'fetchPage'> & { calls: number } {
  const pageSize = options.pageSize ?? 3;
  const fake = {
    calls: 0,
    fetchPage(channel: string, before?: number): Promise<TelegramRequestError | ChannelPage> {
      fake.calls += 1;
      if (fake.calls === options.failOnCall) {
        return Promise.resolve(new TelegramRequestError({ channel, cause: new Error('HTTP 429') }));
      }
      const older = (messages.get(channel) ?? [])
        .filter((item) => before === undefined || item.id < before)
        .toSorted((left, right) => left.id - right.id);
      return Promise.resolve({ messages: older.slice(-pageSize) });
    },
  };
  return fake;
}

function crawlOptions(
  telegram: Pick<TelegramChannel, 'fetchPage'>,
  overrides: Partial<CrawlOptions> = {},
): CrawlOptions {
  return {
    channels: ['test_alpha'],
    telegram,
    now: NOW,
    depthDays: 30,
    deadline: Date.now() + 60_000,
    startPassIfCrawledBefore: null,
    concurrency: 2,
    ...overrides,
  };
}

async function savedIds(channel: string): Promise<number[]> {
  const rows = await db
    .select({ messageId: telegramMessages.messageId })
    .from(telegramMessages)
    .where(eq(telegramMessages.channel, channel))
    .orderBy(asc(telegramMessages.messageId));
  return rows.map((row) => row.messageId);
}

async function channelState(
  channel: string,
): Promise<typeof telegramChannels.$inferSelect | undefined> {
  const [state] = await db
    .select()
    .from(telegramChannels)
    .where(eq(telegramChannels.channel, channel));
  return state;
}

/** Модель, которая отвечает JSON текстом, как провайдер при structured outputs. */
function mockModel(output: unknown): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: 'text', text: JSON.stringify(output) }],
      finishReason: { unified: 'stop', raw: 'end_turn' },
      usage: {
        inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 20, text: 20, reasoning: 0 },
      },
      warnings: [],
    },
  });
}

const EXTRACTED_VACANCY = {
  title: 'Product Manager',
  company: 'Acme',
  companyUrl: null,
  hiringParty: 'employer',
  seniority: 'senior',
  workplace: 'remote',
  isRemoteFromAnywhere: false,
  locations: ['EU'],
  employmentTypes: ['full_time'],
  salary: null,
  skills: [],
  relocation: null,
  visaSponsorship: null,
  apply: { urls: ['https://acme.dev/jobs/1'], emails: [], directMessage: false },
  summary: 'Вести продукт.',
};

function vacancyModels(): {
  readonly models: PostProcessingModels;
  readonly classifier: MockLanguageModelV4;
} {
  const classifier = mockModel({ verdict: 'vacancy', note: 'Нанимают' });
  return {
    models: { classifier, extractor: mockModel({ vacancies: [EXTRACTED_VACANCY] }) },
    classifier,
  };
}

async function insertMessages(items: readonly TelegramMessage[]): Promise<void> {
  await db.insert(telegramMessages).values(
    items.map((item) => ({
      channel: item.channel,
      messageId: item.id,
      url: item.url,
      content: item.content,
      postedAt: item.postedAt,
      authorName: item.authorName,
      contentHash: contentHash(item.content),
    })),
  );
}

async function cleanUp(): Promise<void> {
  await db.delete(telegramMessages).where(sql`${telegramMessages.channel} LIKE 'test\\_%'`);
  await db.delete(telegramChannels).where(sql`${telegramChannels.channel} LIKE 'test\\_%'`);
  await db
    .delete(posts)
    .where(and(eq(posts.source, 'telegram'), sql`${posts.externalId} LIKE 'test\\_%'`));
}

beforeEach(cleanUp);

after(async () => {
  await cleanUp();
  await getDb().$client.end();
});

describe('crawlChannels', () => {
  test('first pass saves everything within the depth and sets the cursor', async () => {
    // Номера 1–10, через три дня: 1–2 старше 30 дней, 3 — ровно на границе и попадает.
    const history = Array.from({ length: 10 }, (_, index) =>
      message('test_alpha', index + 1, 36 - index * 3),
    );
    const telegram = fakeTelegram(new Map([['test_alpha', history]]));

    const result = await crawlChannels(crawlOptions(telegram));

    assert.ok(!(result instanceof Error), result instanceof Error ? String(result.cause) : '');
    assert.deepEqual(result, [{ channel: 'test_alpha', status: 'done', inserted: 8, pages: 3 }]);
    assert.deepEqual(await savedIds('test_alpha'), [3, 4, 5, 6, 7, 8, 9, 10]);
    const state = await channelState('test_alpha');
    assert.ok(state !== undefined);
    assert.equal(state.cursorId, 10);
    assert.equal(state.passTopId, null);
    assert.deepEqual(state.lastCrawledAt, NOW);
  });

  test('next pass takes only new messages and stops at the cursor', async () => {
    const history = [1, 2, 3, 4, 5].map((id) => message('test_alpha', id, 10 - id));
    const telegram = fakeTelegram(new Map([['test_alpha', history]]));
    await crawlChannels(crawlOptions(telegram));

    history.push(message('test_alpha', 6, 0), message('test_alpha', 7, 0));
    telegram.calls = 0;
    const result = await crawlChannels(crawlOptions(telegram));

    assert.ok(!(result instanceof Error));
    assert.deepEqual(result, [{ channel: 'test_alpha', status: 'done', inserted: 2, pages: 1 }]);
    assert.deepEqual(await savedIds('test_alpha'), [1, 2, 3, 4, 5, 6, 7]);
    assert.equal((await channelState('test_alpha'))?.cursorId, 7);
  });

  test('an interrupted first pass resumes later without leaving a gap', async () => {
    const history = Array.from({ length: 9 }, (_, index) =>
      message('test_alpha', index + 1, 9 - index),
    );
    const messages = new Map([['test_alpha', history]]);
    // Вторая страница падает: записана только верхняя, 7–9.
    const failing = fakeTelegram(messages, { failOnCall: 2 });
    const first = await crawlChannels(crawlOptions(failing));
    assert.ok(!(first instanceof Error));
    assert.equal(first[0]?.status, 'failed');
    assert.deepEqual(await savedIds('test_alpha'), [7, 8, 9]);
    const interrupted = await channelState('test_alpha');
    assert.ok(interrupted !== undefined);
    assert.equal(interrupted.cursorId, null);
    assert.equal(interrupted.passTopId, 9);
    assert.equal(interrupted.resumeBeforeId, 7);

    // Пока проход стоял, в канале вышло сообщение 10. Доделываем проход, нового не начинаем.
    history.push(message('test_alpha', 10, 0));
    const resumed = await crawlChannels(
      crawlOptions(fakeTelegram(messages), { startPassIfCrawledBefore: NOW }),
    );
    assert.ok(!(resumed instanceof Error));
    assert.equal(resumed[0]?.status, 'done');
    assert.deepEqual(await savedIds('test_alpha'), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    assert.equal((await channelState('test_alpha'))?.cursorId, 9);

    // Следующий проход забирает 10.
    await crawlChannels(crawlOptions(fakeTelegram(messages)));
    assert.deepEqual(await savedIds('test_alpha'), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  test('does not start a new pass for a channel crawled recently', async () => {
    const messages = new Map([['test_alpha', [message('test_alpha', 1, 1)]]]);
    await crawlChannels(crawlOptions(fakeTelegram(messages)));

    const telegram = fakeTelegram(messages);
    const result = await crawlChannels(
      crawlOptions(telegram, { startPassIfCrawledBefore: new Date(NOW.getTime() - 1) }),
    );

    assert.ok(!(result instanceof Error));
    assert.equal(result[0]?.status, 'skipped');
    assert.equal(telegram.calls, 0);
  });

  test('stores messages without text as empty, so models never see them', async () => {
    const messages = new Map([
      ['test_alpha', [message('test_alpha', 1, 1, ''), message('test_alpha', 2, 1)]],
    ]);

    await crawlChannels(crawlOptions(fakeTelegram(messages)));

    const rows = await db
      .select({ messageId: telegramMessages.messageId, status: telegramMessages.status })
      .from(telegramMessages)
      .where(eq(telegramMessages.channel, 'test_alpha'))
      .orderBy(asc(telegramMessages.messageId));
    assert.deepEqual(rows, [
      { messageId: 1, status: 'empty' },
      { messageId: 2, status: 'pending' },
    ]);
  });
});

describe('processQueue', () => {
  test('saves the vacancy once for a post published in several channels', async () => {
    const text =
      '**Product Manager**\n**Acme**. Remote.\n[Job description.](https://acme.dev/jobs/1)';
    await insertMessages([
      message('test_alpha', 1, 2, `${text}\n\n**Больше вакансий в HR:** https://t.me/forhr`),
      message(
        'test_beta',
        1,
        1,
        `${text}\n\n**Больше вакансий для ТОПов:** https://t.me/forchiefs`,
      ),
      message('test_beta', 2, 1, 'Подкаст о найме'),
    ]);
    const { models, classifier } = vacancyModels();

    const result = await processQueue({ deadline: Date.now() + 60_000, concurrency: 2, models });

    assert.ok(!(result instanceof Error), result instanceof Error ? String(result.cause) : '');
    assert.equal(result.claimed, 2);
    assert.equal(classifier.doGenerateCalls.length, 2);

    const rows = await db
      .select()
      .from(telegramMessages)
      .where(inArray(telegramMessages.channel, [...CHANNELS]))
      .orderBy(asc(telegramMessages.channel), asc(telegramMessages.messageId));
    const [original, copy] = rows;
    // Разбирается самая ранняя копия, вторая помечается дублем.
    assert.equal(original?.status, 'vacancy');
    assert.equal(copy?.status, 'duplicate');
    assert.equal(copy.duplicateOfId, original.id);

    assert.ok(original.postId !== null);
    const [post] = await db.select().from(posts).where(eq(posts.id, original.postId));
    assert.equal(post?.source, 'telegram');
    assert.equal(post.externalId, 'test_alpha/1');
    assert.equal(post.authorUrl, 'https://t.me/test_alpha');
    const saved = await db.select().from(vacancies).where(eq(vacancies.postId, original.postId));
    assert.deepEqual(
      saved.map((vacancy) => vacancy.title),
      ['Product Manager'],
    );
  });

  test('records why a message is not a vacancy', async () => {
    await insertMessages([message('test_alpha', 1, 1, 'Статья о собеседованиях')]);
    const models = {
      classifier: mockModel({ verdict: 'not_hiring', note: 'Статья' }),
      extractor: new MockLanguageModelV4(),
    };

    await processQueue({ deadline: Date.now() + 60_000, concurrency: 2, models });

    const [row] = await db
      .select()
      .from(telegramMessages)
      .where(eq(telegramMessages.channel, 'test_alpha'));
    assert.equal(row?.status, 'not_vacancy');
    assert.equal(row.notVacancyReason, 'not_hiring');
    assert.equal(row.note, 'Статья');
    assert.equal(row.postId, null);
  });

  test('retries a failing message later and gives up after the attempt limit', async () => {
    await insertMessages([message('test_alpha', 1, 1)]);
    const classifier = new MockLanguageModelV4({
      doGenerate: () => Promise.reject(new Error('Gateway unavailable')),
    });
    const models = { classifier, extractor: new MockLanguageModelV4() };
    const run = async (): Promise<number> => {
      const result = await processQueue({ deadline: Date.now() + 60_000, concurrency: 2, models });
      assert.ok(!(result instanceof Error));
      // Делаем вид, что прошло время задержки повтора.
      await db
        .update(telegramMessages)
        .set({ processedAt: sql`now() - interval '1 hour'` })
        .where(eq(telegramMessages.channel, 'test_alpha'));
      return result.claimed;
    };

    const claimed = [];
    for (let attempt = 0; attempt <= MAX_ATTEMPTS; attempt += 1) {
      // oxlint-disable-next-line eslint/no-await-in-loop
      claimed.push(await run());
    }

    assert.deepEqual(claimed, [1, 1, 1, 0]);
    const [row] = await db
      .select()
      .from(telegramMessages)
      .where(eq(telegramMessages.channel, 'test_alpha'));
    assert.equal(row?.status, 'failed');
    assert.equal(row.attempts, MAX_ATTEMPTS);
    assert.match(row.lastError ?? '', /classification failed/u);
  });
});

describe('runTelegramJob', () => {
  test('crawls, processes and stops when no work is left', async () => {
    const messages = new Map([
      ['test_alpha', [message('test_alpha', 1, 1), message('test_alpha', 2, 1)]],
      ['test_beta', [message('test_beta', 1, 1, 'Другая вакансия')]],
    ]);
    const hops: number[] = [];

    const result = await runTelegramJob({
      channels: [...CHANNELS],
      hop: 0,
      startedAt: Date.now(),
      maxDurationMs: 300_000,
      continueWith: (hop) => {
        hops.push(hop);
        return Promise.resolve(null);
      },
      telegram: fakeTelegram(messages),
      models: vacancyModels().models,
      now: NOW,
    });

    assert.ok(!(result instanceof Error), result instanceof Error ? String(result.cause) : '');
    assert.deepEqual(result, { inserted: 3, claimed: 3, continued: false });
    assert.deepEqual(hops, []);
  });

  test('continues with the next hop when time runs out with work left', async () => {
    // 11 сообщений: больше одной пачки разбора (5 × 2).
    const history = Array.from({ length: 11 }, (_, index) =>
      message('test_alpha', index + 1, 1, `Вакансия номер ${String(index + 1)}`),
    );
    const messages = new Map([['test_alpha', history]]);
    const answer = mockModel({ verdict: 'not_hiring', note: 'Нет' });
    // Медленный классификатор: первая пачка разбирается дольше, чем осталось времени.
    const classifier = new MockLanguageModelV4({
      doGenerate: async (options) => {
        await new Promise((resolve) => {
          setTimeout(resolve, 1200);
        });
        return answer.doGenerate(options);
      },
    });
    const hops: number[] = [];

    const result = await runTelegramJob({
      channels: ['test_alpha'],
      hop: 0,
      startedAt: Date.now(),
      // Запас до конца — 75 секунд, так что на работу остаётся одна секунда.
      maxDurationMs: 76_000,
      continueWith: (hop) => {
        hops.push(hop);
        return Promise.resolve(null);
      },
      telegram: fakeTelegram(messages, { pageSize: 20 }),
      models: { classifier, extractor: new MockLanguageModelV4() },
      now: NOW,
    });

    assert.ok(!(result instanceof Error), result instanceof Error ? String(result.cause) : '');
    assert.deepEqual(result, { inserted: 11, claimed: 10, continued: true });
    assert.deepEqual(hops, [1]);
  });
});
