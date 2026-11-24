import assert from 'node:assert/strict';
import { test } from 'node:test';

import { score } from './score.ts';

test('counts matches by case group, keeps errors and mismatches apart', () => {
  const result = score([
    { id: 'a', group: 'vacancy', expected: 'vacancy', actual: 'vacancy' },
    { id: 'b', group: 'no_specific_role', expected: 'not_vacancy', actual: 'vacancy' },
    {
      id: 'c',
      group: 'job_seeker',
      expected: 'not_vacancy',
      actual: new Error('Classification failed'),
    },
  ]);

  assert.equal(result.cases, 3);
  assert.equal(result.errors, 1);
  assert.equal(result.matched, 1);
  assert.deepEqual(result.byGroup, {
    vacancy: { matched: 1, total: 1 },
    no_specific_role: { matched: 0, total: 1 },
    job_seeker: { matched: 0, total: 1 },
  });
  assert.deepEqual(result.confusion, [
    { group: 'no_specific_role', actual: 'vacancy', ids: ['b'] },
  ]);
});
