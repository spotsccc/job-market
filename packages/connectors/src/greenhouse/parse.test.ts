import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { DEPTH_DAYS } from '../contract.ts';
import type { ParseResult, Processor } from '../contract.ts';
import type { GreenhouseJob } from './channel.ts';
import { fakeGreenhouse, greenhouseJob } from './fake-greenhouse.test-utils.ts';
import type { FakeGreenhouse } from './fake-greenhouse.test-utils.ts';
import { greenhouse } from './index.ts';
import type { GreenhouseConfig, GreenhouseCursor } from './parse.ts';

const NOW = new Date('2026-11-25T12:00:00.000Z');
const SINCE = new Date(NOW.getTime() - DEPTH_DAYS * 24 * 60 * 60 * 1000);

const process: Processor = () => Promise.resolve(new Error('not used'));

const job = (
  id: number,
  firstPublished: string | null,
  overrides: Partial<GreenhouseJob> = {},
): GreenhouseJob =>
  greenhouseJob({
    id,
    absoluteUrl: `https://job-boards.greenhouse.io/wrike/jobs/${String(id)}`,
    firstPublished,
    ...overrides,
  });

const board = (jobs: readonly GreenhouseJob[]): FakeGreenhouse =>
  fakeGreenhouse(new Map([['wrike', jobs]]));

async function parse(
  channel: FakeGreenhouse,
  cursor: GreenhouseCursor | null,
  options: { readonly key?: string; readonly config?: GreenhouseConfig } = {},
): Promise<Error | ParseResult<GreenhouseCursor>> {
  return greenhouse({ greenhouse: channel, process }).parse({
    config: options.config ?? {},
    cursor,
    key: options.key ?? 'wrike',
    since: SINCE,
    deadline: Date.now() + 60_000,
  });
}

async function parsed(
  channel: FakeGreenhouse,
  cursor: GreenhouseCursor | null,
  options: { readonly key?: string; readonly config?: GreenhouseConfig } = {},
): Promise<ParseResult<GreenhouseCursor>> {
  const result = await parse(channel, cursor, options);
  assert.ok(!(result instanceof Error), result instanceof Error ? result.message : '');
  return result;
}

const ids = (result: ParseResult<GreenhouseCursor>): string[] =>
  result.publications.map((publication) => publication.externalId);

describe('greenhouse parse', () => {
  test('without a cursor takes every job, older than the depth too', async () => {
    const result = await parsed(
      board([
        job(1, '2022-11-03T10:00:00-04:00'),
        job(2, '2026-10-20T10:00:00Z'),
        job(3, '2026-11-24T10:00:00Z'),
      ]),
      null,
    );

    assert.deepEqual(ids(result), ['wrike/1', 'wrike/2', 'wrike/3']);
    assert.deepEqual(result.cursor, { publishedAfter: '2026-11-24T10:00:00.000Z' });
    assert.equal(result.more, false);
  });

  test('with a cursor takes only jobs published after it and moves the cursor to them', async () => {
    const result = await parsed(
      board([
        job(1, '2026-11-24T11:59:00Z'),
        job(2, '2026-11-24T12:00:00Z'),
        job(3, '2026-11-25T09:30:00Z'),
      ]),
      { publishedAfter: '2026-11-24T12:00:00.000Z' },
    );

    assert.deepEqual(ids(result), ['wrike/3']);
    assert.deepEqual(result.cursor, { publishedAfter: '2026-11-25T09:30:00.000Z' });
  });

  test('compares moments, not strings, across time zones', async () => {
    const result = await parsed(board([job(1, '2026-11-24T23:30:00-05:00')]), {
      publishedAfter: '2026-11-25T04:00:00.000Z',
    });

    assert.deepEqual(ids(result), ['wrike/1']);
    assert.deepEqual(result.cursor, { publishedAfter: '2026-11-25T04:30:00.000Z' });
  });

  test('without first_published the date is updated_at', async () => {
    const result = await parsed(
      board([job(1, null, { updatedAt: '2026-11-20T08:00:00-05:00' })]),
      null,
    );

    assert.deepEqual(result.publications[0]?.publishedAt, new Date('2026-11-20T13:00:00.000Z'));
    assert.deepEqual(result.cursor, { publishedAfter: '2026-11-20T13:00:00.000Z' });
  });

  test('an empty board keeps the cursor, or gives none on the first poll', async () => {
    const cursor = { publishedAfter: '2026-11-24T12:00:00.000Z' };

    assert.deepEqual(await parsed(board([]), cursor), { publications: [], cursor, more: false });
    assert.deepEqual(await parsed(board([]), null), {
      publications: [],
      cursor: null,
      more: false,
    });
  });

  test('maps a job to a publication with the company as its author', async () => {
    const result = await parsed(board([greenhouseJob()]), null);

    const [publication] = result.publications;
    assert.equal(publication?.externalId, 'wrike/4664056005');
    assert.equal(publication.url, 'https://job-boards.greenhouse.io/wrike/jobs/4664056005');
    assert.deepEqual(publication.author, {
      externalId: 'wrike',
      name: 'Wrike',
      url: 'https://job-boards.greenhouse.io/wrike',
      headline: null,
    });
    assert.deepEqual(publication.payload, {
      title: 'Account Development Manager',
      location: 'Prague',
      departments: ['3210 Expand EMEA'],
      offices: ['Czech Republic'],
      requisitionId: '222',
      updatedAt: '2026-11-04T07:16:11-05:00',
      language: 'en',
    });
  });

  test('a job without a company name has no author', async () => {
    const result = await parsed(board([greenhouseJob({ companyName: null })]), null);

    assert.equal(result.publications[0]?.author, null);
  });

  test('reads the board from config, and from the source key without it', async () => {
    const channel = fakeGreenhouse(
      new Map([
        ['ahrefsjobs', [greenhouseJob()]],
        ['wrike', [greenhouseJob()]],
      ]),
    );

    const fromConfig = await parsed(channel, null, {
      key: 'ahrefs',
      config: { board: 'ahrefsjobs' },
    });
    await parsed(channel, null);

    assert.deepEqual(channel.boards, ['ahrefsjobs', 'wrike']);
    assert.equal(fromConfig.publications[0]?.externalId, 'ahrefsjobs/4664056005');
  });

  test('a channel error is returned as is', async () => {
    const channel = fakeGreenhouse(new Map([['wrike', [greenhouseJob()]]]), { failOnCall: 1 });

    const result = await parse(channel, null);

    assert.ok(result instanceof Error);
    assert.equal(result.message, 'Greenhouse board wrike request failed');
  });
});
