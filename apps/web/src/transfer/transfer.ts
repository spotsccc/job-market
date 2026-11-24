import type { Database } from '@job-market/db';
import type { Reader } from '@job-market/enricher';
import { log } from '@job-market/logger';
import type { LanguageModel } from 'ai';

import { errorText } from './outcome.ts';
import type { Prepared } from './outcome.ts';
import { prepareBatch } from './prepare.ts';
import { nextBatch } from './queries.ts';
import type { Cursor } from './queries.ts';
import { emptySummary } from './summary.ts';
import type { TransferSummary } from './summary.ts';
import { writeBatch } from './write.ts';

/**
 * Перенос постов `legacy_posts` в новую модель через новый экстрактор (П1–П8). Это
 * единственный код, который читает старую модель и пишет новую.
 */
export type { TransferError, TransferSummary } from './summary.ts';

const moduleLog = log.with({ module: 'transfer' });

/** Постов в пачке: дерево, енричер и справочник зовутся по разу на пачку. */
const BATCH_SIZE = 20;

export type TransferOptions = {
  readonly db: Database;
  /** Не больше стольких постов за запуск; без него — все. */
  readonly limit?: number;
  /** Всё как при переносе, но каждая транзакция откатывается (П7). */
  readonly dryRun?: boolean;
  /** Модель экстрактора; без неё — модель по умолчанию через AI Gateway. */
  readonly model?: LanguageModel;
  /** Читатели ссылок енричера: скрипт создаёт их через `createReaders`. */
  readonly readers: readonly Reader[];
};

/**
 * Первая ошибка модели, если в пачке не записан ни один пост и все ошибки — от модели
 * (E8): так кончившиеся кредиты не превращают весь перенос в ошибки. Иначе `null`.
 */
function stopReason(prepared: readonly Prepared[], written: number): Error | null {
  const failures = prepared.flatMap((item) =>
    item.outcome.kind === 'failed' ? [item.outcome] : [],
  );
  const [first] = failures;
  if (written > 0 || first === undefined || failures.some((failure) => !failure.fromModel)) {
    return null;
  }
  return first.error;
}

/**
 * Переносит посты пачками по 20 (П1–П8). Каждый пост пробуется один раз за запуск, даже в
 * пробном. Запуск останавливается после пачки, в которой упали все вызовы модели (E8).
 */
export async function transferPosts(options: TransferOptions): Promise<TransferSummary> {
  const { db } = options;
  const dryRun = options.dryRun ?? false;
  const summary = emptySummary();
  const runOriginals = new Map<string, string>();
  let remaining = options.limit ?? Number.POSITIVE_INFINITY;
  let cursor: Cursor | null = null;
  while (remaining > 0) {
    // oxlint-disable-next-line no-await-in-loop -- пачки идут по курсору одна за другой
    const posts = await nextBatch(db, cursor, Math.min(BATCH_SIZE, remaining));
    const last = posts.at(-1);
    if (last === undefined) break;
    cursor = { postedAt: last.postedAt, id: last.id };
    remaining -= posts.length;
    summary.posts += posts.length;

    // oxlint-disable-next-line no-await-in-loop -- пачки идут по курсору одна за другой
    const prepared = await prepareBatch(
      db,
      posts,
      { readers: options.readers, model: options.model },
      runOriginals,
      summary,
    );
    // oxlint-disable-next-line no-await-in-loop -- пачки идут по курсору одна за другой
    const written = await writeBatch(db, prepared, dryRun, runOriginals, summary);
    const stop = stopReason(prepared, written);
    if (stop !== null) {
      summary.stopped = `все вызовы модели упали: ${errorText(stop)}`;
      moduleLog.error('Transfer stopped: every model call of the batch failed', { err: stop });
      break;
    }
  }
  return summary;
}
