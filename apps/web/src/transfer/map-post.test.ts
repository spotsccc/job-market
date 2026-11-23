import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { LegacyPostRow } from '@job-market/db';

import { mapPost } from './map-post.ts';

function post(overrides: Partial<LegacyPostRow> = {}): LegacyPostRow {
  return {
    id: '0f6a3c38-8a71-4a51-9a0e-6a7ab0b5f001',
    source: 'telegram',
    externalId: 'forhr/9120',
    url: 'https://t.me/forhr/9120',
    content: 'Ищем HR BP',
    postedAt: new Date('2026-11-20T10:00:00.000Z'),
    authorName: 'Job for HR',
    authorUrl: 'https://t.me/forhr',
    authorHeadline: null,
    authorHandle: 'forhr',
    createdAt: new Date('2026-11-20T10:05:00.000Z'),
    ...overrides,
  };
}

describe('mapPost', () => {
  test('a telegram post keeps its id, the channel is the source key and the author', () => {
    const mapped = mapPost(post());

    assert.equal(mapped.publication.id, post().id);
    assert.equal(mapped.publication.connector, 'open-telegram');
    assert.equal(mapped.publication.externalId, 'forhr/9120');
    assert.deepEqual(mapped.source, { connector: 'open-telegram', key: 'forhr' });
    assert.deepEqual(mapped.author, {
      connector: 'open-telegram',
      externalId: 'forhr',
      name: 'Job for HR',
      url: 'https://t.me/forhr',
      headline: null,
    });
  });

  test('a linkedin author is the profile path of a person or a company', () => {
    const person = mapPost(
      post({
        source: 'linkedin',
        externalId: '7330988768578920448',
        authorUrl: 'https://www.linkedin.com/in/jane-doe/',
        authorHeadline: 'Hiring at Acme',
      }),
    );
    const company = mapPost(
      post({
        source: 'linkedin',
        externalId: '7330988768578920449',
        authorUrl: 'https://www.linkedin.com/company/acme',
      }),
    );

    assert.deepEqual(person.source, { connector: 'linkedin', key: 'manual' });
    assert.equal(person.author?.externalId, 'in/jane-doe');
    assert.equal(person.author.headline, 'Hiring at Acme');
    assert.equal(company.author?.externalId, 'company/acme');
  });

  test('a linkedin author url that is not a profile gives no author', () => {
    const mapped = mapPost(
      post({
        source: 'linkedin',
        externalId: '7330988768578920450',
        authorUrl: 'https://www.linkedin.com/feed/',
      }),
    );

    assert.equal(mapped.author, null);
  });
});
