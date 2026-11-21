import type { TelegramChannel, TelegramMessage } from '@job-market/channel-telegram';
import { db, eq, telegramChannels, telegramMessages } from '@job-market/db';
import type { NewTelegramMessageRow, TelegramChannelRow } from '@job-market/db';
import { log as rootLog } from '@job-market/logger';

import { mapConcurrent } from '../map-concurrent.ts';
import { contentHash } from './content-hash.ts';

const log = rootLog.with({ module: 'telegram', step: 'crawl' });

const DAY_MS = 24 * 60 * 60 * 1000;

export type CrawlOptions = {
  readonly channels: readonly string[];
  /** Откуда брать страницы превью. */
  readonly telegram: Pick<TelegramChannel, 'fetchPage'>;
  readonly now: Date;
  /** Глубина сбора в днях: сообщения старше не берём. */
  readonly depthDays: number;
  /** Время (`Date.now()`), после которого новые страницы не качаем: проход продолжит следующий запуск. */
  readonly deadline: number;
  /**
   * Новый проход по каналу начинаем, только если прошлый закончился раньше этого
   * времени. `null` — начинаем всегда. Прерванные проходы доделываем в любом случае.
   */
  readonly startPassIfCrawledBefore: Date | null;
  /** Сколько каналов качаем одновременно. Страницы одного канала — всегда по очереди. */
  readonly concurrency: number;
};

/**
 * - `done` — проход закончен, курсор сдвинут;
 * - `interrupted` — кончилось время, проход продолжит следующий запуск;
 * - `failed` — страница не скачалась или не разобралась, проход продолжит следующий запуск;
 * - `skipped` — прохода нет и новый начинать не просили.
 */
export type ChannelCrawlStatus = 'done' | 'interrupted' | 'failed' | 'skipped';

export type ChannelCrawlResult = {
  readonly channel: string;
  readonly status: ChannelCrawlStatus;
  /** Сколько новых сообщений записано в очередь. */
  readonly inserted: number;
  readonly pages: number;
};

function toRow(message: Readonly<TelegramMessage>): NewTelegramMessageRow {
  return {
    channel: message.channel,
    messageId: message.id,
    url: message.url,
    content: message.content,
    postedAt: message.postedAt,
    authorName: message.authorName,
    contentHash: contentHash(message.content),
    // Картинка без подписи или служебное сообщение: моделям разбирать нечего.
    status: message.content.trim() === '' ? 'empty' : 'pending',
  };
}

async function loadState(channel: string): Promise<TelegramChannelRow> {
  await db.insert(telegramChannels).values({ channel }).onConflictDoNothing();
  const [state] = await db
    .select()
    .from(telegramChannels)
    .where(eq(telegramChannels.channel, channel));
  if (state === undefined) throw new Error(`Channel ${channel} state row is missing`);
  return state;
}

/** Проход по каналу: где он сейчас. */
type Pass = {
  /** До какого номера всё уже собрано прошлыми проходами. */
  readonly cursorId: number | null;
  /** Самое новое сообщение этого прохода; `null` — первая страница ещё не скачана. */
  readonly passTopId: number | null;
};

type PagePlan = {
  readonly rows: readonly NewTelegramMessageRow[];
  readonly state: Partial<TelegramChannelRow>;
  /** Номер, с которого качать следующую страницу; `null` — проход закончен. */
  readonly nextBefore: number | null;
  readonly passTopId: number | null;
};

/**
 * Что делать со скачанной страницей: какие сообщения записать, как сдвинуть
 * состояние канала и идти ли дальше вниз. Дальше не идём, если дошли до уже
 * собранного, до границы глубины или до начала канала.
 */
function planPage(
  messages: readonly Readonly<TelegramMessage>[],
  pass: Pass,
  cutoff: number,
  now: Readonly<Date>,
): PagePlan {
  const { cursorId } = pass;
  const oldest = messages[0];
  const passTopId = pass.passTopId ?? messages.at(-1)?.id ?? null;
  const rows = messages
    .filter(
      (message) =>
        (cursorId === null || message.id > cursorId) && message.postedAt.getTime() >= cutoff,
    )
    .map((message) => toRow(message));
  const reachedEnd =
    oldest === undefined ||
    (cursorId !== null && oldest.id <= cursorId) ||
    oldest.postedAt.getTime() < cutoff ||
    oldest.id <= 1;

  if (reachedEnd) {
    return {
      rows,
      passTopId,
      nextBefore: null,
      state: {
        cursorId: Math.max(cursorId ?? 0, passTopId ?? 0) || null,
        passTopId: null,
        resumeBeforeId: null,
        lastCrawledAt: new Date(now.getTime()),
      },
    };
  }
  return {
    rows,
    passTopId,
    nextBefore: oldest.id,
    state: { passTopId, resumeBeforeId: oldest.id },
  };
}

/**
 * Записывает страницу и сдвигает состояние канала одной транзакцией: если запуск
 * умрёт между страницами, состояние всегда указывает на последнюю записанную.
 */
async function savePage(channel: string, plan: PagePlan): Promise<number> {
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- транзакцию drizzle передаёт сам
  return db.transaction(async (tx) => {
    const inserted =
      plan.rows.length === 0
        ? []
        : await tx
            .insert(telegramMessages)
            .values([...plan.rows])
            .onConflictDoNothing()
            .returning({ id: telegramMessages.id });
    await tx.update(telegramChannels).set(plan.state).where(eq(telegramChannels.channel, channel));
    return inserted.length;
  });
}

async function crawlChannel(channel: string, options: CrawlOptions): Promise<ChannelCrawlResult> {
  const channelLog = log.with({ channel });
  const state = await loadState(channel);
  const threshold = options.startPassIfCrawledBefore;
  const crawledRecently =
    threshold !== null && state.lastCrawledAt !== null && state.lastCrawledAt >= threshold;
  if (state.passTopId === null && crawledRecently) {
    return { channel, status: 'skipped', inserted: 0, pages: 0 };
  }

  const cutoff = options.now.getTime() - options.depthDays * DAY_MS;
  const { cursorId } = state;
  let { passTopId } = state;
  let before = state.resumeBeforeId ?? undefined;
  let inserted = 0;
  let pages = 0;

  for (;;) {
    if (Date.now() >= options.deadline) {
      channelLog.info('Telegram crawl interrupted by deadline', { inserted, pages, before });
      return { channel, status: 'interrupted', inserted, pages };
    }

    // Страницы одного канала идут строго по очереди: следующая начинается там, где кончилась эта.
    // oxlint-disable-next-line eslint/no-await-in-loop
    const page = await options.telegram.fetchPage(channel, before);
    if (page instanceof Error) {
      channelLog.error('Telegram page fetch failed', { err: page, before, inserted, pages });
      return { channel, status: 'failed', inserted, pages };
    }
    pages += 1;

    const plan = planPage(page.messages, { cursorId, passTopId }, cutoff, options.now);
    // oxlint-disable-next-line eslint/no-await-in-loop
    inserted += await savePage(channel, plan);
    if (plan.nextBefore === null) {
      channelLog.info('Telegram channel crawled', { inserted, pages, cursorId: plan.passTopId });
      return { channel, status: 'done', inserted, pages };
    }
    ({ passTopId } = plan);
    before = plan.nextBefore;
  }
}

/**
 * Собирает новые сообщения каналов в `telegram_messages`. Проход по каналу идёт от
 * самых новых сообщений вниз, пока не встретит уже собранное или не дойдёт до
 * границы глубины. Первый проход берёт всё за `depthDays`, следующие — только новое.
 * Ошибка одного канала не мешает остальным: она в логах и в статусе канала.
 */
export async function crawlChannels(
  options: CrawlOptions,
): Promise<Error | readonly ChannelCrawlResult[]> {
  return mapConcurrent(options.channels, options.concurrency, async (channel) =>
    crawlChannel(channel, options),
  ).catch((cause: unknown) => new Error('Telegram crawl failed', { cause }));
}

async function queryNeedsCrawl(
  channels: readonly string[],
  crawledBefore: Readonly<Date>,
): Promise<boolean> {
  const rows = await db.select().from(telegramChannels);
  const states = new Map(rows.map((row) => [row.channel, row]));
  return channels.some((channel) => {
    const state = states.get(channel);
    if (state === undefined || state.passTopId !== null || state.lastCrawledAt === null) {
      return true;
    }
    return state.lastCrawledAt < crawledBefore;
  });
}

/**
 * Есть ли каналы, которые надо докачать: проход прерван, канал ещё ни разу не
 * собран целиком или последний проход закончился раньше `crawledBefore`.
 */
export async function needsCrawl(
  channels: readonly string[],
  crawledBefore: Readonly<Date>,
): Promise<Error | boolean> {
  return queryNeedsCrawl(channels, crawledBefore).catch(
    (cause: unknown) => new Error('Reading Telegram channel state failed', { cause }),
  );
}
