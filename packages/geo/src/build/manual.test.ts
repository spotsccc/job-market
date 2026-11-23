import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ManualDataError } from '../errors/index.ts';
import { buildManualSql } from './manual.ts';
import type { ManualAliasInput, ManualInput, RegionInput } from './manual.ts';

function region(overrides: Partial<RegionInput> = {}): RegionInput {
  return {
    code: 'cis',
    nameRu: 'СНГ',
    nameEn: 'CIS',
    description: 'Бывшие республики СССР.',
    countries: ['KZ', 'RU'],
    aliases: [],
    ...overrides,
  };
}

function input(
  regions: readonly RegionInput[],
  aliases: readonly ManualAliasInput[] = [],
): ManualInput {
  return { regions, aliases, countryCodes: ['AT', 'CH', 'DE', 'GB', 'KZ', 'RU'] };
}

describe('buildManualSql', () => {
  test('an unknown country code in a region is an error', () => {
    const result = buildManualSql(input([region({ countries: ['KZZ', 'RU'] })]));
    assert.ok(result instanceof ManualDataError);
    assert.equal(result.entry, 'region cis');
    assert.match(String(result.problem), /KZZ/u);
  });

  test('a region without countries is an error', () => {
    const result = buildManualSql(input([region({ countries: [] })]));
    assert.ok(result instanceof ManualDataError);
    assert.equal(result.problem, 'no countries');
  });

  test('a repeated region code is an error', () => {
    const result = buildManualSql(input([region({ code: 'eu' }), region({ code: 'eu' })]));
    assert.ok(result instanceof ManualDataError);
    assert.equal(result.entry, 'region eu');
    assert.equal(result.problem, 'duplicate code');
  });

  test('an unknown country code in a manual alias is an error', () => {
    const result = buildManualSql(
      input([region()], [{ alias: 'Англия', lang: 'ru', countryCode: 'EN' }]),
    );
    assert.ok(result instanceof ManualDataError);
    assert.equal(result.entry, 'alias Англия');
  });

  test('region names that normalize the same become one alias', () => {
    const dach = region({
      code: 'dach',
      nameRu: 'DACH',
      nameEn: 'DACH',
      countries: ['AT', 'CH', 'DE'],
      aliases: ['D-A-CH'],
    });
    const result = buildManualSql(input([dach], [{ alias: 'SPb', lang: 'abbr', cityId: 498_817 }]));
    assert.ok(!(result instanceof Error));
    // dach и d a ch у региона, spb у города.
    assert.equal(result.aliases, 3);
    assert.ok(result.sql.includes("('dach', 'dach', NULL, 'manual', NULL, 'dach', NULL)"));
    assert.ok(result.sql.includes("('d a ch', 'D-A-CH', NULL, 'manual', NULL, 'dach', NULL)"));
    assert.ok(result.sql.includes("('spb', 'SPb', 'abbr', 'manual', NULL, NULL, 498817)"));
  });
});
