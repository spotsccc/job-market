import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { and, desc, eq, sql } from 'drizzle-orm';

import { db, getDb } from '../client.ts';
import { authors, publications, sources } from '../publication/index.ts';
import { vacancies, vacancyLocations } from './index.ts';
import type { NewVacancyRow } from './index.ts';

/** Тесты идут в тестовую базу из `apps/web/.env.test`: `pnpm db:up && pnpm db:migrate:test`. */

const KEY = 'vacancy-test-forhr';
const EXTERNAL_ID = `${KEY}/9120`;

let publicationId = '';

function vacancy(position: number, overrides: Partial<NewVacancyRow> = {}): NewVacancyRow {
  return {
    publicationId,
    position,
    schemaVersion: 2,
    title: `Engineer ${String(position)}`,
    hiringParty: 'employer',
    occupationId: 'root',
    isRemoteFromAnywhere: false,
    apply: { urls: [], emails: [], directMessage: true },
    summary: 'Делать продукт.',
    ...overrides,
  };
}

async function removeTestRows(): Promise<void> {
  // Публикация уносит вакансии, вакансия — места.
  await db.delete(publications).where(eq(publications.externalId, EXTERNAL_ID));
  await db.delete(authors).where(eq(authors.externalId, KEY));
  await db.delete(sources).where(eq(sources.key, KEY));
}

/** Названия вакансий тестовой публикации, которые находит запрос, от релевантных к менее. */
async function searchTitles(query: string): Promise<string[]> {
  const tsQuery = sql`websearch_to_tsquery('russian', ${query})`;
  const rows = await db
    .select({ title: vacancies.title })
    .from(vacancies)
    .where(
      and(eq(vacancies.publicationId, publicationId), sql`${vacancies.searchVector} @@ ${tsQuery}`),
    )
    .orderBy(desc(sql`ts_rank(${vacancies.searchVector}, ${tsQuery})`), vacancies.position);
  return rows.map(({ title }) => title);
}

describe('new data model', () => {
  before(async () => {
    await removeTestRows();
    const [source] = await db
      .insert(sources)
      .values({ connector: 'open-telegram', key: KEY, platform: 'geekjobs', name: 'forhr' })
      .returning({ id: sources.id });
    const [author] = await db
      .insert(authors)
      .values({
        connector: 'open-telegram',
        externalId: KEY,
        name: 'forhr',
        url: 'https://t.me/forhr',
      })
      .returning({ id: authors.id });
    assert.ok(source !== undefined && author !== undefined);
    const [publication] = await db
      .insert(publications)
      .values({
        sourceId: source.id,
        connector: 'open-telegram',
        externalId: EXTERNAL_ID,
        url: 'https://t.me/forhr/9120',
        content: 'Ищем Senior Frontend',
        postedAt: new Date('2026-11-20T10:00:00.000Z'),
        contentHash: 'hash',
        authorId: author.id,
      })
      .returning({ id: publications.id });
    assert.ok(publication !== undefined);
    publicationId = publication.id;
  });

  after(async () => {
    await removeTestRows();
    await getDb().$client.end();
  });

  describe('search vector', () => {
    before(async () => {
      await db
        .insert(vacancies)
        .values([
          vacancy(0, { title: 'Backend Engineer', requirements: ['Опыт с Kafka от двух лет'] }),
          vacancy(1, { title: 'Kafka Engineer' }),
          vacancy(2, { title: 'Data Engineer', niceSkills: ['Flink'] }),
          vacancy(3, { title: 'Platform Engineer', benefits: ['Абонемент в спортзал'] }),
        ]);
    });

    after(async () => {
      await db.delete(vacancies).where(eq(vacancies.publicationId, publicationId));
    });

    test('a word in the title ranks above the same word in requirements', async () => {
      assert.deepEqual(await searchTitles('kafka'), ['Kafka Engineer', 'Backend Engineer']);
    });

    test('nice-to-have skills are searchable', async () => {
      assert.deepEqual(await searchTitles('flink'), ['Data Engineer']);
    });

    test('benefits are not searchable', async () => {
      assert.deepEqual(await searchTitles('спортзал'), []);
    });
  });

  test('a publication reads with its author, source, vacancies, occupation and locations', async () => {
    const [row] = await db
      .insert(vacancies)
      .values(vacancy(0, { title: 'Senior Frontend' }))
      .returning({ id: vacancies.id });
    assert.ok(row !== undefined);
    await db.insert(vacancyLocations).values([
      {
        vacancyId: row.id,
        position: 0,
        role: 'hiring',
        resolution: 'resolved',
        regionCode: 'eu',
        raw: 'Remote EU',
      },
      {
        vacancyId: row.id,
        position: 1,
        role: 'office',
        resolution: 'resolved',
        countryCode: 'DE',
        cityId: 2_950_159,
        raw: 'Berlin',
      },
    ]);

    const publication = await db.query.publications.findFirst({
      where: eq(publications.id, publicationId),
      with: {
        author: true,
        source: true,
        vacancies: {
          with: {
            occupation: true,
            places: { orderBy: vacancyLocations.position },
          },
        },
      },
    });

    assert.deepEqual(
      {
        externalId: publication?.externalId,
        author: publication?.author?.externalId,
        source: [publication?.source.connector, publication?.source.key],
        vacancies: publication?.vacancies.map((item) => ({
          title: item.title,
          occupation: item.occupation?.id,
          places: item.places.map(({ role, regionCode, cityId, countryCode }) => ({
            role,
            regionCode,
            cityId,
            countryCode,
          })),
        })),
      },
      {
        externalId: EXTERNAL_ID,
        author: KEY,
        source: ['open-telegram', KEY],
        vacancies: [
          {
            title: 'Senior Frontend',
            occupation: 'root',
            places: [
              { role: 'hiring', regionCode: 'eu', cityId: null, countryCode: null },
              { role: 'office', regionCode: null, cityId: 2_950_159, countryCode: 'DE' },
            ],
          },
        ],
      },
    );
  });
});
