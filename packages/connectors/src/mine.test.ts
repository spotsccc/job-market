import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

import {
  addPublications,
  asc,
  db,
  eq,
  getDb,
  inArray,
  like,
  publications,
  sources,
  vacancies,
  vacancyLocations,
} from '@job-market/db';
import type { PublicationRow } from '@job-market/db';
import type { OccupationNode } from '@job-market/extractor';
import { GeoQueryError } from '@job-market/geo/server';

import type { MinePublication, ProcessOutcome } from './contract.ts';
import { extractedRole } from './models.test-utils.ts';
import { testConnector } from './test-connector.test-utils.ts';

/** Тесты идут в тестовую базу из `apps/web/.env.test`; строки — с префиксом этого файла (E7). */
const PREFIX = 'test_connectors_mine_';
const NOW = new Date('2026-11-20T12:00:00.000Z');

let sourceId = '';

async function addPublication(
  number: number,
  status: PublicationRow['status'] = 'pending',
): Promise<MinePublication> {
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
        status,
      },
      links: [],
    },
  ]);
  const id = [...ids.values()][0];
  assert.ok(id !== undefined);
  return {
    id,
    status,
    connector: 'open-telegram',
    content: 'Product Manager и Designer в Acme',
    postedAt: NOW,
    author: null,
  };
}

async function row(id: string): Promise<PublicationRow> {
  const [found] = await db.select().from(publications).where(eq(publications.id, id));
  assert.ok(found !== undefined);
  return found;
}

async function vacanciesOf(id: string): Promise<(typeof vacancies.$inferSelect)[]> {
  return db
    .select()
    .from(vacancies)
    .where(eq(vacancies.publicationId, id))
    .orderBy(asc(vacancies.position));
}

const twoRoles: ProcessOutcome = {
  kind: 'vacancy',
  roles: [
    extractedRole({
      places: [
        {
          role: 'hiring',
          city: 'Berlin',
          country: 'Germany',
          region: null,
          raw: 'Berlin, Germany',
        },
      ],
    }),
    extractedRole({ title: 'Designer' }),
  ],
};

async function removeRows(): Promise<void> {
  await db.delete(publications).where(like(publications.externalId, `${PREFIX}%`));
}

before(async () => {
  await removeRows();
  await db.delete(sources).where(like(sources.key, `${PREFIX}%`));
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

beforeEach(removeRows);

after(async () => {
  await removeRows();
  await db.delete(sources).where(like(sources.key, `${PREFIX}%`));
  await getDb().$client.end();
});

describe('mine', () => {
  test('writes a vacancy with its roles and places, extracted with the tree from the base', async () => {
    const publication = await addPublication(9120);
    let tree: readonly OccupationNode[] = [];
    const connector = testConnector('open-telegram', {
      process: (_publication, { occupations }) => {
        tree = occupations;
        return Promise.resolve(twoRoles);
      },
    });

    const result = await connector.mine(publication);

    assert.deepEqual(result, { status: 'vacancy', vacancies: 2 });
    assert.equal((await row(publication.id)).status, 'vacancy');
    assert.ok((await row(publication.id)).processedAt !== null);
    const saved = await vacanciesOf(publication.id);
    assert.deepEqual(
      saved.map((vacancy) => vacancy.title),
      ['Product Manager', 'Designer'],
    );
    const places = await db
      .select()
      .from(vacancyLocations)
      .where(
        inArray(
          vacancyLocations.vacancyId,
          saved.map((vacancy) => vacancy.id),
        ),
      );
    assert.equal(places.length, 1);
    assert.equal(places[0]?.vacancyId, saved[0]?.id);
    assert.equal(places[0]?.countryCode, 'DE');
    assert.ok(tree.some((node) => node.id === 'root'));
  });

  test('trash in processing is not a vacancy and the reference is not asked', async () => {
    const publication = await addPublication(1, 'processing');
    let located = false;
    const connector = testConnector('open-telegram', {
      process: () => Promise.resolve({ kind: 'not_vacancy', reason: 'trash', note: 'Ищет работу' }),
      locate: () => {
        located = true;
        return Promise.resolve([]);
      },
    });

    const result = await connector.mine(publication);

    assert.deepEqual(result, { status: 'not_vacancy', vacancies: 0 });
    const saved = await row(publication.id);
    assert.equal(saved.status, 'not_vacancy');
    assert.equal(saved.notVacancyReason, 'trash');
    assert.equal(saved.note, 'Ищет работу');
    assert.equal((await vacanciesOf(publication.id)).length, 0);
    assert.equal(located, false);
  });

  test('an empty publication is written as not_vacancy with the reason and no note', async () => {
    const publication = await addPublication(1);
    const connector = testConnector('open-telegram', {
      process: () => Promise.resolve({ kind: 'not_vacancy', reason: 'empty' }),
    });

    const result = await connector.mine(publication);

    assert.deepEqual(result, { status: 'not_vacancy', vacancies: 0 });
    const saved = await row(publication.id);
    assert.deepEqual(
      [saved.status, saved.notVacancyReason, saved.note],
      ['not_vacancy', 'empty', null],
    );
  });

  test('a publication that is parsed already is skipped without models', async () => {
    let calls = 0;
    const connector = testConnector('open-telegram', {
      process: () => {
        calls += 1;
        return Promise.resolve(twoRoles);
      },
    });

    const duplicate = await connector.mine(await addPublication(1, 'duplicate'));
    const parsed = await connector.mine(await addPublication(2, 'vacancy'));

    assert.deepEqual(duplicate, { status: 'skipped', vacancies: 0 });
    assert.deepEqual(parsed, { status: 'skipped', vacancies: 0 });
    assert.equal(calls, 0);
  });

  test('a model failure writes nothing and keeps the status', async () => {
    const publication = await addPublication(1);
    const connector = testConnector('open-telegram', {
      process: () => Promise.resolve(new Error('Gateway unavailable')),
    });

    const result = await connector.mine(publication);

    assert.ok(result instanceof Error);
    assert.equal((await row(publication.id)).status, 'pending');
    assert.equal((await vacanciesOf(publication.id)).length, 0);
  });

  test('a reference that does not answer writes nothing and keeps the status', async () => {
    const publication = await addPublication(1);
    const connector = testConnector('open-telegram', {
      process: () => Promise.resolve(twoRoles),
      locate: () =>
        Promise.resolve(new GeoQueryError({ cause: new Error('Connection terminated') })),
    });

    const result = await connector.mine(publication);

    assert.ok(result instanceof GeoQueryError);
    assert.equal((await row(publication.id)).status, 'pending');
    assert.equal((await vacanciesOf(publication.id)).length, 0);
  });

  test('a vacancy the database rejects writes nothing and keeps the status', async () => {
    const publication = await addPublication(1);
    const connector = testConnector('open-telegram', {
      process: () =>
        Promise.resolve({
          kind: 'vacancy',
          roles: [extractedRole(), extractedRole({ occupationId: `${PREFIX}missing` })],
        }),
    });

    const result = await connector.mine(publication);

    assert.ok(result instanceof Error);
    assert.equal((await row(publication.id)).status, 'pending');
    assert.equal((await vacanciesOf(publication.id)).length, 0);
  });
});
