import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import {
  companies,
  companyKeys,
  db,
  eq,
  getDb,
  like,
  publications,
  saveVacancies,
  sources,
} from '@job-market/db';
import type { VacancyToSave } from '@job-market/db';

import { searchVacancies } from './search-vacancies.ts';
import type { SearchOptions, VacancySearchResult } from './search-vacancies.ts';

/** Тесты идут в тестовую базу из `.env.test`: `pnpm db:up && pnpm db:migrate:test`. */

/** Метка в адресах публикаций и названиях компаний: тесты других файлов идут в ту же базу. */
const KEY = 'search-vacancies-test';
const MISSING = '00000000-0000-4000-8000-000000000000';

function role(title: string, fields: Partial<VacancyToSave>): VacancyToSave {
  return {
    schemaVersion: 2,
    title,
    hiringParty: 'employer',
    occupationId: 'root',
    isRemoteFromAnywhere: false,
    apply: { urls: [], emails: [], directMessage: false },
    summary: 'Делать продукт.',
    places: [],
    ...fields,
  };
}

async function publish(
  sourceId: string,
  number: number,
  postedAt: string,
  roles: readonly VacancyToSave[],
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(publications)
      .values({
        sourceId,
        connector: 'open-telegram',
        externalId: `${KEY}/${String(number)}`,
        url: `https://t.me/${KEY}/${String(number)}`,
        content: 'Ищем людей',
        postedAt: new Date(postedAt),
        contentHash: `${KEY}-${String(number)}`,
        status: 'vacancy',
      })
      .returning({ id: publications.id });
    assert.ok(row !== undefined);
    await saveVacancies(tx, row.id, roles);
  });
}

async function run(query: string, options: SearchOptions = {}): Promise<VacancySearchResult> {
  const result = await searchVacancies(query, { limit: 1000, ...options });
  assert.ok(!(result instanceof Error), result instanceof Error ? String(result.cause) : '');
  return result;
}

/** Заголовки найденных вакансий из публикаций этого теста, в порядке выдачи. */
async function search(query: string, options: SearchOptions = {}): Promise<string[]> {
  const { items } = await run(query, options);
  return items.filter((item) => item.postUrl.includes(KEY)).map((item) => item.title);
}

async function companyIdOf(name: string): Promise<string> {
  const [row] = await db.select().from(companies).where(eq(companies.name, name));
  assert.ok(row !== undefined);
  return row.id;
}

async function cleanup(): Promise<void> {
  await db.delete(publications).where(like(publications.externalId, `${KEY}/%`));
  await db.delete(sources).where(eq(sources.key, KEY));
  await db.delete(companyKeys).where(like(companyKeys.value, `%${KEY}%`));
  await db.delete(companies).where(like(companies.name, `%${KEY}%`));
}

describe('searchVacancies', () => {
  before(async () => {
    await cleanup();
    const [source] = await db
      .insert(sources)
      .values({ connector: 'open-telegram', key: KEY, platform: 'geekjobs', name: KEY })
      .returning({ id: sources.id });
    assert.ok(source !== undefined);
    await publish(source.id, 1, '2026-11-18T10:00:00.000Z', [
      role('Ведущий разработчик', {
        company: `Ромашка ${KEY}`,
        locations: ['Белград'],
        skills: ['Go', 'PostgreSQL'],
        summary: 'Команда платёжных сервисов, писать бэкенд.',
      }),
      role('Аналитик данных', { company: `Ромашка ${KEY}`, skills: ['SQL'] }),
    ]);
    await publish(source.id, 2, '2026-11-19T10:00:00.000Z', [
      role('Senior Frontend Developers', {
        company: `Acme ${KEY}`,
        locations: ['Berlin'],
        skills: ['React', 'TypeScript'],
        summary: 'Делать интерфейс для разработчиков.',
      }),
      role('QA Engineer', { skills: ['Playwright'], summary: 'Тестировать React.' }),
    ]);
  });

  after(async () => {
    await cleanup();
    await getDb().$client.end();
  });

  test('empty query returns all vacancies, newest publications first', async () => {
    assert.deepEqual(await search('  '), [
      'Senior Frontend Developers',
      'QA Engineer',
      'Ведущий разработчик',
      'Аналитик данных',
    ]);
  });

  test('searches company, skills and locations too', async () => {
    assert.deepEqual(await search('ромашка'), ['Ведущий разработчик', 'Аналитик данных']);
    assert.deepEqual(await search('postgresql'), ['Ведущий разработчик']);
    assert.deepEqual(await search('berlin'), ['Senior Frontend Developers']);
  });

  test('ranks a match in skills above a match in summary', async () => {
    assert.deepEqual(await search('react'), ['Senior Frontend Developers', 'QA Engineer']);
  });

  test('a company filter keeps only its vacancies and works with the query', async () => {
    const companyId = await companyIdOf(`Ромашка ${KEY}`);

    const result = await run('', { companyId });

    assert.deepEqual(result.company, { id: companyId, name: `Ромашка ${KEY}` });
    assert.deepEqual(
      result.items.map((item) => item.title),
      ['Ведущий разработчик', 'Аналитик данных'],
    );
    assert.deepEqual(await search('go', { companyId }), ['Ведущий разработчик']);
  });

  test('a missing company gives no vacancies and no company', async () => {
    assert.deepEqual(await run('', { companyId: MISSING }), {
      items: [],
      total: 0,
      company: null,
    });
  });

  test('a vacancy without a company has no company name', async () => {
    const { items } = await run('playwright');
    const qa = items.find((item) => item.postUrl.includes(KEY));

    assert.ok(qa !== undefined);
    assert.equal(qa.companyId, null);
    assert.equal(qa.companyName, null);
  });
});
