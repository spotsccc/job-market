import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import {
  addPublications,
  companies,
  companyKeys,
  db,
  eq,
  getDb,
  inArray,
  like,
  publications,
  sources,
  vacancies,
} from '@job-market/db';

import type { MinePublication, ProcessOutcome } from './contract.ts';
import { extractedRole } from './models.test-utils.ts';
import { testConnector } from './test-connector.test-utils.ts';

/** Тесты идут в тестовую базу из `apps/web/.env.test`; строки — с префиксом этого файла (E7). */
const PREFIX = 'test_connectors_dedupe_';
const COMPANY = `${PREFIX}Acme`;
const NOW = new Date('2026-11-20T12:00:00.000Z');

let sourceId = '';

async function addPublication(number: number): Promise<MinePublication> {
  const externalId = `${PREFIX}forhr/${String(number)}`;
  const ids = await addPublications(db, [
    {
      publication: {
        sourceId,
        connector: 'open-telegram',
        externalId,
        url: `https://t.me/${externalId}`,
        content: 'Product Manager и Designer в Acme',
        postedAt: NOW,
        contentHash: `${PREFIX}${String(number)}`,
        status: 'pending',
      },
      links: [],
    },
  ]);
  const id = [...ids.values()][0];
  assert.ok(id !== undefined);
  return {
    id,
    status: 'pending',
    connector: 'open-telegram',
    content: 'Product Manager и Designer в Acme',
    postedAt: NOW,
    author: null,
  };
}

function rolesTitled(...titles: readonly string[]): ProcessOutcome {
  return {
    kind: 'vacancy',
    roles: titles.map((title) => extractedRole({ company: COMPANY, title })),
  };
}

async function mineAs(publication: MinePublication, outcome: ProcessOutcome): Promise<unknown> {
  return testConnector('open-telegram', { process: () => Promise.resolve(outcome) }).mine(
    publication,
  );
}

async function titlesOf(id: string): Promise<string[]> {
  const rows = await db.select().from(vacancies).where(eq(vacancies.publicationId, id));
  return rows.map((vacancy) => vacancy.title);
}

async function removeRows(): Promise<void> {
  await db.delete(publications).where(like(publications.externalId, `${PREFIX}%`));
  await db.delete(sources).where(like(sources.key, `${PREFIX}%`));
  const found = await db
    .select({ id: companies.id })
    .from(companies)
    .where(like(companies.name, `${PREFIX}%`));
  const ids = found.map((company) => company.id);
  if (ids.length === 0) return;
  await db.delete(companyKeys).where(inArray(companyKeys.companyId, ids));
  await db.delete(companies).where(inArray(companies.id, ids));
}

before(async () => {
  await removeRows();
  const [source] = await db
    .insert(sources)
    .values({
      connector: 'open-telegram',
      key: `${PREFIX}forhr`,
      platform: 'geekjobs',
      name: PREFIX,
    })
    .returning({ id: sources.id });
  assert.ok(source !== undefined);
  sourceId = source.id;
});

after(async () => {
  await removeRows();
  await getDb().$client.end();
});

describe('mine with duplicates', () => {
  test('a publication whose roles are all saved from another one is its duplicate', async () => {
    const original = await addPublication(1);
    const copy = await addPublication(2);
    const partial = await addPublication(3);
    await mineAs(original, rolesTitled('Product Manager', 'Designer'));

    const copied = await mineAs(copy, rolesTitled('Product Manager', 'Designer'));
    const mixed = await mineAs(partial, rolesTitled('Product Manager', 'Analyst'));

    assert.deepEqual(copied, { status: 'duplicate', vacancies: 0 });
    const [copyRow] = await db.select().from(publications).where(eq(publications.id, copy.id));
    assert.equal(copyRow?.status, 'duplicate');
    assert.equal(copyRow.duplicateOfId, original.id);
    assert.ok(copyRow.processedAt !== null);
    assert.deepEqual(await titlesOf(copy.id), []);

    assert.deepEqual(mixed, { status: 'vacancy', vacancies: 1 });
    const [partialRow] = await db
      .select()
      .from(publications)
      .where(eq(publications.id, partial.id));
    assert.equal(partialRow?.status, 'vacancy');
    assert.deepEqual(await titlesOf(partial.id), ['Analyst']);
  });
});
