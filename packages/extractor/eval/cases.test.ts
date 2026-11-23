import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadCases, loadOccupations } from './cases.ts';

// Разметка ссылается на узлы дерева и ключи справочника: правка дерева без правки разметки (П19) падает здесь.
test('every case matches the format, the occupation tree and place keys', () => {
  const cases = loadCases(loadOccupations());

  assert.ok(cases.length > 0);
});
