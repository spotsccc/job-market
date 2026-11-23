import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

import { ActorOutputError, ActorRunError } from '@job-market/apify';

import { startFakeApify } from '../testing/fake-apify.ts';
import type { FakeApify } from '../testing/fake-apify.ts';
import { fixtureItem, loadFixture } from '../testing/fixtures.ts';
import { createLinkedinJobReader, LINKEDIN_JOB_ACTOR_ID, parseJobUrl } from './linkedin-job.ts';

let fake: FakeApify;

before(async () => {
  fake = await startFakeApify();
});

after(async () => {
  await fake.close();
});

beforeEach(() => {
  fake.reset();
});

function withId(id: number, description = 'Описание'): Record<string, unknown> {
  const item = fixtureItem('job-detail');
  const jobInfo: unknown = item['job_info'];
  assert.ok(typeof jobInfo === 'object' && jobInfo !== null);
  return { ...item, job_info: { ...jobInfo, job_posting_id: id, description } };
}

describe('parseJobUrl', () => {
  const cases: [string, string | null][] = [
    ['https://www.linkedin.com/jobs/view/4479627327/', '4479627327'],
    ['https://www.linkedin.com/jobs/view/qa-engineering-lead-ai-at-meta-4486617493', '4486617493'],
    [
      'https://uk.linkedin.com/jobs/view/executive-researcher-doordash-international-at-deliveroo-4486793014',
      '4486793014',
    ],
    [
      'https://www.linkedin.com/jobs/view/4489080000?original_referer=https%3A%2F%2Fwww.linkedin.com%2F',
      '4489080000',
    ],
    ['https://de.linkedin.com/jobs/view/4479627327', '4479627327'],
    ['https://www.linkedin.com/in/jane-doe', null],
    ['https://www.linkedin.com/company/acme', null],
    ['https://example.com/jobs/view/1', null],
    ['https://notlinkedin.com/jobs/view/1', null],
  ];
  for (const [url, id] of cases) {
    test(`${url} → ${String(id)}`, () => {
      assert.equal(parseJobUrl(url), id);
    });
  }
});

describe('createLinkedinJobReader', () => {
  test('reads jobs with one actor run and builds the section body', async () => {
    fake.scenario.items = loadFixture('job-detail');

    const result = await createLinkedinJobReader(fake.apify).fetch(['4478302617']);

    assert.deepEqual(fake.runs, [
      { actorId: LINKEDIN_JOB_ACTOR_ID, input: { job_id: ['4478302617'] } },
    ]);
    assert.ok(!(result instanceof Error));
    const body = result.get('4478302617');
    assert.ok(body !== undefined);
    const [heading, ...description] = body.split('\n');
    assert.equal(heading, 'Writer, Content Marketing · Stripe · New York, NY');
    const [item] = loadFixture('job-detail');
    assert.ok(typeof item === 'object' && item !== null && 'job_info' in item);
    const jobInfo: unknown = item.job_info;
    assert.ok(typeof jobInfo === 'object' && jobInfo !== null && 'description' in jobInfo);
    assert.equal(description.join('\n'), String(jobInfo.description).trim());
  });

  test('reads a closed job like any other', async () => {
    fake.scenario.items = loadFixture('job-detail-closed');

    const result = await createLinkedinJobReader(fake.apify).fetch(['4476845711']);

    assert.ok(!(result instanceof Error));
    assert.match(
      result.get('4476845711') ?? '',
      /^Video Editor · Republic Affairs · Washington, DC\n/u,
    );
  });

  test('matches items by id, not by order, and skips extra items and empty descriptions', async () => {
    fake.scenario.items = [withId(3), withId(1), withId(2, '  '), withId(99)];

    const result = await createLinkedinJobReader(fake.apify).fetch(['1', '2', '3', '4']);

    assert.ok(!(result instanceof Error));
    assert.deepEqual([...result.keys()].toSorted(), ['1', '3']);
  });

  test('returns ActorOutputError for an item of unexpected shape', async () => {
    fake.scenario.items = [withId(1), { job_info: { job_posting_id: '1' } }];

    const result = await createLinkedinJobReader(fake.apify).fetch(['1']);

    assert.ok(result instanceof ActorOutputError);
    assert.match(result.message, /Item 1 of run run-1/u);
  });

  test('returns ActorRunError when the run failed', async () => {
    fake.scenario.runStatus = 'FAILED';

    const result = await createLinkedinJobReader(fake.apify).fetch(['1']);

    assert.ok(result instanceof ActorRunError);
  });

  test('throws RangeError for more than 100 ids before running the actor', async () => {
    const ids = Array.from({ length: 101 }, (_, index) => String(index + 1));

    await assert.rejects(createLinkedinJobReader(fake.apify).fetch(ids), RangeError);
    assert.deepEqual(fake.runs, []);
  });
});
