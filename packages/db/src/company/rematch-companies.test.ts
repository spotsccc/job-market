import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

import { eq, like } from 'drizzle-orm';

import { db, getDb } from '../client.ts';
import { publications, sources } from '../publication/index.ts';
import { vacancies } from '../vacancy/vacancy.ts';
import { companies, companyKeys } from './company.ts';
import { rematchCompanies } from './rematch-companies.ts';

/** Тесты идут в тестовую базу из `apps/web/.env.test`: `pnpm db:up && pnpm db:migrate:test`. */

const KEY = 'rematch-test';
let publicationId = '';

function vacancy(position: number, company: string | null, companyUrl: string | null) {
  return {
    publicationId,
    position,
    schemaVersion: 1 as const,
    title: `Роль ${String(position)}`,
    company,
    companyUrl,
    hiringParty: 'employer' as const,
    isRemoteFromAnywhere: false,
    apply: { urls: [], emails: [], directMessage: true },
    summary: 'Делать продукт.',
  };
}

async function removeTestRows(): Promise<void> {
  await db.delete(publications).where(eq(publications.externalId, `${KEY}/1`));
  await db.delete(sources).where(eq(sources.key, KEY));
  await db.delete(companyKeys).where(like(companyKeys.value, `%${KEY}%`));
  await db.delete(companies).where(like(companies.name, `%${KEY}%`));
}

const rematch = async (batchSize = 500) =>
  rematchCompanies(db, { publicationIds: [publicationId], batchSize });

describe('rematchCompanies', () => {
  before(async () => {
    await removeTestRows();
    const [source] = await db
      .insert(sources)
      .values({ connector: 'open-telegram', key: KEY, platform: 'geekjobs', name: KEY })
      .returning({ id: sources.id });
    assert.ok(source !== undefined);
    const [publication] = await db
      .insert(publications)
      .values({
        sourceId: source.id,
        connector: 'open-telegram',
        externalId: `${KEY}/1`,
        url: `https://t.me/${KEY}/1`,
        content: 'Ищем троих',
        postedAt: new Date('2026-11-20T10:00:00.000Z'),
        contentHash: 'hash',
        status: 'vacancy',
      })
      .returning({ id: publications.id });
    assert.ok(publication !== undefined);
    publicationId = publication.id;
  });

  beforeEach(async () => {
    await db.delete(vacancies).where(eq(vacancies.publicationId, publicationId));
    await db.delete(companyKeys).where(like(companyKeys.value, `%${KEY}%`));
    await db.delete(companies).where(like(companies.name, `%${KEY}%`));
    await db
      .insert(vacancies)
      .values([
        vacancy(0, `Yandex ${KEY}`, `https://${KEY}.ru`),
        vacancy(1, `Яндекс ${KEY}`, `https://careers.${KEY}.ru/jobs`),
        vacancy(2, null, null),
      ]);
  });

  after(async () => {
    await removeTestRows();
    await getDb().$client.end();
  });

  test('two spellings with one site get one company', async () => {
    const summary = await rematch();

    assert.deepEqual(summary, { processed: 3, changed: 2, created: 1, withoutCompany: 1 });
    const rows = await db
      .select({ position: vacancies.position, companyId: vacancies.companyId })
      .from(vacancies)
      .where(eq(vacancies.publicationId, publicationId))
      .orderBy(vacancies.position);
    const [first] = rows;
    assert.ok(typeof first?.companyId === 'string');
    assert.deepEqual(
      rows.map((row) => row.companyId),
      [first.companyId, first.companyId, null],
    );
  });

  test('a second run changes nothing', async () => {
    await rematch();

    assert.deepEqual(await rematch(), {
      processed: 3,
      changed: 0,
      created: 0,
      withoutCompany: 1,
    });
  });

  test('small batches still process every vacancy', async () => {
    const summary = await rematch(2);

    assert.equal(summary.processed, 3);
    assert.equal(summary.changed, 2);
  });
});
