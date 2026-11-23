import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

import { asc, eq, inArray } from 'drizzle-orm';

import { db, getDb } from '../client.ts';
import { publications, sources } from '../publication/index.ts';
import { saveVacancies } from './save-vacancies.ts';
import type { PlaceToSave, VacancyToSave } from './save-vacancies.ts';
import { vacancyLocations } from './vacancy-location.ts';
import { vacancies } from './vacancy.ts';

/** Тесты идут в тестовую базу из `apps/web/.env.test`: `pnpm db:up && pnpm db:migrate:test`. */

const KEY = 'save-vacancies-test';
let publicationId = '';

const EU: PlaceToSave = { role: 'hiring', resolution: 'resolved', regionCode: 'eu', raw: 'EU' };
const BERLIN: PlaceToSave = {
  role: 'office',
  resolution: 'resolved',
  cityId: 2_950_159,
  countryCode: 'DE',
  raw: 'Berlin, Germany',
};

function role(title: string, places: readonly PlaceToSave[] = []): VacancyToSave {
  return {
    schemaVersion: 2,
    title,
    hiringParty: 'employer',
    occupationId: 'root',
    isRemoteFromAnywhere: false,
    locations: places.map((place) => place.raw),
    apply: { urls: [], emails: [], directMessage: true },
    summary: 'Делать продукт.',
    places,
  };
}

async function savedVacancies(): Promise<{ id: string; position: number; title: string }[]> {
  return db
    .select({ id: vacancies.id, position: vacancies.position, title: vacancies.title })
    .from(vacancies)
    .where(eq(vacancies.publicationId, publicationId))
    .orderBy(asc(vacancies.position));
}

async function savedPlaces(vacancyIds: readonly string[]): Promise<string[]> {
  const rows = await db
    .select({ position: vacancyLocations.position, raw: vacancyLocations.raw })
    .from(vacancyLocations)
    .where(inArray(vacancyLocations.vacancyId, [...vacancyIds]))
    .orderBy(asc(vacancyLocations.position));
  return rows.map((row) => `${String(row.position)} ${row.raw}`);
}

async function removeTestRows(): Promise<void> {
  await db.delete(publications).where(eq(publications.externalId, `${KEY}/1`));
  await db.delete(sources).where(eq(sources.key, KEY));
}

describe('saveVacancies', () => {
  before(async () => {
    await removeTestRows();
    const [source] = await db
      .insert(sources)
      .values({ connector: 'open-telegram', key: KEY, platform: 'geekjobs', name: KEY })
      .returning({ id: sources.id });
    assert.ok(source !== undefined);
    const [publication] = await db
      .insert(publications)
      .values({
        sourceId: source.id,
        connector: 'open-telegram',
        externalId: `${KEY}/1`,
        url: `https://t.me/${KEY}/1`,
        content: 'Ищем двоих',
        postedAt: new Date('2026-11-20T10:00:00.000Z'),
        contentHash: 'hash',
        status: 'vacancy',
      })
      .returning({ id: publications.id });
    assert.ok(publication !== undefined);
    publicationId = publication.id;
  });

  beforeEach(async () => {
    await db.delete(vacancies).where(eq(vacancies.publicationId, publicationId));
  });

  after(async () => {
    await removeTestRows();
    await getDb().$client.end();
  });

  test('a second write with fewer roles removes the extra vacancy', async () => {
    await saveVacancies(db, publicationId, [role('Frontend'), role('QA')]);
    const [first] = await savedVacancies();

    await saveVacancies(db, publicationId, [role('Senior Frontend')]);

    const rows = await savedVacancies();
    assert.deepEqual(
      rows.map(({ position, title }) => `${String(position)} ${title}`),
      ['0 Senior Frontend'],
    );
    // Роль перезаписана по (publication_id, position), а не вставлена заново.
    assert.equal(rows[0]?.id, first?.id);
    const [row] = await db
      .select()
      .from(vacancies)
      .where(eq(vacancies.id, rows[0]?.id ?? ''));
    assert.equal(row?.schemaVersion, 2);
  });

  test('places are written in order and copied to locations', async () => {
    await saveVacancies(db, publicationId, [role('Frontend', [EU, BERLIN])]);

    const [vacancy] = await savedVacancies();
    assert.ok(vacancy !== undefined);
    assert.deepEqual(await savedPlaces([vacancy.id]), ['0 EU', '1 Berlin, Germany']);
    const [row] = await db.select().from(vacancies).where(eq(vacancies.id, vacancy.id));
    assert.deepEqual(row?.locations, ['EU', 'Berlin, Germany']);
  });

  test('a second write replaces the places of the vacancy', async () => {
    await saveVacancies(db, publicationId, [role('Frontend', [EU, BERLIN])]);

    await saveVacancies(db, publicationId, [role('Frontend', [BERLIN])]);

    const [vacancy] = await savedVacancies();
    assert.ok(vacancy !== undefined);
    assert.deepEqual(await savedPlaces([vacancy.id]), ['0 Berlin, Germany']);
  });

  test('a role without places has no places and empty locations', async () => {
    await saveVacancies(db, publicationId, [role('Frontend')]);

    const [vacancy] = await savedVacancies();
    assert.ok(vacancy !== undefined);
    assert.deepEqual(await savedPlaces([vacancy.id]), []);
    const [row] = await db.select().from(vacancies).where(eq(vacancies.id, vacancy.id));
    assert.deepEqual(row?.locations, []);
  });
});
