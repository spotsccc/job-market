import assert from 'node:assert/strict';
import { after, beforeEach, describe, mock, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import { log } from '@job-market/logger';
import type { LogFields, Logger } from '@job-market/logger';
import { eq, like } from 'drizzle-orm';

import { companies, companyKeys } from './company.ts';
import type { CompanyInput } from './match-company.ts';

/** Тесты идут в тестовую базу из `apps/web/.env.test`: `pnpm db:up && pnpm db:migrate:test`. */

/** Метка в названиях и доменах: тесты других файлов идут в ту же базу параллельно. */
const KEY = 'match-company-test';

const warnings: { message: string; fields: LogFields | undefined }[] = [];
const captured: Logger = {
  debug: () => {},
  info: () => {},
  warn: (message, fields) => {
    warnings.push({ message, fields });
  },
  warning: (message, fields) => {
    warnings.push({ message, fields });
  },
  error: () => {},
  with: () => captured,
};
// Модуль берёт свой логгер через `log.with` при загрузке, поэтому подмена — до импорта его и
// клиента: схема клиента загружает его тоже.
mock.method(log, 'with', () => captured);
const { db, getDb } = await import('../client.ts');
const { matchCompany } = await import('./match-company.ts');

async function match(input: Partial<CompanyInput>): Promise<string | null> {
  return db.transaction(async (tx) =>
    matchCompany(tx, { company: null, companyUrl: null, ...input }),
  );
}

async function keysOfCompany(companyId: string): Promise<string[]> {
  const rows = await db
    .select({ kind: companyKeys.kind, value: companyKeys.value })
    .from(companyKeys)
    .where(eq(companyKeys.companyId, companyId));
  return rows.map((row) => `${row.kind} ${row.value}`).toSorted();
}

async function nameOf(companyId: string): Promise<string | undefined> {
  const [row] = await db
    .select({ name: companies.name })
    .from(companies)
    .where(eq(companies.id, companyId));
  return row?.name;
}

async function removeTestRows(): Promise<void> {
  await db.delete(companyKeys).where(like(companyKeys.value, `%${KEY}%`));
  await db.delete(companies).where(like(companies.name, `%${KEY}%`));
}

describe('matchCompany', () => {
  beforeEach(async () => {
    await removeTestRows();
    warnings.length = 0;
  });

  after(async () => {
    await removeTestRows();
    await getDb().$client.end();
  });

  test('no company and no link give no company', async () => {
    assert.equal(await match({ company: '  ', companyUrl: 'https://t.me/forhr' }), null);
  });

  test('a new name creates a company with the name key', async () => {
    const id = await match({ company: ` Acme ${KEY} ` });

    assert.ok(id !== null);
    assert.equal(await nameOf(id), `Acme ${KEY}`);
    assert.deepEqual(await keysOfCompany(id), [`name acme ${KEY}`]);
  });

  test('a link of a known company adds its domain key', async () => {
    const id = await match({ company: `Acme ${KEY}` });

    const again = await match({ company: `Acme ${KEY}`, companyUrl: `https://acme-${KEY}.io` });

    assert.equal(again, id);
    assert.ok(id !== null);
    assert.deepEqual(await keysOfCompany(id), [`domain acme-${KEY}.io`, `name acme ${KEY}`]);
  });

  test('another spelling of the name finds the same company', async () => {
    const id = await match({ company: `Acme ${KEY}` });

    assert.equal(await match({ company: `ACME ${KEY} Inc` }), id);
  });

  test('a link without a name names the company by its domain', async () => {
    const id = await match({ companyUrl: `https://careers.acme-${KEY}.io/jobs/1` });

    assert.ok(id !== null);
    assert.equal(await nameOf(id), `acme-${KEY}.io`);
  });

  test('the domain wins over the name, and a taken key stays with its company', async () => {
    const byName = await match({ company: `Initech ${KEY}` });
    const byDomain = await match({ companyUrl: `https://initech-${KEY}.io` });
    assert.ok(byName !== null && byDomain !== null);

    const id = await match({ company: `Initech ${KEY}`, companyUrl: `https://initech-${KEY}.io` });

    assert.equal(id, byDomain);
    assert.deepEqual(await keysOfCompany(byName), [`name initech ${KEY}`]);
    assert.deepEqual(await keysOfCompany(byDomain), [`domain initech-${KEY}.io`]);
    assert.deepEqual(
      warnings.map((warning) => warning.message),
      ['company key conflict'],
    );
    assert.deepEqual(warnings[0]?.fields, {
      kind: 'name',
      value: `initech ${KEY}`,
      companyId: byDomain,
      keyCompanyId: byName,
    });
  });

  test('two transactions with one new company create it once', async () => {
    const [first, second] = await Promise.all(
      [0, 1].map(async () =>
        db.transaction(async (tx) => {
          const id = await matchCompany(tx, { company: `Globex ${KEY}`, companyUrl: null });
          // Держим транзакцию открытой, чтобы вторая успела дойти до своего поиска.
          await sleep(100);
          return id;
        }),
      ),
    );

    assert.ok(first !== null);
    assert.equal(second, first);
    const rows = await db
      .select()
      .from(companies)
      .where(eq(companies.name, `Globex ${KEY}`));
    assert.equal(rows.length, 1);
  });

  test('two roles in one transaction get one company', async () => {
    const [first, second] = await db.transaction(async (tx) => [
      await matchCompany(tx, { company: `Globex ${KEY}`, companyUrl: null }),
      await matchCompany(tx, { company: `Globex ${KEY}`, companyUrl: null }),
    ]);

    assert.ok(first !== null);
    assert.equal(second, first);
  });
});
