import { createHash } from 'node:crypto';

import type { DrainResult } from '@job-market/connectors';
import type { SourceRow, SourceRunToSave, SourceSchedule } from '@job-market/db';

/** Пауза перед продолжением незаконченного прохода (П7 опроса). */
export const REQUEUE_DELAY_SECONDS = 60;

/** Сколько источников берёт один тик самое большее (П1 тика). */
export const TICK_LIMIT = 2000;

/** Задержки заданий одного тика — в пределах 10 минут (П2 тика). */
const SPREAD_SECONDS = 600;

/**
 * Задержка задания опроса в секундах (П2 тика): целое в [0, 600) из хэша id. Источники
 * одного тика не идут к сервисам разом, а у одного источника задержка всегда одна.
 */
export function spreadDelay(sourceId: string): number {
  return createHash('sha256').update(sourceId).digest().readUInt32BE(0) % SPREAD_SECONDS;
}

const MINUTE_MS = 60 * 1000;

/** Пауза после неудачи не длиннее суток (П5 опроса). */
const MAX_PAUSE_MS = 24 * 60 * MINUTE_MS;

/**
 * Когда опрашивать после неудачи (П5 опроса): `now + min(intervalMinutes · 2^failures, 24 ч)`, где
 * `failures` — ошибок подряд вместе с этой.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- `Date` глубоко readonly не сделать
export function nextRunAt(now: Date, intervalMinutes: number, failures: number): Date {
  const pause = Math.min(intervalMinutes * MINUTE_MS * 2 ** failures, MAX_PAUSE_MS);
  return new Date(now.getTime() + pause);
}

/** Ошибка одной строкой для `last_error` источника и публикации: сообщение и причина. */
export function errorText(error: Readonly<Error> | undefined): string {
  if (error === undefined) return 'drain failed without an error';
  const cause = error.cause instanceof Error ? `: ${error.cause.message}` : '';
  return `${error.message}${cause}`;
}

/**
 * Поля расписания источника по итогу `drain` (П3, П5, П7, П8 опроса). `last_fetched_at` пишется
 * всегда; `done` — успех, `failed` — ещё одна ошибка подряд и пауза, `more` — ни то ни другое.
 */
export function scheduleAfterDrain(
  source: Pick<SourceRow, 'intervalMinutes' | 'consecutiveFailures'>,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- в итоге `Error`, глубоко readonly его не сделать
  result: Pick<DrainResult, 'status' | 'error'>,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- `Date` глубоко readonly не сделать
  now: Date,
): SourceSchedule {
  if (result.status === 'done') {
    return { lastFetchedAt: now, lastSuccessAt: now, consecutiveFailures: 0, lastError: null };
  }
  if (result.status === 'more') return { lastFetchedAt: now };
  const failures = source.consecutiveFailures + 1;
  return {
    lastFetchedAt: now,
    consecutiveFailures: failures,
    lastError: errorText(result.error),
    nextRunAt: nextRunAt(now, source.intervalMinutes, failures),
  };
}

/**
 * Строка истории опросов по итогу `drain` (П9, П10 в packages/db/src/monitoring/README.md): итог как есть, текст
 * ошибки — тот же, что `last_error` источника, и только у `failed`.
 */
export function runAfterDrain(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- в итоге `Error`, глубоко readonly его не сделать
  result: Pick<DrainResult, 'status' | 'inserted' | 'error'>,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- `Date` глубоко readonly не сделать
  now: Date,
): SourceRunToSave {
  return {
    status: result.status,
    inserted: result.inserted,
    error: result.status === 'failed' ? errorText(result.error) : null,
    startedAt: now,
  };
}
