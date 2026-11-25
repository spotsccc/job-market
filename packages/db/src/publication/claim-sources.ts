import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';

import type { DbExecutor } from '../client.ts';
import { sources } from './source.ts';
import type { Connector } from './values.ts';

/**
 * Расписание тика опроса (план тика): взять источники, которые пора опросить, и вернуть тех,
 * чьи задания не ушли в очередь. Расписание после опроса пишет `recordDrain`.
 */

/** Источник, который взял тик: id и `next_run_at` до сдвига — его вернёт `releaseSources`. */
export type ClaimedSource = {
  readonly id: string;
  readonly previousRunAt: Date;
};

export type ClaimDueOptions = {
  readonly now: Date;
  /** Коннекторы реестра: источник чужого коннектора не берём. */
  readonly connectorIds: readonly Connector[];
  /** Сколько источников взять самое большее. */
  readonly limit: number;
};

/**
 * Берёт источники, которые пора опросить, одним запросом (П1 плана тика): включённые, с
 * `next_run_at ≤ now` и коннектором из `connectorIds`, не больше `limit`, самые ранние первыми.
 * Тем же запросом сдвигает им `next_run_at` на `now + interval_minutes`. Строки, которые держит
 * другой тик, пропускает (`SKIP LOCKED`), поэтому два тика одного источника не берут. Порядок
 * строк в ответе не задан. Сбой базы — `Error`.
 */
export async function claimDueSources(
  db: DbExecutor,
  options: ClaimDueOptions,
): Promise<Error | ClaimedSource[]> {
  const { now, connectorIds, limit } = options;
  if (connectorIds.length === 0 || limit <= 0) return [];
  const due = db
    .select({
      id: sources.id,
      previousRunAt: sql<Date>`${sources.nextRunAt}`
        .mapWith(sources.nextRunAt)
        .as('previous_run_at'),
    })
    .from(sources)
    .where(
      and(
        eq(sources.enabled, true),
        lte(sources.nextRunAt, now),
        inArray(sources.connector, [...connectorIds]),
      ),
    )
    .orderBy(asc(sources.nextRunAt), asc(sources.id))
    .limit(limit)
    .for('update', { skipLocked: true })
    .as('due');
  return db
    .update(sources)
    .set({
      nextRunAt: sql`${now.toISOString()}::timestamptz + make_interval(mins => ${sources.intervalMinutes})`,
    })
    .from(due)
    .where(eq(sources.id, due.id))
    .returning({ id: sources.id, previousRunAt: due.previousRunAt })
    .catch((cause: unknown) => new Error('Claiming due sources failed', { cause }));
}

/**
 * Возвращает источникам `next_run_at`, который был до `claimDueSources` (П3 плана тика): их
 * задания не ушли в очередь, и источники берёт следующий тик. Сбой базы — `Error`.
 */
export async function releaseSources(
  db: DbExecutor,
  claimed: readonly ClaimedSource[],
): Promise<Error | undefined> {
  if (claimed.length === 0) return undefined;
  const rows = JSON.stringify(
    claimed.map(({ id, previousRunAt }) => ({ id, previous_run_at: previousRunAt.toISOString() })),
  );
  const written = await db
    .update(sources)
    .set({ nextRunAt: sql`released.previous_run_at` })
    .from(sql`jsonb_to_recordset(${rows}::jsonb) as released(id uuid, previous_run_at timestamptz)`)
    .where(sql`${sources.id} = released.id`)
    .catch(
      (cause: unknown) =>
        new Error(`Releasing ${String(claimed.length)} sources failed`, { cause }),
    );
  if (written instanceof Error) return written;
  return undefined;
}
