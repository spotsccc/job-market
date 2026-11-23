import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createTaggedError } from '@spotsccc/error-as-value';

import { createLogger, readLoggerOptions } from './logger.ts';
import type { LoggerOptions } from './logger.ts';

const HttpStatusError = createTaggedError({
  name: 'HttpStatusError',
  message: 'Request $method $path failed with status $status',
});

const ApifyRequestError = createTaggedError({
  name: 'ApifyRequestError',
  message: 'Apify call $op failed',
});

type Entry = Readonly<Record<string, unknown>>;

function isEntry(value: unknown): value is Entry {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asEntry(value: unknown): Entry {
  assert.ok(isEntry(value), `Expected an object, got ${String(value)}`);
  return value;
}

function capture(options: Omit<LoggerOptions, 'write'> = {}) {
  const entries: Entry[] = [];
  const logger = createLogger({
    ...options,
    write: (line) => {
      entries.push(asEntry(JSON.parse(line)));
    },
  });
  const at = (index: number): Entry => asEntry(entries[index]);
  return { logger, entries, at };
}

function chain(): InstanceType<typeof ApifyRequestError> {
  return new ApifyRequestError({
    op: 'runActor',
    cause: new HttpStatusError({
      method: 'POST',
      path: '/acts',
      status: 429,
      cause: new TypeError('socket hang up'),
    }),
  });
}

describe('createLogger (json)', () => {
  test('writes message, level label and fields', () => {
    const { logger, entries, at } = capture();
    logger.info('Actor run started', { runId: 'r1' });

    assert.equal(entries.length, 1);
    assert.equal(at(0)['msg'], 'Actor run started');
    assert.equal(at(0)['level'], 'info');
    assert.equal(at(0)['runId'], 'r1');
    assert.equal(typeof at(0)['time'], 'string');
  });

  test('writes a message without fields', () => {
    const { logger, at } = capture();
    logger.error('boom');
    assert.equal(at(0)['msg'], 'boom');
    assert.equal(at(0)['level'], 'error');
  });

  test('warning is an alias of warn', () => {
    const { logger, entries } = capture();
    logger.warn('a');
    logger.warning('b');
    assert.deepEqual(
      entries.map((entry) => entry['level']),
      ['warn', 'warn'],
    );
  });

  test('adds the fingerprint of a tagged error', () => {
    const { logger, at } = capture();
    logger.error('LinkedIn post search failed', { err: chain() });

    const err = asEntry(at(0)['err']);
    assert.deepEqual(err['fingerprint'], ['ApifyRequestError', 'Apify call $op failed']);
  });

  test('passes a non-Error err through as is', () => {
    const { logger, at } = capture();
    logger.error('odd failure', { err: { code: 'E42' } });
    assert.deepEqual(at(0)['err'], { code: 'E42' });
  });
});

describe('readLoggerOptions', () => {
  test('defaults to info and pretty outside production', () => {
    assert.deepEqual(readLoggerOptions({}), { level: 'info', format: 'pretty' });
  });

  test('defaults to json in production', () => {
    assert.deepEqual(readLoggerOptions({ NODE_ENV: 'production' }), {
      level: 'info',
      format: 'json',
    });
  });

  test('reads LOG_LEVEL and LOG_FORMAT', () => {
    assert.deepEqual(readLoggerOptions({ LOG_LEVEL: 'debug', LOG_FORMAT: 'json' }), {
      level: 'debug',
      format: 'json',
    });
  });

  test('ignores unknown values', () => {
    assert.deepEqual(
      readLoggerOptions({ LOG_LEVEL: 'verbose', LOG_FORMAT: 'xml', NODE_ENV: 'production' }),
      { level: 'info', format: 'json' },
    );
  });
});
