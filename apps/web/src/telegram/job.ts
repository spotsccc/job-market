import { createTelegramChannel } from '@job-market/channel-telegram';
import type { TelegramChannel } from '@job-market/channel-telegram';
import { log as rootLog } from '@job-market/logger';

import type { PostProcessingModels } from '../post-processing/index.ts';
import { CRAWL_DEPTH_DAYS } from './channels.ts';
import { crawlChannels, needsCrawl } from './crawl.ts';
import { countClaimable, processQueue } from './process-queue.ts';

const log = rootLog.with({ module: 'telegram', step: 'job' });

/** Сбор не дольше этого от начала запуска: остальное время — разбору моделями. */
const CRAWL_BUDGET_MS = 150_000;
/** Запас до `maxDuration` функции: последняя пачка разбора и вызов продолжения. */
const SAFETY_MARGIN_MS = 75_000;
/** Каналы качаем по три: t.me отвечает 429, если спрашивать слишком часто. */
const CRAWL_CONCURRENCY = 3;
/** Сколько сообщений разбираем моделями одновременно: держимся в лимитах AI Gateway. */
const PROCESSING_CONCURRENCY = 5;
/**
 * Предел цепочки продолжений за один ежедневный запуск. Первый сбор за месяц —
 * порядка десяти звеньев, ежедневный — одно-два. Предел страхует от зацикливания.
 */
export const MAX_HOPS = 40;
/**
 * Звенья после первого начинают проход только по каналам, которые не собирались
 * столько времени: так канал, до которого первое звено не успело дойти, не пропускает день.
 */
const RECRAWL_AFTER_MS = 12 * 60 * 60 * 1000;

export type TelegramJobOptions = {
  readonly channels: readonly string[];
  /** Номер звена в цепочке продолжений: 0 — запуск по расписанию. */
  readonly hop: number;
  /** Когда функция начала работу (`Date.now()`). */
  readonly startedAt: number;
  /** `maxDuration` функции в миллисекундах. */
  readonly maxDurationMs: number;
  /** Запускает следующее звено цепочки. */
  readonly continueWith: (hop: number) => Promise<Error | null>;
  readonly telegram?: Pick<TelegramChannel, 'fetchPage'>;
  readonly models?: PostProcessingModels;
  readonly now?: Date;
};

export type TelegramJobResult = {
  readonly inserted: number;
  readonly claimed: number;
  /** Запущено ли следующее звено. */
  readonly continued: boolean;
};

type CrawlStep = { readonly inserted: number; readonly progressed: boolean };

function staleBefore(options: TelegramJobOptions): Date {
  return new Date((options.now ?? new Date()).getTime() - RECRAWL_AFTER_MS);
}

/**
 * Звено 0 начинает новые проходы по всем каналам. Следующие доделывают прерванные
 * и начинают проходы только по каналам, которые давно не собирались.
 */
async function crawlStep(
  options: TelegramJobOptions,
  deadline: number,
  jobLog: typeof log,
): Promise<Error | CrawlStep> {
  const stale = staleBefore(options);
  const needed = await needsCrawl(options.channels, stale);
  if (needed instanceof Error) return needed;
  if (options.hop > 0 && !needed) return { inserted: 0, progressed: false };

  const crawled = await crawlChannels({
    channels: options.channels,
    telegram: options.telegram ?? createTelegramChannel(),
    now: options.now ?? new Date(),
    depthDays: CRAWL_DEPTH_DAYS,
    deadline: Math.min(deadline, options.startedAt + CRAWL_BUDGET_MS),
    startPassIfCrawledBefore: options.hop === 0 ? null : stale,
    concurrency: CRAWL_CONCURRENCY,
  });
  if (crawled instanceof Error) return crawled;

  const inserted = crawled.reduce((sum, channel) => sum + channel.inserted, 0);
  jobLog.info('Telegram crawl step done', {
    inserted,
    channels: crawled.map(({ channel, status, inserted: count, pages }) => ({
      channel,
      status,
      inserted: count,
      pages,
    })),
  });
  return { inserted, progressed: crawled.some((channel) => channel.pages > 0) };
}

/** Звать ли следующее звено: работа осталась, это звено продвинулось и предел не достигнут. */
async function shouldContinue(
  options: TelegramJobOptions,
  progressed: boolean,
  jobLog: typeof log,
): Promise<Error | boolean> {
  const [remaining, crawlLeft] = await Promise.all([
    countClaimable(),
    needsCrawl(options.channels, staleBefore(options)),
  ]);
  if (remaining instanceof Error) return remaining;
  if (crawlLeft instanceof Error) return crawlLeft;

  if (remaining === 0 && !crawlLeft) {
    jobLog.info('Telegram job finished', { hops: options.hop + 1 });
    return false;
  }
  if (!progressed || options.hop + 1 >= MAX_HOPS) {
    jobLog.warn('Telegram job stopped with work left', {
      remaining,
      crawlLeft,
      reason: progressed ? 'hop limit' : 'no progress',
    });
    return false;
  }
  jobLog.info('Telegram job continues', { nextHop: options.hop + 1, remaining });
  return true;
}

/**
 * Одно звено ежедневного сбора: докачивает каналы и разбирает очередь моделями,
 * пока хватает времени функции. Если работа осталась и звено продвинулось, зовёт
 * следующее: так первый сбор за месяц растягивается на несколько вызовов функции.
 */
export async function runTelegramJob(
  options: TelegramJobOptions,
): Promise<Error | TelegramJobResult> {
  const jobLog = log.with({ hop: options.hop });
  const deadline = options.startedAt + options.maxDurationMs - SAFETY_MARGIN_MS;

  const crawled = await crawlStep(options, deadline, jobLog);
  if (crawled instanceof Error) return crawled;

  const processed = await processQueue({
    deadline,
    concurrency: PROCESSING_CONCURRENCY,
    ...(options.models === undefined ? {} : { models: options.models }),
  });
  if (processed instanceof Error) return processed;
  jobLog.info('Telegram processing step done', {
    claimed: processed.claimed,
    ...processed.outcomes,
  });

  const result = { inserted: crawled.inserted, claimed: processed.claimed };
  const next = await shouldContinue(options, processed.claimed > 0 || crawled.progressed, jobLog);
  if (next instanceof Error) return next;
  if (!next) return { ...result, continued: false };

  const continued = await options.continueWith(options.hop + 1);
  if (continued instanceof Error) return continued;
  return { ...result, continued: true };
}
