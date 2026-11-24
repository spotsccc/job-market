import assert from 'node:assert/strict';
import { test } from 'node:test';

import { score } from './score.ts';

test('counts matches by expected verdict, keeps errors and mismatches apart', () => {
  const result = score([
    { id: 'a', expected: 'vacancy', actual: 'vacancy' },
    { id: 'b', expected: 'no_specific_role', actual: 'vacancy' },
    { id: 'c', expected: 'job_seeker', actual: new Error('Classification failed') },
  ]);

  assert.equal(result.cases, 3);
  assert.equal(result.errors, 1);
  assert.equal(result.matched, 1);
  assert.deepEqual(result.byVerdict, {
    vacancy: { matched: 1, total: 1 },
    no_specific_role: { matched: 0, total: 1 },
    job_seeker: { matched: 0, total: 1 },
  });
  assert.deepEqual(result.confusion, [
    { expected: 'no_specific_role', actual: 'vacancy', ids: ['b'] },
  ]);
});
