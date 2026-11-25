import { createHash } from 'node:crypto';

import type { Connector } from '@job-market/connectors';
import { db, getSource, recordDrain } from '@job-market/db';
import type { SourceRow } from '@job-market/db';
import { log } from '@job-market/logger';

import type { DrainSourceJob, JobQueue, MineJob } from './job-queue.ts';
import { mineJobKey } from './mine-attempts.ts';
import { REQUEUE_DELAY_SECONDS, runAfterDrain, scheduleAfterDrain } from './schedule.ts';

const moduleLog = log.with({ module: 'engine' });

export type DrainSourceJobInput = {
  readonly sourceId: string;
  /** Реестр коннекторов по id — `createConnectors` пакета коннекторов. */
  readonly connectors: ReadonlyMap<string, Connector>;
  /** Куда класть продолжение незаконченного прохода (П7). */
  readonly queue: JobQueue<DrainSourceJob>;
  /** Куда класть задания разбора новых публикаций (П7 плана разбора). */
  readonly mineQueue: JobQueue<MineJob>;
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

/** Почему задание опроса пропущено: источника нет, он выключен или его коннектора нет. */
function skipReason(source: Pick<SourceRow, 'enabled'> | undefined): string {
  if (source === undefined) return 'source not found';
  return source.enabled ? 'connector not registered' : 'source disabled';
}

/**
 * Кладёт задание разбора на каждую новую публикацию `pending` (П7 плана разбора): сразу, с
 * ключом первой попытки. Новых нет — очередь не зовётся.
 */
async function queueMining(
  mineQueue: JobQueue<MineJob>,
  pendingIds: readonly string[],
): Promise<Error | undefined> {
  if (pendingIds.length === 0) return undefined;
  return mineQueue.enqueue(
    pendingIds.map((publicationId) => ({
      publicationId,
      delaySeconds: 0,
      idempotencyKey: mineJobKey(publicationId, 0),
    })),
  );
}

/**
 * Обработчик задания «опроси источник» (П1–П9). Читает источник заново, зовёт `drain` его
 * коннектора, пишет расписание, которое решил `scheduleAfterDrain`, кладёт задания разбора на
 * новые публикации и при `more` — продолжение в очередь. Вызов может прийти повторно. `Error` —
 * сбой базы или отправки заданий: такое задание повторяет очередь.
 */
export async function handleDrainSourceJob(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- в задании `Date` и коннекторы, глубоко readonly их не сделать
  input: DrainSourceJobInput,
): Promise<Error | DrainSourceJobResult> {
  const { sourceId, connectors, queue, mineQueue, now, deadline } = input;
  const source = await getSource(db, sourceId);
  if (source instanceof Error) return source;

  const connector = source === undefined ? undefined : connectors.get(source.connector);
  if (source === undefined || !source.enabled || connector === undefined) {
    moduleLog.info('Source drain skipped', { sourceId, reason: skipReason(source) });
    return { status: 'skipped', inserted: 0 };
  }

  const result = await connector.drain(source, { now, deadline });
  if (result instanceof Error) return result;

  // Строка истории — вместе с расписанием; пропуск и сбой базы в `drain` её не пишут (П9 плана
  // мониторинга).
  const schedule = scheduleAfterDrain(source, result, now);
  const saved = await recordDrain(db, source.id, schedule, runAfterDrain(result, now));
  if (saved instanceof Error) return saved;
  // После расписания и до продолжения, при любом итоге: прочитанное до сбоя тоже разбирается.
  // Не отправились — Error, а повтор `drain` эти публикации уже не вернёт (E7 плана разбора).
  const queued = await queueMining(mineQueue, result.pendingIds);
  if (queued instanceof Error) return queued;

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
