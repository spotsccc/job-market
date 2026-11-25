import type { Connector } from '@job-market/connectors';
import { claimPublication, db, findOriginals, updatePublicationState } from '@job-market/db';
import type { ClaimedPublication } from '@job-market/db';
import type { Connector as ConnectorId } from '@job-market/db/values';
import { log } from '@job-market/logger';

import type { JobQueue, MineJob } from './job-queue.ts';
import { CLAIM_TIMEOUT_MINUTES, mineJobKey, stateAfterMineError } from './mine-attempts.ts';

const moduleLog = log.with({ module: 'engine' });

const MINUTE_MS = 60 * 1000;

export type MineJobInput = {
  readonly publicationId: string;
  /** Реестр коннекторов по id — `createConnectors` пакета коннекторов. */
  readonly connectors: ReadonlyMap<string, Connector>;
  /** Куда класть повтор разбора после сбоя (П4). */
  readonly queue: JobQueue<MineJob>;
  readonly now: Date;
};

/**
 * Итог задания разбора (П6): `vacancy`, `not_vacancy`, `duplicate` — итог разбора; `retrying` —
 * сбой `mine`, повтор в очереди; `failed` — сбой `mine` на последней попытке; `skipped` —
 * брать нечего.
 */
export type MineJobResult = {
  readonly status: 'vacancy' | 'not_vacancy' | 'duplicate' | 'retrying' | 'failed' | 'skipped';
  /** Сколько вакансий записал `mine`. */
  readonly vacancies: number;
};

/** Поля записи лога о разборе одной публикации. */
type MineLogFields = {
  readonly publicationId: string;
  readonly connector: string;
  readonly attempts: number;
};

/**
 * Копия разобранного текста (П2): у публикации есть оригинал с тем же `content_hash` — она
 * `duplicate` без вызова моделей. `undefined` — оригинала нет, разбирать публикацию.
 */
async function markCopy(
  publication: Pick<ClaimedPublication, 'id' | 'contentHash'>,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- `Date` глубоко readonly не сделать
  now: Date,
  fields: MineLogFields,
): Promise<Error | MineJobResult | undefined> {
  const originals = await findOriginals(db, [publication.contentHash]).catch(
    (cause: unknown) =>
      new Error(`Finding original of publication ${publication.id} failed`, { cause }),
  );
  if (originals instanceof Error) return originals;
  const originalId = originals.get(publication.contentHash);
  if (originalId === undefined) return undefined;
  const saved = await updatePublicationState(db, publication.id, {
    status: 'duplicate',
    duplicateOfId: originalId,
    processedAt: now,
  });
  if (saved instanceof Error) return saved;
  moduleLog.info('Publication is a copy', { ...fields, originalId });
  return { status: 'duplicate', vacancies: 0 };
}

/**
 * После сбоя `mine` (П4, П6): пишет состояние из `stateAfterMineError` и, если попытки не
 * кончились, кладёт повтор. Сбой `mine` — не `Error`: паузу и число попыток решает П4, а не
 * очередь. Ошибку `mine` пишет в лог здесь — тот, кто решает, что с ней делать.
 */
async function afterMineError(
  publication: Pick<ClaimedPublication, 'id' | 'attempts'>,
  error: Readonly<Error>,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- в задании `Date` и очередь, глубоко readonly их не сделать
  input: Pick<MineJobInput, 'queue' | 'now'>,
  fields: MineLogFields,
): Promise<Error | MineJobResult> {
  const { id, attempts } = publication;
  const { state, retryDelaySeconds } = stateAfterMineError(attempts, error, input.now);
  const saved = await updatePublicationState(db, id, state);
  if (saved instanceof Error) return saved;
  if (retryDelaySeconds === undefined) {
    moduleLog.warn('Publication mine failed', { ...fields, err: error });
    return { status: 'failed', vacancies: 0 };
  }
  // Повтор — после записи состояния: не отправился — публикация уже pending, и следующую
  // попытку даст повтор этого задания очередью (E4).
  const sent = await input.queue.enqueue([
    {
      publicationId: id,
      delaySeconds: retryDelaySeconds,
      idempotencyKey: mineJobKey(id, attempts),
    },
  ]);
  if (sent instanceof Error) return sent;
  moduleLog.warn('Publication mine retrying', { ...fields, retryDelaySeconds, err: error });
  return { status: 'retrying', vacancies: 0 };
}

/**
 * Обработчик задания «разбери публикацию» (П1–П6). Берёт публикацию в разбор, ищет у неё
 * оригинал по тексту, зовёт `mine` её коннектора, а после сбоя `mine` пишет состояние и кладёт
 * повтор. Вызов может прийти повторно. `Error` — сбой базы или отправки повтора: такое задание
 * повторяет очередь.
 */
export async function handleMineJob(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- в задании `Date` и коннекторы, глубоко readonly их не сделать
  input: MineJobInput,
): Promise<Error | MineJobResult> {
  const { publicationId, connectors, now } = input;

  const publication = await claimPublication(db, publicationId, {
    now,
    staleBefore: new Date(now.getTime() - CLAIM_TIMEOUT_MINUTES * MINUTE_MS),
    // Ключи реестра — id коннекторов: `createConnectors` и тесты кладут по `connector.id`.
    connectorIds: [...connectors.values()].map((connector): ConnectorId => connector.id),
  });
  if (publication instanceof Error) return publication;
  const connector = publication === undefined ? undefined : connectors.get(publication.connector);
  if (publication === undefined || connector === undefined) {
    moduleLog.info('Publication mine skipped', { publicationId });
    return { status: 'skipped', vacancies: 0 };
  }

  const fields = { publicationId, connector: connector.id, attempts: publication.attempts };
  const copy = await markCopy(publication, now, fields);
  if (copy !== undefined) return copy;

  const mined = await connector.mine(publication);
  if (mined instanceof Error) return afterMineError(publication, mined, input, fields);
  moduleLog.info('Publication mined', { ...fields, ...mined });
  return mined;
}
