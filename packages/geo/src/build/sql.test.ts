import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { STATEMENT_BREAKPOINT, buildGeonamesSql, literal } from './sql.ts';
import type { CityRecord, GeonamesData } from './types.ts';

function city(id: number, overrides: Partial<CityRecord> = {}): CityRecord {
  return {
    id,
    countryCode: 'TD',
    admin1Code: null,
    name: `City ${String(id)}`,
    nameEn: null,
    nameRu: null,
    lat: 12.10672,
    lng: 15.0444,
    population: 15_000,
    timezone: 'Africa/Ndjamena',
    ...overrides,
  };
}

function data(cities: readonly CityRecord[]): GeonamesData {
  return {
    countries: [
      {
        code: 'TD',
        iso3: 'TCD',
        geonameId: 2_434_508,
        continent: 'AF',
        nameEn: 'Chad',
        nameRu: 'Чад',
        population: 17_723_315,
      },
    ],
    cities,
    aliases: [],
    droppedCities: 0,
  };
}

function statements(sql: string): string[] {
  return sql.split(STATEMENT_BREAKPOINT).map((statement) => statement.trim());
}

describe('buildGeonamesSql', () => {
  test('doubles quotes inside string literals', () => {
    assert.equal(literal("N'Djamena"), "'N''Djamena'");
    assert.equal(literal(null), 'NULL');
    assert.equal(literal(-64.78303), '-64.78303');
    const sql = buildGeonamesSql(data([city(2_427_123, { name: "N'Djamena" })]));
    assert.ok(sql.includes("'N''Djamena'"));
  });

  test('splits rows into inserts of 1 000', () => {
    const cities = Array.from({ length: 2500 }, (_, index) => city(index + 1));
    const inserts = statements(buildGeonamesSql(data(cities))).filter((statement) =>
      statement.startsWith('INSERT INTO geo_cities_next'),
    );
    assert.equal(inserts.length, 3);
    assert.equal(inserts[2]?.split('\n').length, 501);
  });

  test('every statement is separated by a breakpoint and ends with a semicolon', () => {
    const parts = statements(buildGeonamesSql(data([city(1)])));
    assert.ok(parts.length > 1);
    for (const part of parts) assert.ok(part.endsWith(';'), part);
  });

  test('drops every temporary table it creates', () => {
    const parts = statements(buildGeonamesSql(data([city(1)])));
    const created = parts.flatMap((part) => /^CREATE TEMP TABLE (\w+)/u.exec(part)?.[1] ?? []);
    const dropped = parts.flatMap((part) => /^DROP TABLE (\w+)/u.exec(part)?.[1] ?? []);
    assert.deepEqual(created, ['geo_countries_next', 'geo_cities_next']);
    assert.deepEqual(dropped, created);
    assert.ok(parts.at(-1)?.startsWith('DROP TABLE') === true);
  });
});
