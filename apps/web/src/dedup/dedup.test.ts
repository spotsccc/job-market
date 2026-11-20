import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { db, getDb, inArray, posts } from '@job-market/db';

import { findSavedPosts } from './index.ts';

/** Тесты идут в тестовую базу из `.env.test`: `pnpm db:up && pnpm db:migrate:test`. */

const SAVED_ID = 'dedup-test-saved-7330988768578920448';
const NEW_ID = 'dedup-test-new-7330988768578920449';

describe('findSavedPosts', () => {
  before(async () => {
    await db.delete(posts).where(inArray(posts.externalId, [SAVED_ID, NEW_ID]));
    await db.insert(posts).values({
      source: 'linkedin',
      externalId: SAVED_ID,
      url: 'https://www.linkedin.com/posts/jane_hiring-activity-1',
      content: 'Hiring',
      postedAt: new Date('2026-11-19T10:00:00.000Z'),
      authorName: 'Jane Doe',
      authorUrl: 'https://www.linkedin.com/in/jane',
    });
  });

  after(async () => {
    await db.delete(posts).where(inArray(posts.externalId, [SAVED_ID, NEW_ID]));
    await getDb().$client.end();
  });

  test('returns only posts already in the database', async () => {
    const saved = await findSavedPosts('linkedin', [SAVED_ID, NEW_ID]);

    assert.ok(!(saved instanceof Error), saved instanceof Error ? String(saved.cause) : '');
    assert.deepEqual([...saved], [SAVED_ID]);
  });

  test('returns an empty set for no ids', async () => {
    const saved = await findSavedPosts('linkedin', []);

    assert.ok(!(saved instanceof Error));
    assert.equal(saved.size, 0);
  });
});
