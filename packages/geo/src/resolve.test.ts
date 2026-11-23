import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';

import { eq, geoCities, getDb } from '@job-market/db';

import { GeoQueryError } from './errors/index.ts';
import { placeKey } from './place.ts';
import { resolvePlaces } from './resolve.ts';
import type { PlaceInput, ResolvedPlace } from './resolve.ts';
import { closedDb } from './test-db.ts';

/** Тесты читают справочник в тестовой базе: `pnpm db:up && pnpm db:migrate:test`. */

after(async () => {
  await getDb().$client.end();
});

const SAINT_PETERSBURG = 498_817;

/** Ответ коротко: `city:498817`, `partial country:US city ambiguous`, `unresolved not_found`. */
function brief(result: ResolvedPlace): string {
  if (result.status === 'resolved') {
    return placeKey(result.place);
  }
  if (result.status === 'partial') {
    const { field, reason } = result.unresolved;
    return `partial ${placeKey(result.place)} ${field} ${reason}`;
  }
  return `unresolved ${result.reason}`;
}

async function resolveBrief(inputs: readonly PlaceInput[]): Promise<string[]> {
  const results = await resolvePlaces(getDb(), inputs);
  assert.ok(!(results instanceof Error), results instanceof Error ? results.message : '');
  return results.map((result) => brief(result));
}

describe('resolvePlaces', () => {
  test('answers every input in order', async () => {
    assert.deepEqual(
      await resolveBrief([
        { city: 'Питер' },
        { country: 'UK' },
        { region: 'EU' },
        { city: 'Paris' },
        { city: 'Alexandria', country: 'US' },
        { city: 'Нарния' },
      ]),
      [
        `city:${SAINT_PETERSBURG}`,
        'country:GB',
        'region:eu',
        'city:2988507',
        'partial country:US city ambiguous',
        'unresolved not_found',
      ],
    );
  });

  test('a city is picked by population only when it is five times bigger', async () => {
    // Александрия в Египте — 5,3 млн, в Вирджинии — 159 тыс.; в Вирджинии и Луизиане — 159 и 48 тыс.
    assert.deepEqual(await resolveBrief([{ city: 'Alexandria' }]), ['city:361058']);
  });

  test('a recognised country narrows the cities', async () => {
    assert.deepEqual(await resolveBrief([{ city: 'Paris', country: 'United States' }]), [
      'city:4717560',
    ]);
  });

  test('a field is searched only among its kind of places', async () => {
    assert.deepEqual(await resolveBrief([{ city: 'UK' }, { country: 'Paris' }]), [
      'unresolved not_found',
      'unresolved not_found',
    ]);
  });

  test('worldwide phrases in any field are anywhere', async () => {
    assert.deepEqual(await resolveBrief([{ city: 'worldwide' }, { country: 'Весь мир' }]), [
      'anywhere',
      'anywhere',
    ]);
  });

  test('a city carries its country and names', async () => {
    const results = await resolvePlaces(getDb(), [{ city: 'спб' }]);
    assert.ok(!(results instanceof Error));
    assert.deepEqual(results, [
      {
        status: 'resolved',
        place: { kind: 'city', id: SAINT_PETERSBURG, countryCode: 'RU' },
        city: { name: 'Saint Petersburg', nameRu: 'Санкт-Петербург', nameEn: null },
      },
    ]);
  });

  test('an archived city is not found', async () => {
    await assert.rejects(
      getDb().transaction(async (tx) => {
        await tx
          .update(geoCities)
          .set({ archivedAt: new Date() })
          .where(eq(geoCities.id, SAINT_PETERSBURG));
        const results = await resolvePlaces(tx, [{ city: 'Питер', country: 'Россия' }]);
        assert.ok(!(results instanceof Error));
        assert.deepEqual(
          results.map((result) => brief(result)),
          ['partial country:RU city not_found'],
        );
        tx.rollback();
      }),
      { message: 'Rollback' },
    );
  });

  test('an empty batch and anywhere-only inputs do not query the database', async () => {
    const db = await closedDb();
    assert.deepEqual(await resolvePlaces(db, []), []);
    assert.deepEqual((await resolvePlaces(db, [{ city: 'anywhere' }])) instanceof Error, false);
  });

  test('a database failure is a GeoQueryError', async () => {
    assert.ok(
      (await resolvePlaces(await closedDb(), [{ city: 'Питер' }])) instanceof GeoQueryError,
    );
  });
});
