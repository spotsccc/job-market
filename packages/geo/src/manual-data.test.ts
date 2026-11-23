import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';

import { getDb } from '@job-market/db';
import type { PoolClient } from 'pg';

import { buildManualSql } from './build/manual.ts';
import { COUNTRY_CODES } from './generated/countries.ts';
import { MANUAL_ALIASES } from './manual-aliases.ts';
import { REGIONS } from './regions.ts';

/** Тесты читают справочник в тестовой базе: `pnpm db:up && pnpm db:migrate:test`. */

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

async function geonamesAliases(client: PoolClient): Promise<unknown> {
  const { rows } = await client.query(
    "SELECT count(*)::int AS n FROM geo_aliases WHERE source = 'geonames'",
  );
  return rows;
}

/** Куда ведёт нормализованное название: `country:GB`, `city:498817`, `region:eu`. */
async function placesOf(client: PoolClient, normalized: string, source: string): Promise<string[]> {
  const { rows } = await client.query<{ place: string }>(
    `SELECT coalesce('country:' || country_code, 'region:' || region_code, 'city:' || city_id)
      AS place FROM geo_aliases WHERE normalized = $1 AND source = $2 ORDER BY place`,
    [normalized, source],
  );
  return rows.map((row) => row.place);
}

describe('manual geo data', () => {
  test('regions and their countries in the database match regions.ts', async () => {
    const { rows } = await getDb().$client.query<{ code: string; countries: string[] }>(
      `SELECT r.code, array_agg(rc.country_code::text ORDER BY rc.country_code) AS countries
        FROM geo_regions r JOIN geo_region_countries rc ON rc.region_code = r.code
        WHERE r.archived_at IS NULL GROUP BY r.code ORDER BY r.code`,
    );
    const expected = REGIONS.map((region) => ({
      code: region.code,
      countries: [...region.countries].toSorted((a, b) => a.localeCompare(b)),
    })).toSorted((a, b) => a.code.localeCompare(b.code));
    assert.deepEqual(rows, expected);
  });

  test('manual aliases lead to their places', async () => {
    await inRolledBackTransaction(async (client) => {
      assert.deepEqual(await placesOf(client, 'spb', 'manual'), ['city:498817']);
      assert.deepEqual(await placesOf(client, 'england', 'manual'), ['country:GB']);
      assert.deepEqual(await placesOf(client, 'ес', 'manual'), ['region:eu']);
    });
  });

  test('a region removed from regions.ts is archived, geonames names stay', async () => {
    await inRolledBackTransaction(async (client) => {
      const geonames = await geonamesAliases(client);
      const without = buildManualSql({
        regions: REGIONS.filter((region) => region.code !== 'dach'),
        aliases: MANUAL_ALIASES,
        countryCodes: COUNTRY_CODES,
      });
      assert.ok(!(without instanceof Error));
      await client.query(without.sql);

      const dach = await client.query<{ archived_at: Date | null }>(
        "SELECT archived_at FROM geo_regions WHERE code = 'dach'",
      );
      assert.ok(dach.rows[0]?.archived_at instanceof Date);
      assert.deepEqual(await placesOf(client, 'dach', 'manual'), []);
      assert.deepEqual(await geonamesAliases(client), geonames);

      const all = buildManualSql({
        regions: REGIONS,
        aliases: MANUAL_ALIASES,
        countryCodes: COUNTRY_CODES,
      });
      assert.ok(!(all instanceof Error));
      await client.query(all.sql);
      const restored = await client.query<{ archived_at: Date | null }>(
        "SELECT archived_at FROM geo_regions WHERE code = 'dach'",
      );
      assert.equal(restored.rows[0]?.archived_at, null);
    });
  });
});
