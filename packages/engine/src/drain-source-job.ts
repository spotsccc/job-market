import { createHash } from 'node:crypto';

import type { Connector } from '@job-market/connectors';
import { db, getSource, updateSourceSchedule } from '@job-market/db';
import { log } from '@job-market/logger';

import type { JobQueue } from './job-queue.ts';
import { REQUEUE_DELAY_SECONDS, scheduleAfterDrain } from './schedule.ts';

const moduleLog = log.with({ module: 'engine' });

export type DrainSourceJobInput = {
  readonly sourceId: string;
  /** Реестр коннекторов по id — `createConnectors` пакета коннекторов. */
  readonly connectors: ReadonlyMap<string, Connector>;
  /** Куда класть продолжение незаконченного прохода (П7). */
  readonly queue: JobQueue;
  readonly now: Date;
  /** `Date.now()`, после которого коннектор не начинает новый запрос к сервису. */
  readonly deadline: number;
};

/**
 * Итог задания опроса (П9): `requeued` — проход не закончен, продолжение в очереди; `failed` —
 * сбой сервиса, у него своя пауза; `skipped` — источника нет, он выключен или его коннектора нет.
 */
export type DrainSourceJobResult = {
  readonly status: 'done' | 'requeued' | 'failed' | 'skipped';
  /** Сколько новых публикаций записал `drain`. */
  readonly inserted: number;
};

/** Ключ продолжения (П7): по источнику и курсору, докуда прочитано. */
function continuationKey(sourceId: string, cursor: unknown): string {
  const hash = createHash('sha256')
    .update(JSON.stringify(cursor ?? null))
    .digest('hex');
  return `${sourceId}:${hash}`;
}

/**
 * Обработчик задания «опроси источник» (П1–П9). Читает источник заново, зовёт `drain` его
 * коннектора, пишет расписание, которое решил `scheduleAfterDrain`, и при `more` кладёт
 * продолжение в очередь. Вызов может прийти повторно. `Error` — сбой базы или отправки
 * продолжения: такое задание повторяет очередь.
 */
export async function handleDrainSourceJob(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- в задании `Date` и коннекторы, глубоко readonly их не сделать
  input: DrainSourceJobInput,
): Promise<Error | DrainSourceJobResult> {
  const { sourceId, connectors, queue, now, deadline } = input;
  const source = await getSource(db, sourceId);
  if (source instanceof Error) return source;

  const connector = source === undefined ? undefined : connectors.get(source.connector);
  if (source === undefined || !source.enabled || connector === undefined) {
    const reason =
      source === undefined
        ? 'source not found'
        : source.enabled
          ? 'connector not registered'
          : 'source disabled';
    moduleLog.info('Source drain skipped', { sourceId, reason });
    return { status: 'skipped', inserted: 0 };
  }

  const result = await connector.drain(source, { now, deadline });
  if (result instanceof Error) return result;

  const saved = await updateSourceSchedule(db, source.id, scheduleAfterDrain(source, result, now));
  if (saved instanceof Error) return saved;

  const { inserted } = result;
  const fields = { sourceId, connector: source.connector, key: source.key, inserted };
  if (result.status === 'done') {
    moduleLog.info('Source drained', fields);
    return { status: 'done', inserted };
  }
  if (result.status === 'failed') {
    // Сбой сервиса — не Error: у него своя пауза, очередь его не повторяет (П6, П9).
    moduleLog.warn('Source drain failed', { ...fields, err: result.error });
    return { status: 'failed', inserted };
  }
  const sent = await queue.enqueue([
    {
      sourceId,
      delaySeconds: REQUEUE_DELAY_SECONDS,
      idempotencyKey: continuationKey(sourceId, result.cursor),
    },
  ]);
  if (sent instanceof Error) return sent;
  moduleLog.info('Source drain requeued', fields);
  return { status: 'requeued', inserted };
}
