import assert from 'node:assert/strict';
import { after, beforeEach, describe, test } from 'node:test';

import { asc, db, eq, getDb, posts, vacancies } from '@job-market/db';

import type { Post, Vacancy } from '../../post-processing/index.ts';
import { savePostWithVacancies } from './save-post.ts';

/** Тесты идут в тестовую базу из `.env.test`: `pnpm db:up && pnpm db:migrate:test`. */

const EXTERNAL_ID = 'save-post-test-7330988768578920448';

function post(overrides: Partial<Post> = {}): Post {
  return {
    source: 'linkedin',
    externalId: EXTERNAL_ID,
    url: 'https://www.linkedin.com/posts/jane_hiring-activity-1',
    content: 'Hiring two engineers',
    postedAt: new Date('2026-11-19T10:00:00.000Z'),
    authorName: 'Jane Doe',
    authorUrl: 'https://www.linkedin.com/in/jane',
    authorHeadline: null,
    authorHandle: 'jane',
    ...overrides,
  };
}

function vacancy(position: number, overrides: Partial<Vacancy> = {}): Vacancy {
  return {
    position,
    title: `Engineer ${String(position)}`,
    company: 'Acme',
    companyUrl: null,
    hiringParty: 'employer',
    seniority: 'senior',
    workplace: 'remote',
    isRemoteFromAnywhere: true,
    locations: ['EU'],
    employmentTypes: ['full_time', 'contract'],
    salaryMin: 80_000,
    salaryMax: null,
    salaryCurrency: 'EUR',
    salaryPeriod: 'year',
    salaryRaw: 'от €80k',
    skills: ['TypeScript'],
    relocation: false,
    visaSponsorship: null,
    apply: { urls: [], emails: ['jobs@acme.dev'], directMessage: true },
    summary: 'Делать продукт.',
    ...overrides,
  };
}

async function savedRows(): Promise<{
  readonly postRows: readonly (typeof posts.$inferSelect)[];
  readonly vacancyRows: readonly (typeof vacancies.$inferSelect)[];
}> {
  const postRows = await db.select().from(posts).where(eq(posts.externalId, EXTERNAL_ID));
  const postId = postRows[0]?.id ?? '00000000-0000-0000-0000-000000000000';
  const vacancyRows = await db
    .select()
    .from(vacancies)
    .where(eq(vacancies.postId, postId))
    .orderBy(asc(vacancies.position));
  return { postRows, vacancyRows };
}

describe('savePostWithVacancies', () => {
  beforeEach(async () => {
    await db.delete(posts).where(eq(posts.externalId, EXTERNAL_ID));
  });

  after(async () => {
    await db.delete(posts).where(eq(posts.externalId, EXTERNAL_ID));
    await getDb().$client.end();
  });

  test('saves the post with its vacancies', async () => {
    const postId = await savePostWithVacancies(post(), [vacancy(0), vacancy(1)]);

    assert.ok(!(postId instanceof Error), postId instanceof Error ? String(postId.cause) : '');
    const { postRows, vacancyRows } = await savedRows();
    assert.equal(postRows.length, 1);
    assert.equal(postRows[0]?.id, postId);
    assert.deepEqual(
      vacancyRows.map((row) => [row.position, row.title, row.postId]),
      [
        [0, 'Engineer 0', postId],
        [1, 'Engineer 1', postId],
      ],
    );
    const first = vacancyRows.at(0);
    assert.ok(first);
    assert.deepEqual(first.employmentTypes, ['full_time', 'contract']);
    assert.equal(first.isRemoteFromAnywhere, true);
    assert.equal(first.salaryMin, 80_000);
    assert.deepEqual(first.apply, { urls: [], emails: ['jobs@acme.dev'], directMessage: true });
  });

  test('re-saving the post updates rows in place and drops roles that disappeared', async () => {
    const firstId = await savePostWithVacancies(post(), [vacancy(0), vacancy(1)]);
    assert.ok(!(firstId instanceof Error));
    const before = await savedRows();

    const secondId = await savePostWithVacancies(
      post({ content: 'Hiring one engineer', authorHeadline: 'CTO at Acme' }),
      [vacancy(0, { title: 'Staff Engineer', isRemoteFromAnywhere: false, visaSponsorship: true })],
    );

    assert.equal(secondId, firstId);
    const { postRows, vacancyRows } = await savedRows();
    const savedPost = postRows.at(0);
    assert.ok(savedPost);
    assert.equal(savedPost.content, 'Hiring one engineer');
    assert.equal(savedPost.authorHeadline, 'CTO at Acme');
    assert.equal(vacancyRows.length, 1);
    const updated = vacancyRows.at(0);
    const original = before.vacancyRows.at(0);
    assert.ok(updated && original);
    assert.equal(updated.id, original.id);
    assert.equal(updated.title, 'Staff Engineer');
    assert.equal(updated.isRemoteFromAnywhere, false);
    assert.equal(updated.visaSponsorship, true);
    assert.ok(updated.updatedAt >= original.updatedAt);
  });
});
