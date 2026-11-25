import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { mineJobKey, stateAfterMineError } from './mine-attempts.ts';

const NOW = new Date('2026-11-20T12:00:00.000Z');

describe('stateAfterMineError', () => {
  test('returns the publication to pending and doubles the pause before the last attempt', () => {
    const error = new Error('HTTP 429');

    assert.deepEqual(stateAfterMineError(1, error, NOW), {
      state: { status: 'pending', lastError: 'HTTP 429' },
      retryDelaySeconds: 300,
    });
    assert.equal(stateAfterMineError(2, error, NOW).retryDelaySeconds, 600);
  });

  test('fails the publication without a retry from the third attempt on', () => {
    const error = new Error('HTTP 429');
    const failed = { state: { status: 'failed', lastError: 'HTTP 429', processedAt: NOW } };

    assert.deepEqual(stateAfterMineError(3, error, NOW), failed);
    assert.deepEqual(stateAfterMineError(5, error, NOW), failed);
  });

  test('writes the error with its cause', () => {
    const error = new Error('Model call failed', { cause: new Error('socket hang up') });

    assert.equal(
      stateAfterMineError(1, error, NOW).state.lastError,
      'Model call failed: socket hang up',
    );
  });
});

describe('mineJobKey', () => {
  test('keys the job by the publication and the attempts already made', () => {
    assert.equal(mineJobKey('p', 0), 'p:0');
    assert.equal(mineJobKey('p', 2), 'p:2');
  });
});
