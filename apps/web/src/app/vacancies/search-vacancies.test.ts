import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { db, getDb, inArray, legacyPosts } from '@job-market/db';

import { savePostWithVacancies } from '../../post-processing/index.ts';
import type { Post, Vacancy } from '../../post-processing/index.ts';
import { searchVacancies } from './search-vacancies.ts';

/** Тесты идут в тестовую базу из `.env.test`: `pnpm db:up && pnpm db:migrate:test`. */

const EXTERNAL_IDS = ['search-test-ru', 'search-test-en'] as const;

function post(externalId: string, postedAt: string): Post {
  return {
    source: 'linkedin',
    externalId,
    url: `https://www.linkedin.com/posts/${externalId}`,
    content: 'Ищем людей',
    postedAt: new Date(postedAt),
    authorName: 'Jane Doe',
    authorUrl: 'https://www.linkedin.com/in/jane',
    authorHeadline: null,
    authorHandle: 'jane',
  };
}

function vacancy(position: number, overrides: Partial<Vacancy>): Vacancy {
  return {
    position,
    title: 'Engineer',
    company: null,
    companyUrl: null,
    hiringParty: 'employer',
    seniority: null,
    workplace: null,
    isRemoteFromAnywhere: false,
    locations: [],
    employmentTypes: [],
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    salaryRaw: null,
    skills: [],
    relocation: null,
    visaSponsorship: null,
    apply: { urls: [], emails: [], directMessage: false },
    summary: 'Делать продукт.',
    ...overrides,
  };
}

/** Заголовки найденных вакансий из постов этого теста, в порядке выдачи. */
async function search(query: string): Promise<string[]> {
  const result = await searchVacancies(query, 1000);
  assert.ok(!(result instanceof Error), result instanceof Error ? String(result.cause) : '');
  return result.items
    .filter((item) => item.postUrl.includes('/search-test-'))
    .map((item) => item.title);
}

async function cleanup(): Promise<void> {
  await db.delete(legacyPosts).where(inArray(legacyPosts.externalId, [...EXTERNAL_IDS]));
}

describe('searchVacancies', () => {
  before(async () => {
    await cleanup();
    const saved = await Promise.all([
      savePostWithVacancies(post('search-test-ru', '2026-11-18T10:00:00.000Z'), [
        vacancy(0, {
          title: 'Ведущий разработчик',
          company: 'Ромашка',
          locations: ['Белград'],
          skills: ['Go', 'PostgreSQL'],
          summary: 'Команда платёжных сервисов, писать бэкенд.',
        }),
      ]),
      savePostWithVacancies(post('search-test-en', '2026-11-19T10:00:00.000Z'), [
        vacancy(0, {
          title: 'Senior Frontend Developers',
          company: 'Acme',
          locations: ['Berlin'],
          skills: ['React', 'TypeScript'],
          summary: 'Делать интерфейс для разработчиков.',
        }),
        vacancy(1, { title: 'QA Engineer', skills: ['Playwright'], summary: 'Тестировать React.' }),
      ]),
    ]);
    for (const id of saved) assert.ok(!(id instanceof Error), String(id));
  });

  after(async () => {
    await cleanup();
    await getDb().$client.end();
  });

  test('empty query returns all vacancies, newest posts first', async () => {
    assert.deepEqual(await search('  '), [
      'Senior Frontend Developers',
      'QA Engineer',
      'Ведущий разработчик',
    ]);
  });

  test('searches company, skills and locations too', async () => {
    assert.deepEqual(await search('ромашка'), ['Ведущий разработчик']);
    assert.deepEqual(await search('postgresql'), ['Ведущий разработчик']);
    assert.deepEqual(await search('berlin'), ['Senior Frontend Developers']);
  });

  test('ranks a match in skills above a match in summary', async () => {
    assert.deepEqual(await search('react'), ['Senior Frontend Developers', 'QA Engineer']);
  });
});
