import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

import { eq, inArray, like } from 'drizzle-orm';

import { db, getDb } from '../client.ts';
import { publications, sources } from '../publication/index.ts';
import { vacancies } from '../vacancy/vacancy.ts';
import { companies, companyKeys } from './company.ts';
import { CompanyNotFoundError, SameCompanyError } from './errors.ts';
import { matchCompany } from './match-company.ts';
import { mergeCompanies } from './merge-companies.ts';

/** Тесты идут в тестовую базу из `apps/web/.env.test`: `pnpm db:up && pnpm db:migrate:test`. */

const KEY = 'merge-test';
const MISSING = '00000000-0000-4000-8000-000000000000';
let publicationId = '';
let fromId = '';
let intoId = '';

async function company(name: string, keys: readonly string[]): Promise<string> {
  const [row] = await db.insert(companies).values({ name }).returning({ id: companies.id });
  assert.ok(row !== undefined);
  await db
    .insert(companyKeys)
    .values(keys.map((value) => ({ kind: 'name' as const, value, companyId: row.id })));
  return row.id;
}

async function vacancyCompanies(): Promise<(string | null)[]> {
  const rows = await db
    .select({ companyId: vacancies.companyId })
    .from(vacancies)
    .where(eq(vacancies.publicationId, publicationId))
    .orderBy(vacancies.position);
  return rows.map((row) => row.companyId);
}

async function removeCompanies(): Promise<void> {
  await db.delete(vacancies).where(eq(vacancies.publicationId, publicationId));
  await db.delete(companyKeys).where(like(companyKeys.value, `%${KEY}%`));
  await db.delete(companies).where(like(companies.name, `%${KEY}%`));
}

async function removeTestRows(): Promise<void> {
  await db.delete(publications).where(eq(publications.externalId, `${KEY}/1`));
  await db.delete(sources).where(eq(sources.key, KEY));
  await db.delete(companyKeys).where(like(companyKeys.value, `%${KEY}%`));
  await db.delete(companies).where(like(companies.name, `%${KEY}%`));
}

describe('mergeCompanies', () => {
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
        content: 'Ищем',
        postedAt: new Date('2026-11-20T10:00:00.000Z'),
        contentHash: 'hash',
        status: 'vacancy',
      })
      .returning({ id: publications.id });
    assert.ok(publication !== undefined);
    publicationId = publication.id;
  });

  beforeEach(async () => {
    await removeCompanies();
    fromId = await company(`Yandex LLC ${KEY}`, [`yandex llc ${KEY}`, `yandex ${KEY}`]);
    intoId = await company(`Яндекс ${KEY}`, [`яндекс ${KEY}`]);
    await db.insert(vacancies).values(
      [fromId, fromId, fromId, intoId].map((companyId, position) => ({
        publicationId,
        position,
        schemaVersion: 1 as const,
        title: `Роль ${String(position)}`,
        hiringParty: 'employer' as const,
        companyId,
        isRemoteFromAnywhere: false,
        apply: { urls: [], emails: [], directMessage: true },
        summary: 'Делать продукт.',
      })),
    );
  });

  after(async () => {
    await removeTestRows();
    await getDb().$client.end();
  });

  test('keys and vacancies move to the kept company, the other one is removed', async () => {
    const summary = await mergeCompanies(db, fromId, intoId);

    assert.deepEqual(summary, { keys: 2, vacancies: 3, removed: `Yandex LLC ${KEY}` });
    assert.deepEqual(await vacancyCompanies(), [intoId, intoId, intoId, intoId]);
    const keys = await db
      .select({ value: companyKeys.value })
      .from(companyKeys)
      .where(eq(companyKeys.companyId, intoId));
    assert.equal(keys.length, 3);
    const rows = await db
      .select({ id: companies.id, name: companies.name })
      .from(companies)
      .where(inArray(companies.id, [fromId, intoId]));
    assert.deepEqual(rows, [{ id: intoId, name: `Яндекс ${KEY}` }]);
  });

  test('after the merge a key of the removed company finds the kept one', async () => {
    await mergeCompanies(db, fromId, intoId);

    const id = await db.transaction(async (tx) =>
      matchCompany(tx, { company: `Yandex ${KEY}`, companyUrl: null }),
    );

    assert.equal(id, intoId);
  });

  test('a company is not merged into itself', async () => {
    const result = await mergeCompanies(db, intoId, intoId);

    assert.ok(result instanceof SameCompanyError);
    assert.deepEqual(await vacancyCompanies(), [fromId, fromId, fromId, intoId]);
  });

  test('a missing company is reported by its id and nothing changes', async () => {
    const result = await mergeCompanies(db, MISSING, intoId);

    assert.ok(result instanceof CompanyNotFoundError);
    assert.equal(result.id, MISSING);
    assert.deepEqual(await vacancyCompanies(), [fromId, fromId, fromId, intoId]);
  });
});
