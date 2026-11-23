import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { CountryRemovedError, GeonamesParseError } from '../errors/index.ts';
import { readGeonames } from './geonames.ts';
import type { GeonamesData } from './types.ts';

/** Фикстуры — строки настоящих дампов GeoNames от 23 ноября 2026. */
function fixture(file: string): string[] {
  return readFileSync(join(import.meta.dirname, 'fixtures', file), 'utf8').split('\n');
}

// oxlint-disable-next-line typescript/require-await -- асинхронный источник строк, как поток в рабочем коде
async function* iterate(lines: readonly string[]): AsyncGenerator<string> {
  yield* lines;
}

type Overrides = {
  countryInfo?: string[];
  cities?: string[];
  previousCodes?: string[];
};

async function read(overrides: Overrides = {}) {
  return readGeonames(
    {
      countryInfo: iterate(overrides.countryInfo ?? fixture('countryInfo.txt')),
      cities: iterate(overrides.cities ?? fixture('cities15000.txt')),
      alternateNames: iterate(fixture('alternateNamesV2.txt')),
    },
    overrides.previousCodes ?? [],
  );
}

async function data(): Promise<GeonamesData> {
  const result = await read();
  assert.ok(!(result instanceof Error), result instanceof Error ? result.message : '');
  return result;
}

function aliasesOf(result: GeonamesData, cityId: number): string[] {
  return result.aliases.filter((alias) => alias.cityId === cityId).map((alias) => alias.alias);
}

const BERLIN = 2_950_159;
const MUNICH = 2_867_714;
const SAINT_PETERSBURG = 498_817;
const HAMILTON = 3_573_197;
const ZEHLENDORF = 2_805_059;
const PITTWATER = 6_949_382;

describe('readGeonames', () => {
  test('drops city parts and historical places but keeps a small capital', async () => {
    const result = await data();
    const ids = result.cities.map((city) => city.id);
    // Zehlendorf — PPLX (район Берлина), Pittwater — PPLH; Hamilton — столица Бермуд, 902 жителя.
    assert.deepEqual(
      ids.toSorted((a, b) => a - b),
      [SAINT_PETERSBURG, MUNICH, BERLIN, HAMILTON].toSorted((a, b) => a - b),
    );
    assert.ok(!ids.includes(ZEHLENDORF));
    assert.ok(!ids.includes(PITTWATER));
    assert.equal(result.droppedCities, 2);
  });

  test('drops codes removed from ISO 3166-1 but keeps Kosovo', async () => {
    const result = await data();
    assert.deepEqual(
      result.countries.map((country) => country.code),
      ['AU', 'BM', 'DE', 'XK', 'RU'],
    );
    const kosovo = result.countries.find((country) => country.code === 'XK');
    assert.ok(kosovo !== undefined);
    assert.equal(kosovo.nameRu, 'Косово');
    assert.equal(kosovo.nameEn, 'Kosovo');
  });

  test('skips historical names and keeps colloquial ones', async () => {
    const aliases = aliasesOf(await data(), SAINT_PETERSBURG);
    assert.ok(!aliases.includes('Ленинград'));
    assert.ok(!aliases.includes('Петроград'));
    assert.ok(!aliases.includes('Leningrad'));
    assert.ok(aliases.includes('Питер'));
    assert.ok(aliases.includes('СПб'));
  });

  test('takes names on ru, en and the first language of the country only', async () => {
    const result = await data();
    assert.ok(!aliasesOf(result, SAINT_PETERSBURG).includes('Saint-Pétersbourg'));
    // de — первый язык Германии, поэтому немецкое написание Мюнхена остаётся.
    assert.ok(aliasesOf(result, MUNICH).includes('München'));
    assert.ok(aliasesOf(result, MUNICH).includes('Muenchen'));
  });

  test('keeps one alias per normalized name', async () => {
    const aliases = aliasesOf(await data(), SAINT_PETERSBURG);
    // «St. Petersburg» и «St Petersburg» нормализуются одинаково.
    assert.ok(aliases.includes('St. Petersburg'));
    assert.ok(!aliases.includes('St Petersburg'));
  });

  test('country aliases include alpha-2 and alpha-3 codes', async () => {
    const result = await data();
    const germany = result.aliases.filter((alias) => alias.countryCode === 'DE');
    assert.deepEqual(
      germany.slice(0, 3).map((alias) => [alias.normalized, alias.lang]),
      [
        ['germany', null],
        ['de', null],
        ['deu', null],
      ],
    );
    assert.ok(germany.some((alias) => alias.alias === 'Германия' && alias.lang === 'ru'));
  });

  test('picks the preferred display name and never a colloquial one', async () => {
    const result = await data();
    const spb = result.cities.find((city) => city.id === SAINT_PETERSBURG);
    assert.ok(spb !== undefined);
    assert.equal(spb.nameRu, 'Санкт-Петербург');
    // Первое en-название — разговорное «Peterburg»; обычное «Saint Petersburg» совпадает с name.
    assert.equal(spb.nameEn, null);
    const munich = result.cities.find((city) => city.id === MUNICH);
    assert.ok(munich !== undefined);
    assert.equal(munich.nameRu, 'Мюнхен');
    const hamilton = result.cities.find((city) => city.id === HAMILTON);
    assert.ok(hamilton !== undefined);
    assert.equal(hamilton.nameRu, null);
  });

  test('a row with a missing column is a parse error with its line', async () => {
    const cities = fixture('cities15000.txt');
    cities[2] = (cities[2] ?? '').split('\t').slice(0, 18).join('\t');
    const result = await read({ cities });
    assert.ok(result instanceof GeonamesParseError);
    assert.equal(result.file, 'cities15000.txt');
    assert.equal(result.line, 3);
  });

  test('a country from the previous countries.ts missing in countryInfo stops the build', async () => {
    const countryInfo = fixture('countryInfo.txt').filter((line) => !line.startsWith('DE\t'));
    const result = await read({ countryInfo, previousCodes: ['BM', 'DE'] });
    assert.ok(result instanceof CountryRemovedError);
    assert.equal(result.codes, 'DE');
  });
});
