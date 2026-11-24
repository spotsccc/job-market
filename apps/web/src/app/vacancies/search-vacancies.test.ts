import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import {
  db,
  eq,
  getDb,
  like,
  publications,
  saveVacancies,
  sources,
  vacancies,
} from '@job-market/db';
import type { PlaceToSave, VacancyToSave } from '@job-market/db';

import { EMPTY_FILTERS, parseFilters } from './filters.ts';
import type { VacancyFilters } from './filters.ts';
import { getVacancy } from './get-vacancy.ts';
import { searchVacancies } from './search-vacancies.ts';

/** Тесты идут в тестовую базу из `.env.test`: `pnpm db:up && pnpm db:migrate:test`. */

const KEY = 'search-vacancies-test';

const BERLIN_OFFICE: PlaceToSave = {
  role: 'office',
  resolution: 'resolved',
  cityId: 2_950_159,
  countryCode: 'DE',
  raw: 'Berlin',
};
const HIRING_EU: PlaceToSave = {
  role: 'hiring',
  resolution: 'resolved',
  regionCode: 'eu',
  raw: 'EU',
};
const HIRING_US: PlaceToSave = {
  role: 'hiring',
  resolution: 'resolved',
  countryCode: 'US',
  raw: 'USA',
};

function role(title: string, fields: Partial<VacancyToSave> = {}): VacancyToSave {
  const places = fields.places ?? [];
  return {
    schemaVersion: 2,
    title,
    hiringParty: 'employer',
    occupationId: 'root',
    isRemoteFromAnywhere: false,
    apply: { urls: [], emails: [], directMessage: true },
    summary: 'Делать продукт.',
    ...fields,
    places,
    locations: places.map((place) => place.raw),
  };
}

/** Заголовки найденных вакансий этого теста, в порядке выдачи. */
async function search(filters: Partial<VacancyFilters>): Promise<string[]> {
  const result = await searchVacancies({ ...EMPTY_FILTERS, ...filters }, 1000);
  assert.ok(!(result instanceof Error), result instanceof Error ? String(result.cause) : '');
  return result.items.filter((item) => item.publicationUrl.includes(KEY)).map((item) => item.title);
}

async function removeTestRows(): Promise<void> {
  await db.delete(publications).where(like(publications.externalId, `${KEY}/%`));
  await db.delete(sources).where(eq(sources.key, KEY));
}

async function insertPublication(sourceId: string, n: number, postedAt: string): Promise<string> {
  const [publication] = await db
    .insert(publications)
    .values({
      sourceId,
      connector: 'open-telegram',
      externalId: `${KEY}/${String(n)}`,
      url: `https://t.me/${KEY}/${String(n)}`,
      content: 'Ищем',
      postedAt: new Date(postedAt),
      contentHash: `hash-${String(n)}`,
      status: 'vacancy',
    })
    .returning({ id: publications.id });
  assert.ok(publication !== undefined);
  return publication.id;
}

describe('searchVacancies', () => {
  before(async () => {
    await removeTestRows();
    const [source] = await db
      .insert(sources)
      .values({ connector: 'open-telegram', key: KEY, platform: 'geekjobs', name: KEY })
      .returning({ id: sources.id });
    assert.ok(source !== undefined);
    const older = await insertPublication(source.id, 1, '2026-11-18T10:00:00.000Z');
    const newer = await insertPublication(source.id, 2, '2026-11-19T10:00:00.000Z');
    await saveVacancies(db, older, [
      role('Ведущий разработчик', {
        occupationId: 'backend',
        company: 'Ромашка',
        skills: ['Go', 'PostgreSQL'],
        experienceYearsMin: 5,
        salaryMin: 50_000,
        salaryMax: 60_000,
        salaryCurrency: 'EUR',
        places: [BERLIN_OFFICE, HIRING_US],
        summary: 'Команда платёжных сервисов, писать бэкенд.',
      }),
    ]);
    await saveVacancies(db, newer, [
      role('Senior Frontend Developer', {
        occupationId: 'frontend',
        company: 'Acme',
        skills: ['TypeScript'],
        niceSkills: ['React'],
        experienceYearsMin: 3,
        salaryMin: 80_000,
        salaryMax: 95_000,
        salaryCurrency: 'EUR',
        places: [HIRING_EU],
        summary: 'Делать интерфейс для разработчиков.',
      }),
      role('QA Engineer', {
        occupationId: 'qa',
        skills: ['Playwright'],
        salaryMin: 100_000,
        salaryCurrency: 'USD',
        places: [BERLIN_OFFICE],
        summary: 'Тестировать React.',
      }),
      role('Support', { isRemoteFromAnywhere: true }),
    ]);
  });

  after(async () => {
    await removeTestRows();
    await getDb().$client.end();
  });

  test('without filters returns all vacancies, newest publications first', async () => {
    assert.deepEqual(await search({}), [
      'Senior Frontend Developer',
      'QA Engineer',
      'Support',
      'Ведущий разработчик',
    ]);
  });

  test('ranks a match in skills above a match in summary', async () => {
    assert.deepEqual(await search({ q: 'react' }), ['Senior Frontend Developer', 'QA Engineer']);
  });

  test('an occupation includes its subtree, root only itself', async () => {
    assert.deepEqual(await search({ occupations: ['engineering'] }), [
      'Senior Frontend Developer',
      'Ведущий разработчик',
    ]);
    assert.deepEqual(await search({ occupations: ['root'] }), ['Support']);
  });

  test('work from a country: hiring region covers it, anywhere, office without hiring places', async () => {
    // Ведущий разработчик: офис в Берлине, но нанимают только из США.
    assert.deepEqual(await search({ place: { kind: 'country', code: 'DE' } }), [
      'Senior Frontend Developer',
      'QA Engineer',
      'Support',
    ]);
  });

  test('office in a region matches offices in its countries', async () => {
    assert.deepEqual(await search({ place: { kind: 'region', code: 'eu' }, placeMode: 'office' }), [
      'QA Engineer',
      'Ведущий разработчик',
    ]);
  });

  test('work from a city: its country and covering regions count', async () => {
    assert.deepEqual(await search({ place: { kind: 'city', id: 2_867_714 } }), [
      'Senior Frontend Developer',
      'Support',
    ]);
  });

  test('experience keeps vacancies that ask for no more years or name none', async () => {
    assert.deepEqual(await search({ experienceYears: 3 }), [
      'Senior Frontend Developer',
      'QA Engineer',
      'Support',
    ]);
  });

  test('skills match required and nice skills regardless of case', async () => {
    assert.deepEqual(await search({ skills: ['react', 'typescript'] }), [
      'Senior Frontend Developer',
    ]);
    assert.deepEqual(await search({ skills: ['react', 'go'] }), []);
  });

  test('salary from compares with the top of the range in the chosen currency', async () => {
    assert.deepEqual(await search({ salaryFrom: 90_000, salaryCurrency: 'EUR' }), [
      'Senior Frontend Developer',
    ]);
  });

  test('getVacancy returns the vacancy with the other roles of its publication', async () => {
    const [frontend] = await db
      .select({ id: vacancies.id })
      .from(vacancies)
      .where(eq(vacancies.title, 'Senior Frontend Developer'));
    assert.ok(frontend !== undefined);
    const vacancy = await getVacancy(frontend.id);
    assert.ok(vacancy !== null && !(vacancy instanceof Error), 'vacancy not loaded');
    assert.equal(vacancy.occupation, 'IT › Разработка › Frontend');
    assert.deepEqual(
      vacancy.siblings.map((sibling) => sibling.title),
      ['QA Engineer', 'Support'],
    );
  });

  test('getVacancy returns null for an unknown or malformed id', async () => {
    assert.equal(await getVacancy('00000000-0000-0000-0000-000000000000'), null);
    assert.equal(await getVacancy('not-a-uuid'), null);
  });
});

describe('parseFilters', () => {
  test('drops unknown values instead of failing', () => {
    const filters = parseFilters({
      seniority: 'senior,wizard',
      workplace: ['remote', 'moon'],
      place: 'city:abc',
      experience: '99',
      page: '-2',
      salaryCurrency: 'eur',
      language: 'EN,english',
    });
    assert.deepEqual(filters.seniorities, ['senior']);
    assert.deepEqual(filters.workplaces, ['remote']);
    assert.equal(filters.place, null);
    assert.equal(filters.experienceYears, null);
    assert.equal(filters.page, 1);
    assert.equal(filters.salaryCurrency, 'EUR');
    assert.deepEqual(filters.languages, ['en']);
  });
});
