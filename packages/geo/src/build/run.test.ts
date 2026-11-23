import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { GeonamesParseError } from '../errors/index.ts';
import { buildCountriesModule, runBuild } from './run.ts';
import type { BuildDeps } from './run.ts';
import type { GeonamesSources } from './types.ts';

function fixture(file: string): string[] {
  return readFileSync(join(import.meta.dirname, 'fixtures', file), 'utf8').split('\n');
}

// oxlint-disable-next-line typescript/require-await -- асинхронный источник строк, как поток в рабочем коде
async function* iterate(lines: readonly string[]): AsyncGenerator<string> {
  yield* lines;
}

function sources(cities = fixture('cities15000.txt')): GeonamesSources {
  return {
    countryInfo: iterate(fixture('countryInfo.txt')),
    cities: iterate(cities),
    alternateNames: iterate(fixture('alternateNamesV2.txt')),
  };
}

/** Зависимости, которые записывают каждый вызов по порядку. */
function recordingDeps(source: GeonamesSources) {
  const calls: string[] = [];
  const written = new Map<string, string>();
  const deps: BuildDeps = {
    openSources: () => Promise.resolve(source),
    previousCountryCodes: [],
    manual: { regions: [], aliases: [], countryCodes: [] },
    generateMigration: (name) => {
      calls.push(`generate ${name}`);
      return Promise.resolve(`/migrations/0005_${name}.sql`);
    },
    writeFile: (path, content) => {
      calls.push(`write ${path}`);
      written.set(path, content);
      // oxlint-disable-next-line unicorn/no-useless-undefined -- контракт writeFile: undefined — успех
      return Promise.resolve(undefined);
    },
    countriesPath: '/geo/src/generated/countries.ts',
  };
  return { deps, calls, written };
}

describe('runBuild', () => {
  test('a failed read writes nothing and does not call drizzle-kit', async () => {
    const cities = fixture('cities15000.txt').map((line) => line.replace(/\t[^\t]*$/u, ''));
    const { deps, calls } = recordingDeps(sources(cities));
    const result = await runBuild('geonames', deps);
    assert.ok(result instanceof GeonamesParseError);
    assert.deepEqual(calls, []);
  });

  test('drizzle-kit runs after the SQL is built, then both files are written', async () => {
    const { deps, calls, written } = recordingDeps(sources());
    const result = await runBuild('geonames', deps);
    assert.ok(!(result instanceof Error), result instanceof Error ? result.message : '');
    assert.deepEqual(calls, [
      'generate geo_geonames',
      'write /migrations/0005_geo_geonames.sql',
      'write /geo/src/generated/countries.ts',
    ]);
    assert.ok(
      written.get('/migrations/0005_geo_geonames.sql')?.includes('MERGE INTO geo_cities') === true,
    );
    assert.deepEqual(result.files, ['/geo/src/generated/countries.ts']);
    assert.equal(result.report[0], 'Стран: 5.');
  });

  test('countries.ts lists the codes of the migration, sorted', () => {
    const module = buildCountriesModule(['XK', 'AU', 'DE']);
    assert.ok(module.includes("  'AU',\n  'DE',\n  'XK',\n] as const;"));
  });
});
