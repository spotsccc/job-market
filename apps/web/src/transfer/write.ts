import {
  insertPublication,
  markFailed,
  replacePublicationLinks,
  saveVacancies,
  upsertAuthors,
} from '@job-market/db';
import type { Database, LinkToSave, PublicationToSave } from '@job-market/db';
import type { LinkReport } from '@job-market/enricher';
import { log } from '@job-market/logger';

import { errorText } from './outcome.ts';
import type { Outcome, Prepared, Written } from './outcome.ts';
import { sourceIds, sourceKey } from './queries.ts';
import { countWritten } from './summary.ts';
import type { TransferSummary } from './summary.ts';

const moduleLog = log.with({ module: 'transfer' });

/** Транзакция откатывается намеренно: пробный запуск или публикацию уже записали. */
class Rollback extends Error {
  readonly reason: 'dry_run' | 'already_transferred';

  constructor(reason: 'dry_run' | 'already_transferred') {
    super(`Transaction rolled back: ${reason}`);
    this.reason = reason;
  }
}

/** Строка публикации без итога: его ставят `insertPublication` по итогу или `markFailed`. */
function baseRow(item: Prepared, sourceId: string, authorId: string | null): PublicationToSave {
  return {
    ...item.mapped.publication,
    sourceId,
    authorId,
    content: item.content,
    contentHash: item.hash,
    attempts: 1,
    processedAt: new Date(),
  };
}

/** Строка публикации с итогом разбора (П4, П5). */
function publicationRow(
  base: PublicationToSave,
  outcome: Exclude<Written, { kind: 'failed' }>,
): PublicationToSave {
  return {
    ...base,
    lastError: null,
    status: outcome.kind,
    notVacancyReason: outcome.kind === 'not_vacancy' ? outcome.reason : null,
    note: outcome.kind === 'not_vacancy' ? outcome.note : null,
    duplicateOfId: outcome.kind === 'duplicate' ? outcome.originalId : null,
  };
}

/** Ссылка поста для `publication_links` (П8): ошибка — одной строкой, как `last_error`. */
function linkRow(link: LinkReport): LinkToSave {
  return {
    url: link.url,
    targetUrl: link.target,
    status: link.status,
    reader: link.reader,
    error: link.error === null ? null : errorText(link.error),
  };
}

/**
 * Пишет пост одной транзакцией: автор, публикация, её ссылки, вакансии и места (П1, П8, П9, П17). `already` —
 * публикацию записал другой запуск, транзакция откатывается (E6). Сбой базы — исключение.
 */
async function writePost(
  db: Database,
  item: Prepared,
  outcome: Written,
  sourceId: string,
  dryRun: boolean,
): Promise<'written' | 'already'> {
  return db
    .transaction(async (tx) => {
      const { author } = item.mapped;
      const authors =
        author === null ? new Map<string, string>() : await upsertAuthors(tx, [author]);
      const authorId: string | null = [...authors.values()][0] ?? null;
      const base = baseRow(item, sourceId, authorId);
      const id =
        outcome.kind === 'failed'
          ? await markFailed(tx, base, errorText(outcome.error))
          : await insertPublication(tx, publicationRow(base, outcome));
      if (id === null) throw new Rollback('already_transferred');
      await replacePublicationLinks(
        tx,
        id,
        item.links.map((link) => linkRow(link)),
      );
      if (outcome.kind === 'vacancy') await saveVacancies(tx, id, outcome.roles);
      if (dryRun) throw new Rollback('dry_run');
      return 'written' as const;
    })
    .catch((error: unknown) => {
      if (!(error instanceof Rollback)) throw error;
      return error.reason === 'dry_run' ? 'written' : 'already';
    });
}

type Statuses = Map<string, Outcome['kind'] | 'already'>;

/**
 * С каким итогом пишется пост. Копия из этой пачки становится `duplicate`, если её оригинал
 * записан; иначе `null` — она ждёт следующего запуска (П4).
 */
function writtenOutcome(outcome: Outcome, statuses: Statuses): Written | null {
  if (outcome.kind === 'pending') return null;
  if (outcome.kind !== 'follower') return outcome;
  const leader = statuses.get(outcome.leaderId);
  return leader === 'vacancy' || leader === 'not_vacancy'
    ? { kind: 'duplicate', originalId: outcome.leaderId }
    : null;
}

/** Ошибка поста: строкой — в итог, целиком с причинами — в лог. */
function fail(summary: TransferSummary, externalId: string, err: Error): void {
  summary.errors.push({ externalId, error: errorText(err) });
  moduleLog.error('Post transfer failed', { externalId, err });
}

type BatchState = {
  readonly db: Database;
  readonly dryRun: boolean;
  readonly sources: ReadonlyMap<string, string>;
  readonly statuses: Statuses;
  /** Оригиналы, записанные в этом запуске, по хэшу (П4). */
  readonly runOriginals: Map<string, string>;
  readonly summary: TransferSummary;
};

/** Пишет один пост пачки и учитывает его в итоге; `true` — пост записан не как ошибка. */
async function writeOne(state: BatchState, item: Prepared): Promise<boolean> {
  const { summary } = state;
  const { externalId } = item.post;
  const outcome = writtenOutcome(item.outcome, state.statuses);
  if (outcome === null) {
    summary.postponed += 1;
    return false;
  }
  // Пробный запуск не оставляет оригинал в базе: копию нечем связать, она только считается.
  if (
    state.dryRun &&
    outcome.kind === 'duplicate' &&
    state.runOriginals.get(item.hash) === outcome.originalId
  ) {
    countWritten(summary, outcome);
    return true;
  }
  const sourceId = state.sources.get(sourceKey(item.mapped.source));
  if (sourceId === undefined) {
    fail(summary, externalId, new Error(`Source ${sourceKey(item.mapped.source)} is missing`));
    return false;
  }
  if (item.mapped.author === null) {
    moduleLog.warn('Author url is not a profile, writing without author', {
      externalId,
      authorUrl: item.post.authorUrl,
    });
  }
  const result = await writePost(state.db, item, outcome, sourceId, state.dryRun).catch(
    (cause: unknown) => new Error('Post write failed', { cause }),
  );
  if (result instanceof Error) {
    fail(summary, externalId, result);
    return false;
  }
  return record(state, item, outcome, result);
}

/** Учитывает записанный пост: статус для копий пачки, оригинал для копий запуска, итог. */
function record(
  state: BatchState,
  item: Prepared,
  outcome: Written,
  result: 'written' | 'already',
): boolean {
  const { summary } = state;
  if (result === 'already') {
    summary.alreadyTransferred += 1;
    state.statuses.set(item.post.id, 'already');
    return false;
  }
  state.statuses.set(item.post.id, outcome.kind);
  if (outcome.kind === 'failed') {
    fail(summary, item.post.externalId, outcome.error);
    return false;
  }
  if (outcome.kind === 'vacancy' || outcome.kind === 'not_vacancy') {
    state.runOriginals.set(item.hash, item.post.id);
  }
  countWritten(summary, outcome);
  return true;
}

/**
 * Пишет пачку по порядку П1: копия идёт после своего оригинала из этой же пачки. Ответ —
 * сколько постов записано не как ошибка; ошибки — в итоге.
 */
export async function writeBatch(
  db: Database,
  prepared: readonly Prepared[],
  dryRun: boolean,
  runOriginals: Map<string, string>,
  summary: TransferSummary,
): Promise<number> {
  const state: BatchState = {
    db,
    dryRun,
    sources: await sourceIds(
      db,
      prepared.map((item) => item.mapped),
    ),
    statuses: new Map(),
    runOriginals,
    summary,
  };
  let written = 0;
  for (const item of prepared) {
    // oxlint-disable-next-line no-await-in-loop -- посты пишутся по порядку: копия после оригинала
    if (await writeOne(state, item)) written += 1;
  }
  return written;
}
