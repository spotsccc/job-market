import type { Connector } from '@job-market/connectors';
import { claimDueSources, db, releaseSources } from '@job-market/db';
import type { Connector as ConnectorId } from '@job-market/db/values';
import { log } from '@job-market/logger';

import { BATCH_SIZE } from './job-queue.ts';
import type { DrainSourceJob, JobQueue } from './job-queue.ts';
import { spreadDelay, TICK_LIMIT } from './schedule.ts';

const moduleLog = log.with({ module: 'engine' });

export type TickInput = {
  readonly now: Date;
  /** Реестр коннекторов по id — `createConnectors` пакета коннекторов. Тик берёт из него только id. */
  readonly connectors: ReadonlyMap<string, Connector>;
  /** Куда класть задания опроса. */
  readonly queue: JobQueue<DrainSourceJob>;
  /** Сколько источников взять самое большее (П1). */
  readonly limit?: number;
};

/** Итог тика: сколько источников пора было опросить и на сколько из них задание ушло в очередь. */
export type TickResult = {
  readonly due: number;
  readonly enqueued: number;
};

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- `Date` глубоко readonly не сделать
function drainJob(sourceId: string, now: Date): DrainSourceJob {
  return {
    sourceId,
    delaySeconds: spreadDelay(sourceId),
    idempotencyKey: `${sourceId}:${now.toISOString()}`,
  };
}

/**
 * Тик опроса (П1–П3 плана тика): берёт источники, которые пора опросить, сдвигает их
 * `next_run_at` и кладёт на каждый задание опроса пачками по `BATCH_SIZE`. Если пачка не ушла,
 * источники этой и следующих пачек получают прежний `next_run_at`, а отправленные пачки
 * остаются в очереди. `Error` — сбой базы или отправки.
 */
export async function tick(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- в задании `Date` и коннекторы, глубоко readonly их не сделать
  input: TickInput,
): Promise<Error | TickResult> {
  const { now, connectors, queue, limit = TICK_LIMIT } = input;
  const claimed = await claimDueSources(db, {
    now,
    // Ключи реестра — id коннекторов: `createConnectors` и тесты кладут по `connector.id`.
    connectorIds: [...connectors.values()].map((connector): ConnectorId => connector.id),
    limit,
  });
  if (claimed instanceof Error) return claimed;

  let enqueued = 0;
  for (let start = 0; start < claimed.length; start += BATCH_SIZE) {
    const batch = claimed.slice(start, start + BATCH_SIZE);
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- в строке `Date`, глубоко readonly её не сделать
    const jobs = batch.map(({ id }) => drainJob(id, now));
    // Пачки по очереди, а не разом: при сбое известно, какие источники вернуть (П3).
    // oxlint-disable-next-line no-await-in-loop
    const sent = await queue.enqueue(jobs);
    if (sent instanceof Error) {
      const unsent = claimed.length - enqueued;
      // oxlint-disable-next-line no-await-in-loop -- после этого цикл кончается
      const released = await releaseSources(db, claimed.slice(start));
      const message = `Enqueueing drain jobs failed: ${String(enqueued)} of ${String(claimed.length)} sent`;
      if (released instanceof Error) {
        return new Error(
          `${message}; returning ${String(unsent)} sources failed: ${released.message}`,
          {
            cause: sent,
          },
        );
      }
      return new Error(`${message}, ${String(unsent)} sources returned to the next tick`, {
        cause: sent,
      });
    }
    enqueued += batch.length;
  }

  const result = { due: claimed.length, enqueued };
  moduleLog.info('Tick finished', result);
  return result;
}
