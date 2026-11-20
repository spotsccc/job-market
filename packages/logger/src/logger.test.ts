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

  test('drops records below the configured level', () => {
    const { logger, entries } = capture({ level: 'warn' });
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    assert.deepEqual(
      entries.map((entry) => entry['msg']),
      ['w'],
    );
  });

  test('with() adds context to every record and nests', () => {
    const { logger, at } = capture();
    const child = logger.with({ module: 'channel-linkedin' }).with({ runId: 'r1' });
    child.info('done', { posts: 3 });

    assert.equal(at(0)['module'], 'channel-linkedin');
    assert.equal(at(0)['runId'], 'r1');
    assert.equal(at(0)['posts'], 3);
  });

  test('context adds fields read at write time to every record', () => {
    let traceId = 't1';
    const { logger, at } = capture({ context: () => ({ traceId }) });
    const child = logger.with({ module: 'web' });
    child.info('first');
    traceId = 't2';
    child.info('second');

    assert.equal(at(0)['traceId'], 't1');
    assert.equal(at(0)['module'], 'web');
    assert.equal(at(1)['traceId'], 't2');
  });

  test('serializes the whole tagged cause chain under err', () => {
    const { logger, at } = capture();
    logger.error('LinkedIn post search failed', { err: chain() });

    const err = asEntry(at(0)['err']);
    assert.equal(err['_tag'], 'ApifyRequestError');
    assert.equal(err['message'], 'Apify call runActor failed');
    assert.equal(err['messageTemplate'], 'Apify call $op failed');
    assert.equal(err['op'], 'runActor');
    assert.deepEqual(err['fingerprint'], ['ApifyRequestError', 'Apify call $op failed']);
    assert.equal(typeof err['stack'], 'string');

    const cause = asEntry(err['cause']);
    assert.equal(cause['_tag'], 'HttpStatusError');
    assert.equal(cause['messageTemplate'], 'Request $method $path failed with status $status');
    assert.equal(cause['method'], 'POST');
    assert.equal(cause['path'], '/acts');
    assert.equal(cause['status'], 429);

    const root = asEntry(cause['cause']);
    assert.equal(root['type'], 'TypeError');
    assert.equal(root['message'], 'socket hang up');
  });

  test('serializes errors in with() context', () => {
    const { logger, at } = capture();
    logger
      .with({ err: new HttpStatusError({ method: 'GET', path: '/x', status: 500 }) })
      .warn('retrying');

    const err = asEntry(at(0)['err']);
    assert.equal(err['_tag'], 'HttpStatusError');
    assert.equal(err['status'], 500);
  });

  test('keeps tagged errors inside AggregateError', () => {
    const { logger, at } = capture();
    const aggregate = new AggregateError(
      [new HttpStatusError({ method: 'GET', path: '/x', status: 500 })],
      'all failed',
    );
    logger.error('batch failed', { err: aggregate });

    const err = asEntry(at(0)['err']);
    const errors = err['aggregateErrors'];
    assert.ok(Array.isArray(errors));
    const first = asEntry(errors[0]);
    assert.equal(first['_tag'], 'HttpStatusError');
    assert.equal(first['status'], 500);
  });

  test('passes a non-Error err through as is', () => {
    const { logger, at } = capture();
    logger.error('odd failure', { err: { code: 'E42' } });
    assert.deepEqual(at(0)['err'], { code: 'E42' });
  });
});

describe('createLogger (pretty)', () => {
  test('writes readable text with the error chain', () => {
    const chunks: string[] = [];
    const logger = createLogger({
      format: 'pretty',
      write: (chunk) => {
        chunks.push(chunk);
      },
    });
    logger.error('LinkedIn post search failed', { err: chain() });

    const text = chunks.join('');
    assert.match(text, /LinkedIn post search failed/u);
    assert.match(text, /ApifyRequestError/u);
    assert.match(text, /HttpStatusError/u);
    assert.match(text, /429/u);
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
