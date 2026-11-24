import type { DrainResult } from '@job-market/connectors';
import type { SourceRow, SourceSchedule } from '@job-market/db';

/** Пауза перед продолжением незаконченного прохода (П7). */
export const REQUEUE_DELAY_SECONDS = 60;

const MINUTE_MS = 60 * 1000;

/** Пауза после неудачи не длиннее суток (П5). */
const MAX_PAUSE_MS = 24 * 60 * MINUTE_MS;

/**
 * Когда опрашивать после неудачи (П5): `now + min(intervalMinutes · 2^failures, 24 ч)`, где
 * `failures` — ошибок подряд вместе с этой.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- `Date` глубоко readonly не сделать
export function nextRunAt(now: Date, intervalMinutes: number, failures: number): Date {
  const pause = Math.min(intervalMinutes * MINUTE_MS * 2 ** failures, MAX_PAUSE_MS);
  return new Date(now.getTime() + pause);
}

/** Ошибка одной строкой для `sources.last_error`: сообщение и причина. */
function errorText(error: Readonly<Error> | undefined): string {
  if (error === undefined) return 'drain failed without an error';
  const cause = error.cause instanceof Error ? `: ${error.cause.message}` : '';
  return `${error.message}${cause}`;
}

/**
 * Поля расписания источника по итогу `drain` (П3, П5, П7, П8). `last_fetched_at` пишется
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
