import type { DrainSourceJob, JobQueue, MineJob } from '@job-market/engine';
import { sendBatch } from '@vercel/queue';
import type { BatchSendMessage, BatchSendResult } from '@vercel/queue';
import { z } from 'zod';

/** Топик заданий опроса: его читает `app/api/queues/drain-source/route.ts`. */
export const DRAIN_SOURCE_TOPIC = 'drain-source';
/** Топик заданий разбора: его читает `app/api/queues/mine/route.ts`. */
export const MINE_TOPIC = 'mine';

/** Сколько сообщений Vercel Queues принимает одним `sendBatch`. */
export const SEND_BATCH_LIMIT = 100;

/** Тело сообщения опроса. `v` — версия формы: по ней потребитель отличит старые сообщения. */
export const drainSourceMessageSchema = z.object({ v: z.literal(1), sourceId: z.string() });
export type DrainSourceMessage = z.infer<typeof drainSourceMessageSchema>;
/** Тело сообщения разбора. */
export const mineMessageSchema = z.object({ v: z.literal(1), publicationId: z.string() });
export type MineMessage = z.infer<typeof mineMessageSchema>;

/** Отправка пачки в топик — `sendBatch` из `@vercel/queue`, в тестах — фейк. */
export type SendBatch = (
  topic: string,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- тип сообщения из @vercel/queue, глубоко readonly его не сделать
  messages: readonly Readonly<BatchSendMessage>[],
) => Promise<readonly Readonly<BatchSendResult>[]>;

/** Сколько сообщений пачки очередь не приняла и почему не приняла первое. `undefined` — приняла все. */
function rejection(
  results: readonly Readonly<BatchSendResult>[],
): { readonly count: number; readonly error: string } | undefined {
  let count = 0;
  let error = '';
  for (const result of results) {
    if (result.status !== 'failed') continue;
    if (count === 0) error = result.error;
    count += 1;
  }
  return count === 0 ? undefined : { count, error };
}

type QueueJob = { readonly delaySeconds: number; readonly idempotencyKey: string };

/**
 * `JobQueue` поверх Vercel Queues: задания уходят пачками по `SEND_BATCH_LIMIT` с задержкой и
 * ключом задания. Пачки идут по очереди; первая неудачная пачка — `Error`, следующие не
 * отправляются. Повторная отправка уже принятых сообщений безопасна: их отбросит ключ.
 */
export function vercelJobQueue<Job extends QueueJob>(
  topic: string,
  toPayload: (job: Job) => unknown,
  send: SendBatch = sendBatch,
): JobQueue<Job> {
  return {
    async enqueue(jobs) {
      for (let start = 0; start < jobs.length; start += SEND_BATCH_LIMIT) {
        const messages = jobs.slice(start, start + SEND_BATCH_LIMIT).map((job) => ({
          payload: toPayload(job),
          delaySeconds: job.delaySeconds,
          idempotencyKey: job.idempotencyKey,
        }));
        // oxlint-disable-next-line no-await-in-loop -- пачки по очереди: при сбое следующие не уходят
        const results = await send(topic, messages).catch(
          (cause: unknown) => new Error(`Sending to queue ${topic} failed`, { cause }),
        );
        if (results instanceof Error) return results;
        const rejected = rejection(results);
        if (rejected !== undefined) {
          return new Error(
            `Queue ${topic} rejected ${String(rejected.count)} of ${String(messages.length)} messages: ${rejected.error}`,
          );
        }
      }
      // oxlint-disable-next-line unicorn/no-useless-undefined -- контракт JobQueue: undefined — задания отправлены
      return undefined;
    },
  };
}

export function drainSourceQueue(send?: SendBatch): JobQueue<DrainSourceJob> {
  return vercelJobQueue(
    DRAIN_SOURCE_TOPIC,
    (job: DrainSourceJob): DrainSourceMessage => ({ v: 1, sourceId: job.sourceId }),
    send,
  );
}

export function mineQueue(send?: SendBatch): JobQueue<MineJob> {
  return vercelJobQueue(
    MINE_TOPIC,
    (job: MineJob): MineMessage => ({ v: 1, publicationId: job.publicationId }),
    send,
  );
}
