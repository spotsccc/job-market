import { and, asc, eq, gt, inArray } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import type { Database, DbExecutor } from '../client.ts';
import { vacancies } from '../vacancy/vacancy.ts';
import { keysOf } from './company-keys.ts';
import { lockKeys, resolveCompany } from './match-company.ts';

export type RematchOptions = {
  /** Вакансий в пачке; пачка — одна транзакция. */
  readonly batchSize?: number;
  /** Только вакансии этих публикаций; без него — все. Нужен тестам: база у них общая. */
  readonly publicationIds?: readonly string[];
};

export type RematchSummary = {
  readonly processed: number;
  /** Вакансии, у которых сменился `company_id`. */
  readonly changed: number;
  /** Компании, созданные этим запуском. */
  readonly created: number;
  /** Вакансии без ключей компании. */
  readonly withoutCompany: number;
};

type Row = {
  readonly id: string;
  readonly company: string | null;
  readonly companyUrl: string | null;
  readonly companyId: string | null;
};

type Counts = { changed: number; created: number; withoutCompany: number };

async function readBatch(
  db: Database,
  cursor: string | undefined,
  { batchSize = 500, publicationIds }: RematchOptions,
): Promise<Row[]> {
  const conditions: SQL[] = [];
  if (cursor !== undefined) conditions.push(gt(vacancies.id, cursor));
  if (publicationIds !== undefined) {
    conditions.push(inArray(vacancies.publicationId, [...publicationIds]));
  }
  return db
    .select({
      id: vacancies.id,
      company: vacancies.company,
      companyUrl: vacancies.companyUrl,
      companyId: vacancies.companyId,
    })
    .from(vacancies)
    .where(and(...conditions))
    .orderBy(asc(vacancies.id))
    .limit(batchSize);
}

/** Сопоставляет пачку в транзакции вызывающего и прибавляет её итог к `counts`. */
async function rematchBatch(tx: DbExecutor, batch: readonly Row[], counts: Counts): Promise<void> {
  // Все ключи пачки сразу и в общем порядке: иначе встречная запись может дать deadlock.
  await lockKeys(
    tx,
    batch.flatMap((row) => keysOf(row.company, row.companyUrl)),
  );
  for (const row of batch) {
    // oxlint-disable-next-line no-await-in-loop -- вакансии одной транзакции идут по очереди
    const match = await resolveCompany(tx, row);
    const companyId = match?.companyId ?? null;
    if (match === null) counts.withoutCompany += 1;
    if (match?.created === true) counts.created += 1;
    if (companyId === row.companyId) continue;
    // oxlint-disable-next-line no-await-in-loop -- вакансии одной транзакции идут по очереди
    await tx.update(vacancies).set({ companyId }).where(eq(vacancies.id, row.id));
    counts.changed += 1;
  }
}

/**
 * Пересчёт компаний записанных вакансий (П8): пачки по возрастанию id, компания каждой — по П3 и
 * П4, `company_id` обновляется, только если изменился. Пачка — одна транзакция. Вакансия,
 * записанная после старта, уже сопоставлена `saveVacancies` (E6). Сбой базы — исключение.
 */
export async function rematchCompanies(
  db: Database,
  options: RematchOptions = {},
): Promise<RematchSummary> {
  const counts: Counts = { changed: 0, created: 0, withoutCompany: 0 };
  let processed = 0;
  let cursor: string | undefined;
  for (;;) {
    // oxlint-disable-next-line no-await-in-loop -- пачки идут по курсору одна за другой
    const batch = await readBatch(db, cursor, options);
    if (batch.length === 0) break;
    // oxlint-disable-next-line no-await-in-loop -- пачки идут по курсору одна за другой
    await db.transaction(async (tx) => rematchBatch(tx, batch, counts));
    processed += batch.length;
    cursor = batch.at(-1)?.id;
  }
  return { processed, ...counts };
}
