import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { formatPlace } from './format.ts';

describe('formatPlace', () => {
  const munich = { kind: 'city', id: 2_867_714, countryCode: 'DE' } as const;

  test('a city with names in ru and en', () => {
    const names = { name: 'München', nameRu: 'Мюнхен', nameEn: 'Munich' };
    assert.equal(formatPlace(munich, 'ru', names), 'Мюнхен, Германия');
    assert.equal(formatPlace(munich, 'en', names), 'Munich, Germany');
  });

  test('a city without a name in the locale shows its GeoNames name', () => {
    const names = { name: 'Zehlendorf', nameRu: null, nameEn: null };
    assert.equal(formatPlace(munich, 'ru', names), 'Zehlendorf, Германия');
    assert.equal(formatPlace(munich, 'en', names), 'Zehlendorf, Germany');
  });

  test('a city without names shows its country', () => {
    assert.equal(formatPlace(munich, 'ru'), 'Германия');
  });

  test('a region from regions.ts and an unknown region code', () => {
    assert.equal(formatPlace({ kind: 'region', code: 'eu' }, 'ru'), 'Евросоюз');
    assert.equal(formatPlace({ kind: 'region', code: 'eu' }, 'en'), 'European Union');
    assert.equal(formatPlace({ kind: 'region', code: 'mars' }, 'ru'), 'mars');
  });

  test('anywhere', () => {
    assert.equal(formatPlace({ kind: 'anywhere' }, 'ru'), 'Откуда угодно');
    assert.equal(formatPlace({ kind: 'anywhere' }, 'en'), 'Anywhere');
  });
});
