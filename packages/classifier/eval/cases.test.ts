import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CASE_GROUPS, loadCases } from './cases.ts';

// Набор подобран по видам постов: ошибка на редком виде видна, только если его случаев не меньше четырёх.
test('the set has 20 valid cases and at least 4 of every group', () => {
  const cases = loadCases();

  assert.equal(cases.length, 20);
  for (const group of CASE_GROUPS) {
    const count = cases.filter((evalCase) => evalCase.group === group).length;
    assert.ok(count >= 4, `${group}: ${String(count)} cases`);
  }
});
