import type { PublicationState } from '@job-market/db';

import { errorText } from './schedule.ts';

/** Сколько раз публикацию берут в разбор, прежде чем пометить `failed` (П4). */
export const MAX_MINE_ATTEMPTS = 3;

/** Пауза перед повтором после первой неудачной попытки; дальше она удваивается (П4). */
export const MINE_RETRY_DELAY_SECONDS = 300;

/**
 * Публикация `processing`, взятая раньше стольких минут, брошена: её можно взять снова (П1).
 * Должна быть больше `maxDuration` функции разбора.
 */
export const CLAIM_TIMEOUT_MINUTES = 15;

export type StateAfterMineError = {
  readonly state: PublicationState;
  /** Через сколько секунд повторить разбор; нет — повтора не будет. */
  readonly retryDelaySeconds?: number;
};

/**
 * Состояние публикации после сбоя `mine` (П4). `attempts` — попыток вместе с этой. Меньше
 * `MAX_MINE_ATTEMPTS` — снова `pending` и повтор через `300 · 2^(attempts − 1)` секунд; иначе —
 * `failed` без повтора.
 */
export function stateAfterMineError(
  attempts: number,
  error: Readonly<Error>,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- `Date` глубоко readonly не сделать
  now: Date,
): StateAfterMineError {
  const lastError = errorText(error);
  if (attempts >= MAX_MINE_ATTEMPTS) {
    return { state: { status: 'failed', lastError, processedAt: now } };
  }
  return {
    state: { status: 'pending', lastError },
    retryDelaySeconds: MINE_RETRY_DELAY_SECONDS * 2 ** (attempts - 1),
  };
}

/**
 * Ключ задания разбора (П5): `attempts` — сколько попыток уже сделано, 0 у первого задания.
 * Повтор одной попытки — одно задание, следующая попытка — новое.
 */
export function mineJobKey(publicationId: string, attempts: number): string {
  return `${publicationId}:${String(attempts)}`;
}
