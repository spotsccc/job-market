import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';

import { getDb } from '@job-market/db';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { locateVacancies } from './locate.ts';
import type { LocatedPlaces, PlaceWords } from './locate.ts';
import type { GeoDb } from './resolve.ts';

/** Тесты читают справочник в тестовой базе: `pnpm db:up && pnpm db:migrate:test`. */

after(async () => {
  await getDb().$client.end();
});

const BERLIN = 2_950_159;

function place(role: PlaceWords['role'], fields: Partial<PlaceWords>): PlaceWords {
  return { role, city: null, country: null, region: null, raw: 'raw', ...fields };
}

/** Клиент на своём пуле, который считает запросы в справочник. */
function countingDb(): {
  readonly db: GeoDb;
  readonly queries: () => number;
  readonly end: () => Promise<void>;
} {
  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  let queries = 0;
  // Каждый запрос drizzle берёт клиента из пула.
  pool.on('acquire', () => {
    queries += 1;
  });
  return {
    db: drizzle({ client: pool, casing: 'snake_case' }),
    queries: () => queries,
    end: async () => pool.end(),
  };
}

async function locate(
  roles: readonly (readonly PlaceWords[])[],
): Promise<readonly LocatedPlaces[]> {
  const result = await locateVacancies(
    getDb(),
    roles.map((places) => ({ places })),
  );
  assert.ok(!(result instanceof Error), result instanceof Error ? result.message : '');
  return result;
}

describe('locateVacancies', () => {
  test('a city with its country and a region resolve to directory rows', async () => {
    const [located] = await locate([
      [
        place('office', { city: 'Berlin', country: 'Germany', raw: 'Berlin, Germany' }),
        place('hiring', { region: 'ЕС', raw: 'remote из ЕС' }),
      ],
    ]);

    assert.deepEqual(located, {
      places: [
        {
          role: 'office',
          raw: 'Berlin, Germany',
          resolution: 'resolved',
          cityId: BERLIN,
          countryCode: 'DE',
        },
        { role: 'hiring', raw: 'remote из ЕС', resolution: 'resolved', regionCode: 'eu' },
      ],
      isRemoteFromAnywhere: false,
      locations: ['Berlin, Germany', 'remote из ЕС'],
    });
  });

  test('worldwide for hiring is a flag, not a row; worldwide for an office is dropped', async () => {
    const [hiring, office] = await locate([
      [place('hiring', { region: 'Worldwide', raw: 'Remote, worldwide' })],
      [place('office', { region: 'Worldwide', raw: 'Worldwide' })],
    ]);

    assert.deepEqual(hiring, {
      places: [],
      isRemoteFromAnywhere: true,
      locations: ['Remote, worldwide'],
    });
    assert.deepEqual(office, { places: [], isRemoteFromAnywhere: false, locations: [] });
  });

  test('a city outside its country leaves the country as partial', async () => {
    const [located] = await locate([
      [place('office', { city: 'Берлин', country: 'Франция', raw: 'Берлин' })],
    ]);

    assert.deepEqual(located?.places, [
      { role: 'office', raw: 'Берлин', resolution: 'partial', countryCode: 'FR' },
    ]);
  });

  test('a region found by a less precise field is written as resolved', async () => {
    const [located] = await locate([
      [place('hiring', { country: 'Нарния', region: 'EU', raw: 'Нарния, EU' })],
    ]);

    assert.deepEqual(located?.places, [
      { role: 'hiring', raw: 'Нарния, EU', resolution: 'resolved', regionCode: 'eu' },
    ]);
  });

  test('an unknown place keeps only its text', async () => {
    const [located] = await locate([[place('office', { city: 'Berlinn', raw: 'Berlinn' })]]);

    assert.deepEqual(located, {
      places: [{ role: 'office', raw: 'Berlinn', resolution: 'not_found' }],
      isRemoteFromAnywhere: false,
      locations: ['Berlinn'],
    });
  });

  test('places of all roles of a batch are resolved with one query', async () => {
    const { db, queries, end } = countingDb();

    const located = await locateVacancies(db, [
      { places: [place('office', { city: 'Berlin', raw: 'Berlin' })] },
      { places: [place('hiring', { region: 'EU', raw: 'EU' })] },
    ]);
    await end();

    assert.ok(!(located instanceof Error));
    assert.equal(queries(), 1);
    assert.deepEqual(
      located.map((role) => role.places.map((row) => row.raw)),
      [['Berlin'], ['EU']],
    );
  });
});
