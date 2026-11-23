import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';

import { getDb } from '@job-market/db';
import { MIGRATIONS_FOLDER } from '@job-market/db/migrate';
import type { PoolClient } from 'pg';

import { buildGeonamesSql } from './build/sql.ts';
import type { CityRecord, CountryRecord, GeonamesData } from './build/types.ts';
import { COUNTRY_CODES } from './generated/countries.ts';

/** Тесты читают справочник в тестовой базе: `pnpm db:up && pnpm db:migrate:test`. */

const BERLIN = 2_950_159;
const MUNICH = 2_867_714;

after(async () => {
  await getDb().$client.end();
});

/** Выполняет `body` в транзакции и откатывает её: справочник в базе не меняется. */
async function inRolledBackTransaction(body: (client: PoolClient) => Promise<void>): Promise<void> {
  const client = await getDb().$client.connect();
  try {
    await client.query('BEGIN');
    await body(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

async function counts(client: PoolClient): Promise<Record<string, number>> {
  const { rows } = await client.query<Record<string, number>>(`SELECT
    (SELECT count(*)::int FROM geo_countries) AS countries,
    (SELECT count(*)::int FROM geo_cities) AS cities,
    (SELECT count(*)::int FROM geo_cities WHERE archived_at IS NOT NULL) AS archived,
    (SELECT count(*)::int FROM geo_aliases) AS aliases`);
  return rows[0] ?? {};
}

function geonamesMigration(): string {
  const files = readdirSync(MIGRATIONS_FOLDER).filter((file) => file.endsWith('_geo_geonames.sql'));
  const last = files.toSorted((a, b) => a.localeCompare(b)).at(-1);
  assert.ok(last !== undefined, 'no geo_geonames migration');
  return readFileSync(join(MIGRATIONS_FOLDER, last), 'utf8');
}

/** Снимок с Германией и только теми её городами, что переданы. */
async function snapshot(client: PoolClient, cityIds: readonly number[]): Promise<GeonamesData> {
  const country = await client.query<CountryRecord>(
    `SELECT code, iso3, geoname_id AS "geonameId", continent, name_en AS "nameEn",
      name_ru AS "nameRu", population::float8 AS population FROM geo_countries WHERE code = 'DE'`,
  );
  const cities = await client.query<CityRecord>(
    `SELECT id, country_code AS "countryCode", admin1_code AS "admin1Code", name,
      name_en AS "nameEn", name_ru AS "nameRu", lat, lng, population, timezone
      FROM geo_cities WHERE id = ANY($1)`,
    [cityIds],
  );
  return { countries: country.rows, cities: cities.rows, aliases: [], droppedCities: 0 };
}

async function archivedAt(client: PoolClient, id: number): Promise<unknown> {
  const { rows } = await client.query<{ archived_at: Date | null }>(
    'SELECT archived_at FROM geo_cities WHERE id = $1',
    [id],
  );
  return rows[0]?.archived_at;
}

describe('geo data', () => {
  test('the migration loaded all countries and cities', async () => {
    await inRolledBackTransaction(async (client) => {
      const result = await counts(client);
      assert.equal(result['countries'], 250);
      assert.ok((result['cities'] ?? 0) >= 31_000, `cities: ${String(result['cities'])}`);
    });
  });

  test('country codes in the database match COUNTRY_CODES', async () => {
    const { rows } = await getDb().$client.query<{ code: string }>(
      'SELECT code FROM geo_countries ORDER BY code',
    );
    assert.deepEqual(
      rows.map((row) => row.code),
      [...COUNTRY_CODES].toSorted((a, b) => a.localeCompare(b)),
    );
  });

  test('applying the migration again changes nothing', async () => {
    await inRolledBackTransaction(async (client) => {
      const before = await counts(client);
      await client.query(geonamesMigration());
      assert.deepEqual(await counts(client), before);
    });
  });

  test('a city missing from a snapshot is archived and restored when it returns', async () => {
    await inRolledBackTransaction(async (client) => {
      await client.query(
        `INSERT INTO geo_aliases (normalized, alias, lang, source, country_code)
          VALUES ('фрг вручную', 'ФРГ вручную', 'ru', 'manual', 'DE')`,
      );

      await client.query(buildGeonamesSql(await snapshot(client, [BERLIN])));
      assert.ok((await archivedAt(client, MUNICH)) instanceof Date);
      assert.equal(await archivedAt(client, BERLIN), null);

      await client.query(buildGeonamesSql(await snapshot(client, [BERLIN, MUNICH])));
      assert.equal(await archivedAt(client, MUNICH), null);

      const manual = await client.query(
        "SELECT 1 FROM geo_aliases WHERE source = 'manual' AND normalized = 'фрг вручную'",
      );
      assert.equal(manual.rowCount, 1);
    });
  });
});
