import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ancestors, covers, regionsOf } from './hierarchy.ts';
import type { RegionMembers } from './hierarchy.ts';
import { placeKey } from './place.ts';
import type { Place } from './place.ts';

/** Свой набор регионов: тесты не зависят от состава в regions.ts. */
const REGIONS: readonly RegionMembers[] = [
  { code: 'europe', countries: ['AT', 'CH', 'DE', 'FR'] },
  { code: 'eu', countries: ['AT', 'DE', 'FR'] },
  { code: 'dach', countries: ['AT', 'CH', 'DE'] },
];

function keys(places: readonly Place[]): string[] {
  return places.map((place) => placeKey(place));
}

describe('ancestors', () => {
  test('a city in DE goes up through its country and regions, narrowest first', () => {
    const munich: Place = { kind: 'city', id: 2_867_714, countryCode: 'DE' };
    assert.deepEqual(keys(ancestors(munich, REGIONS)), [
      'country:DE',
      'region:dach',
      'region:eu',
      'region:europe',
      'anywhere',
    ]);
  });

  test('a country outside every region has only anywhere', () => {
    assert.deepEqual(keys(ancestors({ kind: 'country', code: 'BR' }, REGIONS)), ['anywhere']);
  });

  test('a region is covered by regions with all its countries', () => {
    assert.deepEqual(keys(ancestors({ kind: 'region', code: 'eu' }, REGIONS)), [
      'region:europe',
      'anywhere',
    ]);
  });

  test('an unknown region is covered only by anywhere', () => {
    assert.deepEqual(keys(ancestors({ kind: 'region', code: 'mars' }, REGIONS)), ['anywhere']);
  });

  test('anywhere has no ancestors', () => {
    assert.deepEqual(ancestors({ kind: 'anywhere' }, REGIONS), []);
  });
});

describe('covers', () => {
  const dach: Place = { kind: 'region', code: 'dach' };

  test('europe covers dach, eu does not: CH is not in the EU', () => {
    assert.ok(covers({ kind: 'region', code: 'europe' }, dach, REGIONS));
    assert.ok(!covers({ kind: 'region', code: 'eu' }, dach, REGIONS));
  });

  test('a place covers itself', () => {
    assert.ok(covers(dach, dach, REGIONS));
    assert.ok(covers({ kind: 'city', id: 1 }, { kind: 'city', id: 1, countryCode: 'DE' }, REGIONS));
  });

  test('a country covers its city, not a city elsewhere', () => {
    const country = { kind: 'country', code: 'DE' } as const;
    assert.ok(covers(country, { kind: 'city', id: 1, countryCode: 'DE' }, REGIONS));
    assert.ok(!covers(country, { kind: 'city', id: 2, countryCode: 'FR' }, REGIONS));
  });
});

describe('regionsOf', () => {
  test('regions of a country, narrowest first', () => {
    assert.deepEqual(regionsOf('CH', REGIONS), ['dach', 'europe']);
  });
});
