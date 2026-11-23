import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { InvalidPlaceKeyError } from './errors/index.ts';
import { isAnywhere, parsePlaceKey, placeKey } from './place.ts';
import type { PlaceRef } from './place.ts';

describe('placeKey and parsePlaceKey', () => {
  const places: readonly PlaceRef[] = [
    { kind: 'city', id: 2_950_159 },
    { kind: 'country', code: 'DE' },
    { kind: 'region', code: 'north_america' },
    { kind: 'anywhere' },
  ];

  for (const place of places) {
    test(`${place.kind} survives a round trip`, () => {
      assert.deepEqual(parsePlaceKey(placeKey(place)), place);
    });
  }

  test('a city place keeps only its id in the key', () => {
    assert.equal(placeKey({ kind: 'city', id: 498_817 }), 'city:498817');
  });

  for (const key of [
    'city:abc',
    'city:',
    'country:XX',
    'country:de',
    'region:EU',
    'planet:1',
    '',
  ]) {
    test(`«${key}» is an invalid key`, () => {
      assert.ok(parsePlaceKey(key) instanceof InvalidPlaceKeyError);
    });
  }
});

describe('isAnywhere', () => {
  test('worldwide phrases in any case and spacing', () => {
    assert.ok(isAnywhere('Worldwide'));
    assert.ok(isAnywhere('  Весь мир '));
    assert.ok(isAnywhere('Откуда угодно!'));
  });

  test('a place name is not anywhere', () => {
    assert.ok(!isAnywhere('Europe'));
  });
});
