import assert from 'node:assert/strict';
import { test } from 'node:test';

import { VERDICTS } from '../src/index.ts';
import { loadCases } from './cases.ts';

// Набор подобран по причинам: ошибка на редком вердикте видна, только если его случаев не меньше четырёх.
test('the set has 20 valid cases and at least 4 for every verdict', () => {
  const cases = loadCases();

  assert.equal(cases.length, 20);
  for (const verdict of VERDICTS) {
    const count = cases.filter((evalCase) => evalCase.expected === verdict).length;
    assert.ok(count >= 4, `${verdict}: ${String(count)} cases`);
  }
});
