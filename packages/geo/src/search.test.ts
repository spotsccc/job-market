import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';

import { getDb } from '@job-market/db';

import { GeoQueryError } from './errors/index.ts';
import { placeKey } from './place.ts';
import { searchPlaces } from './search.ts';
import type { SearchOptions } from './search.ts';
import { closedDb } from './test-db.ts';

/** Тесты читают справочник в тестовой базе: `pnpm db:up && pnpm db:migrate:test`. */

after(async () => {
  await getDb().$client.end();
});

async function search(query: string, options: SearchOptions): Promise<string[]> {
  const suggestions = await searchPlaces(getDb(), query, options);
  assert.ok(
    !(suggestions instanceof Error),
    suggestions instanceof Error ? suggestions.message : '',
  );
  return suggestions.map(({ place, label }) => `${placeKey(place)} ${label}`);
}

describe('searchPlaces', () => {
  test('countries and regions first, then cities by population', async () => {
    assert.deepEqual(await search('бер', { locale: 'ru', limit: 3 }), [
      'country:BM Бермудские о-ва',
      'city:2950159 Берлин, Германия',
      'city:1275198 Берхампур, Индия',
    ]);
  });

  test('regions come before countries', async () => {
    const found = await search('eu', { locale: 'en', limit: 50 });
    assert.equal(found[0], 'region:eu European Union');
    assert.ok(found.some((line) => line.startsWith('city:')));
  });

  test('a place matched by several names appears once', async () => {
    const found = await search('peter', { locale: 'ru', limit: 50 });
    assert.equal(found.filter((line) => line.startsWith('city:498817 ')).length, 1);
  });

  test('a query shorter than two characters does not query the database', async () => {
    assert.deepEqual(await searchPlaces(await closedDb(), ' б ', { locale: 'ru', limit: 10 }), []);
  });

  test('a database failure is a GeoQueryError', async () => {
    const found = await searchPlaces(await closedDb(), 'бер', { locale: 'ru', limit: 10 });
    assert.ok(found instanceof GeoQueryError);
  });
});
