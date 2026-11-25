import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, test } from 'node:test';

import { nextRunAt, scheduleAfterDrain, spreadDelay } from './schedule.ts';

const NOW = new Date('2026-11-20T12:00:00.000Z');
const HOUR_MS = 60 * 60 * 1000;
const after = (hours: number): Date => new Date(NOW.getTime() + hours * HOUR_MS);

describe('nextRunAt', () => {
  test('doubles the interval with every failure in a row, up to a day', () => {
    assert.deepEqual(nextRunAt(NOW, 60, 1), after(2));
    assert.deepEqual(nextRunAt(NOW, 60, 3), after(8));
    assert.deepEqual(nextRunAt(NOW, 60, 10), after(24));
    assert.deepEqual(nextRunAt(NOW, 1440, 1), after(24));
  });
});

describe('scheduleAfterDrain', () => {
  test('done resets the failures and records the success', () => {
    const schedule = scheduleAfterDrain(
      { intervalMinutes: 60, consecutiveFailures: 3 },
      { status: 'done' },
      NOW,
    );

    assert.deepEqual(schedule, {
      lastFetchedAt: NOW,
      lastSuccessAt: NOW,
      consecutiveFailures: 0,
      lastError: null,
    });
  });

  test('more records only the fetch time', () => {
    const schedule = scheduleAfterDrain(
      { intervalMinutes: 60, consecutiveFailures: 2 },
      { status: 'more' },
      NOW,
    );

    assert.deepEqual(schedule, { lastFetchedAt: NOW });
  });

  test('failed counts the failure, keeps its text and pauses the source', () => {
    const schedule = scheduleAfterDrain(
      { intervalMinutes: 60, consecutiveFailures: 2 },
      { status: 'failed', error: new Error('HTTP 503') },
      NOW,
    );

    assert.deepEqual(schedule, {
      lastFetchedAt: NOW,
      consecutiveFailures: 3,
      lastError: 'HTTP 503',
      nextRunAt: after(8),
    });
  });

  test('failed of a daily source pauses it for a day from the first failure', () => {
    const schedule = scheduleAfterDrain(
      { intervalMinutes: 1440, consecutiveFailures: 0 },
      {
        status: 'failed',
        error: new Error('Telegram request failed', { cause: new Error('HTTP 429') }),
      },
      NOW,
    );

    assert.equal(schedule.consecutiveFailures, 1);
    assert.deepEqual(schedule.nextRunAt, after(24));
    assert.equal(schedule.lastError, 'Telegram request failed: HTTP 429');
  });
});

describe('spreadDelay', () => {
  test('gives one source the same delay every time, a whole second within ten minutes', () => {
    const id = randomUUID();
    assert.equal(spreadDelay(id), spreadDelay(id));

    const delays = Array.from({ length: 1000 }, () => spreadDelay(randomUUID()));
    assert.ok(delays.every((delay) => Number.isInteger(delay) && delay >= 0 && delay < 600));
    // Задержки разные: источники тика не идут к сервисам разом.
    assert.ok(new Set(delays).size > 300);
  });
});
