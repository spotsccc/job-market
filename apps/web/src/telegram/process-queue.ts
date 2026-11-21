import { db, eq, inArray, sql, telegramMessages } from '@job-market/db';
import type { TelegramMessageRow } from '@job-market/db';
import { log as rootLog } from '@job-market/logger';

import { mapConcurrent } from '../map-concurrent.ts';
import {
  defaultPostProcessingModels,
  processPost,
  savePostWithVacancies,
} from '../post-processing/index.ts';
import type { Post, PostProcessingModels } from '../post-processing/index.ts';

const log = rootLog.with({ module: 'telegram', step: 'process' });

/** Сколько раз берём сообщение в разбор, прежде чем сдаться: ошибка модели или схемы может повторяться. */
export const MAX_ATTEMPTS = 3;

/** Через сколько сообщение в статусе `processing` считаем брошенным: запуск умер посреди разбора. */
const LEASE = `interval '15 minutes'`;
const CLAIM_LEASE = sql.raw(LEASE);
/** Упавшее сообщение повторяем не сразу: сбой модели или шлюза обычно не проходит за секунды. */
const RETRY_DELAY = `interval '5 minutes'`;

/** Можно брать в разбор: ждёт, упало давно и есть попытки, или брошено умершим запуском. */
function claimable(alias: string): ReturnType<typeof sql.raw> {
  return sql.raw(`(
    ${alias}.status = 'pending'
    OR (${alias}.status = 'failed' AND ${alias}.attempts < ${String(MAX_ATTEMPTS)}
        AND ${alias}.processed_at < now() - ${RETRY_DELAY})
    OR (${alias}.status = 'processing' AND ${alias}.claimed_at < now() - ${LEASE}
        AND ${alias}.attempts < ${String(MAX_ATTEMPTS)})
  )`);
}

/**
 * Уборка перед разбором:
 * - брошенные разборы без оставшихся попыток — в `failed`;
 * - копии текста, который уже разобран в другом сообщении, — в `duplicate` со ссылкой на него.
 */
async function tidyQueue(): Promise<void> {
  await db.execute(sql`
    UPDATE telegram_messages
    SET status = 'failed', last_error = 'Разбор не завершился: запуск остановился'
    WHERE status = 'processing'
      AND claimed_at < now() - ${CLAIM_LEASE}
      AND attempts >= ${MAX_ATTEMPTS}`);
  await db.execute(sql`
    UPDATE telegram_messages m
    SET status = 'duplicate', duplicate_of_id = done.id, processed_at = now()
    FROM (
      SELECT DISTINCT ON (content_hash) content_hash, id
      FROM telegram_messages
      WHERE status IN ('vacancy', 'not_vacancy')
      ORDER BY content_hash, processed_at
    ) done
    WHERE m.content_hash = done.content_hash
      AND m.id <> done.id
      AND m.status IN ('pending', 'failed')`);
}

/**
 * Берёт в разбор до `limit` сообщений, свежие первыми. Из сообщений с одинаковым
 * текстом берёт одно — самое раннее, а пока оно в разборе, остальные копии не
 * трогает: их потом пометит `tidyQueue`. `SKIP LOCKED` не даёт двум запускам взять
 * одно сообщение.
 */
async function claimBatch(limit: number): Promise<readonly TelegramMessageRow[]> {
  const claimed = await db.execute<{ id: string }>(sql`
    UPDATE telegram_messages
    SET status = 'processing', claimed_at = now(), attempts = attempts + 1
    WHERE id IN (
      SELECT m.id FROM telegram_messages m
      WHERE ${claimable('m')}
        AND m.id = (
          SELECT o.id FROM telegram_messages o
          WHERE o.content_hash = m.content_hash AND ${claimable('o')}
          ORDER BY o.posted_at, o.channel, o.message_id
          LIMIT 1
        )
        AND NOT EXISTS (
          SELECT 1 FROM telegram_messages o
          WHERE o.content_hash = m.content_hash
            AND o.id <> m.id
            AND (o.status IN ('vacancy', 'not_vacancy')
              OR (o.status = 'processing' AND o.claimed_at >= now() - ${CLAIM_LEASE}))
        )
      ORDER BY m.posted_at DESC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id`);
  const ids = claimed.rows.map((row: Readonly<{ id: string }>) => row.id);
  if (ids.length === 0) return [];
  return db.select().from(telegramMessages).where(inArray(telegramMessages.id, ids));
}

function toPost(message: Readonly<TelegramMessageRow>): Post {
  return {
    source: 'telegram',
    externalId: `${message.channel}/${String(message.messageId)}`,
    url: message.url,
    content: message.content,
    postedAt: message.postedAt,
    authorName: message.authorName,
    authorUrl: `https://t.me/${message.channel}`,
    authorHeadline: null,
    authorHandle: message.channel,
  };
}

function describeError(error: Readonly<Error>): string {
  const cause = error.cause instanceof Error ? `: ${error.cause.message}` : '';
  return `${error.message}${cause}`;
}

export type MessageOutcome = 'vacancy' | 'not_vacancy' | 'failed';

/** Разбирает сообщение моделями и записывает итог. Ошибки разбора — в строку сообщения и в лог. */
async function processMessage(
  message: TelegramMessageRow,
  models: PostProcessingModels,
): Promise<MessageOutcome> {
  const messageLog = log.with({ messageUrl: message.url, attempt: message.attempts });
  const post = toPost(message);

  async function fail(error: Readonly<Error>): Promise<MessageOutcome> {
    messageLog.error('Telegram message processing failed', { err: error });
    await db
      .update(telegramMessages)
      .set({ status: 'failed', lastError: describeError(error), processedAt: sql`now()` })
      .where(eq(telegramMessages.id, message.id));
    return 'failed';
  }

  const processed = await processPost(post, models);
  if (processed instanceof Error) return fail(processed);

  if (processed.kind === 'not_vacancy') {
    await db
      .update(telegramMessages)
      .set({
        status: 'not_vacancy',
        notVacancyReason: processed.reason,
        note: processed.note,
        lastError: null,
        processedAt: sql`now()`,
      })
      .where(eq(telegramMessages.id, message.id));
    return 'not_vacancy';
  }

  const postId = await savePostWithVacancies(processed.post, processed.vacancies);
  if (postId instanceof Error) return fail(postId);

  await db
    .update(telegramMessages)
    .set({ status: 'vacancy', postId, lastError: null, processedAt: sql`now()` })
    .where(eq(telegramMessages.id, message.id));
  messageLog.info('Telegram vacancy saved', {
    dbPostId: postId,
    vacanciesCount: processed.vacancies.length,
  });
  return 'vacancy';
}

export type ProcessQueueOptions = {
  /** Время (`Date.now()`), после которого новые пачки не берём. */
  readonly deadline: number;
  /** Сколько сообщений разбираем моделями одновременно. */
  readonly concurrency: number;
  readonly models?: PostProcessingModels;
};

export type ProcessQueueResult = {
  readonly claimed: number;
  readonly outcomes: Readonly<Record<MessageOutcome, number>>;
};

/**
 * Разбирает очередь `telegram_messages` пачками, пока она не опустеет или не
 * наступит `deadline`. Вакансии записывает в общие `posts`/`vacancies`.
 */
export async function processQueue(
  options: ProcessQueueOptions,
): Promise<Error | ProcessQueueResult> {
  const models = options.models ?? defaultPostProcessingModels;
  const outcomes: Record<MessageOutcome, number> = { vacancy: 0, not_vacancy: 0, failed: 0 };
  let claimed = 0;

  async function run(): Promise<void> {
    while (Date.now() < options.deadline) {
      // Пачки идут по очереди: каждая берётся после уборки за предыдущей.
      // oxlint-disable-next-line eslint/no-await-in-loop
      await tidyQueue();
      // oxlint-disable-next-line eslint/no-await-in-loop
      const batch = await claimBatch(options.concurrency * 2);
      if (batch.length === 0) break;
      claimed += batch.length;
      // oxlint-disable-next-line eslint/no-await-in-loop
      const results = await mapConcurrent(batch, options.concurrency, async (message) =>
        processMessage(message, models),
      );
      for (const outcome of results) outcomes[outcome] += 1;
    }
    // Копии того, что разобрали последней пачкой, помечаем сразу, а не в следующем запуске.
    await tidyQueue();
  }

  const done = await run().catch(
    (cause: unknown) => new Error('Telegram queue processing failed', { cause }),
  );
  if (done instanceof Error) return done;
  return { claimed, outcomes };
}

async function queryClaimableCount(): Promise<number> {
  const result = await db.execute<{ count: string }>(
    sql`SELECT count(*) AS count FROM telegram_messages m WHERE ${claimable('m')}`,
  );
  return Number(result.rows[0]?.count ?? 0);
}

/** Сколько сообщений ещё можно взять в разбор. */
export async function countClaimable(): Promise<Error | number> {
  return queryClaimableCount().catch(
    (cause: unknown) => new Error('Counting Telegram queue failed', { cause }),
  );
}
