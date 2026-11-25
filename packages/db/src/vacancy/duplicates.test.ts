// oxlint-disable max-lines -- правило дубля и его запись делят одну тестовую базу и помощники
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

import { asc, eq, inArray, like } from 'drizzle-orm';

import { db, getDb } from '../client.ts';
import { companies, companyKeys } from '../company/company.ts';
import { publications, sources } from '../publication/index.ts';
import { isSameRole, titleKey } from './duplicates.ts';
import type { DuplicateFields } from './duplicates.ts';
import { saveVacancies } from './save-vacancies.ts';
import type { PlaceToSave, VacancyToSave } from './save-vacancies.ts';
import { vacancyDuplicates } from './vacancy-duplicate.ts';
import { vacancies } from './vacancy.ts';

/** Тесты идут в тестовую базу из `apps/web/.env.test`: `pnpm db:up && pnpm db:migrate:test`. */

const KEY = 'vacancy-duplicates-test';
const ACME = `Acme ${KEY}`;
const POSTED_AT = new Date('2026-11-20T10:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

const BERLIN: PlaceToSave = {
  role: 'office',
  resolution: 'resolved',
  cityId: 2_950_159,
  countryCode: 'DE',
  raw: 'Berlin',
};
const GERMANY: PlaceToSave = {
  role: 'hiring',
  resolution: 'resolved',
  countryCode: 'DE',
  raw: 'Germany',
};
const FRANCE: PlaceToSave = {
  role: 'hiring',
  resolution: 'resolved',
  countryCode: 'FR',
  raw: 'France',
};

function fields(overrides: Partial<DuplicateFields> = {}): DuplicateFields {
  return {
    title: 'Frontend Developer',
    seniority: null,
    workplace: null,
    countries: [],
    cities: [],
    ...overrides,
  };
}

function role(title: string, overrides: Partial<VacancyToSave> = {}): VacancyToSave {
  return {
    schemaVersion: 2,
    title,
    company: ACME,
    hiringParty: 'employer',
    occupationId: 'root',
    isRemoteFromAnywhere: false,
    apply: { urls: [], emails: [], directMessage: true },
    summary: 'Делать продукт.',
    places: [],
    ...overrides,
  };
}

let sourceId = '';

/** Публикация, вышедшая на `daysLater` дней позже `POSTED_AT`. */
async function addPublication(number: number, daysLater = 0): Promise<string> {
  const [publication] = await db
    .insert(publications)
    .values({
      sourceId,
      connector: 'open-telegram',
      externalId: `${KEY}/${String(number)}`,
      url: `https://t.me/${KEY}/${String(number)}`,
      content: 'Ищем фронтендера',
      postedAt: new Date(POSTED_AT.getTime() + daysLater * DAY_MS),
      contentHash: `${KEY}-${String(number)}`,
      status: 'pending',
    })
    .returning({ id: publications.id });
  assert.ok(publication !== undefined);
  return publication.id;
}

async function titlesOf(publicationId: string): Promise<string[]> {
  const rows = await db
    .select({ position: vacancies.position, title: vacancies.title })
    .from(vacancies)
    .where(eq(vacancies.publicationId, publicationId))
    .orderBy(asc(vacancies.position));
  return rows.map((row) => `${String(row.position)} ${row.title}`);
}

/** Строки дублей вакансий публикации: оригинал и название роли (П13 в packages/db/src/monitoring/README.md). */
async function duplicatesOf(
  publicationId: string,
): Promise<{ originalId: string; title: string }[]> {
  return db
    .select({ originalId: vacancyDuplicates.originalId, title: vacancyDuplicates.title })
    .from(vacancyDuplicates)
    .where(eq(vacancyDuplicates.publicationId, publicationId))
    .orderBy(asc(vacancyDuplicates.title));
}

async function removePublications(): Promise<void> {
  await db.delete(publications).where(like(publications.externalId, `${KEY}/%`));
}

async function removeTestRows(): Promise<void> {
  await removePublications();
  await db.delete(sources).where(eq(sources.key, KEY));
  const found = await db
    .select({ id: companies.id })
    .from(companies)
    .where(like(companies.name, `%${KEY}%`));
  const ids = found.map((company) => company.id);
  if (ids.length === 0) return;
  await db.delete(companyKeys).where(inArray(companyKeys.companyId, ids));
  await db.delete(companies).where(inArray(companies.id, ids));
}

describe('titleKey', () => {
  test('case, ё, emoji, punctuation and spaces do not distinguish titles', () => {
    assert.equal(
      titleKey('🔥 Senior  Frontend-разработчик (React)!'),
      titleKey('senior frontend разработчик react'),
    );
    assert.equal(titleKey('Бухгалтер-учётчик'), titleKey('бухгалтер учетчик'));
  });

  test('plus and hash stay: C++ and C# are different titles', () => {
    assert.notEqual(titleKey('C++ Developer'), titleKey('C# Developer'));
    assert.notEqual(titleKey('C++ Developer'), titleKey('C Developer'));
  });
});

describe('isSameRole', () => {
  test('the same title without contradictions is the same role', () => {
    assert.equal(
      isSameRole(
        fields({ seniority: 'senior', countries: ['DE', 'FR'] }),
        fields({ title: 'frontend developer', workplace: 'remote', countries: ['DE'] }),
      ),
      true,
    );
  });

  test('a different title, level, workplace, country or city is another role', () => {
    const base = fields({
      seniority: 'senior',
      workplace: 'remote',
      countries: ['DE'],
      cities: [1],
    });
    assert.equal(isSameRole(base, { ...base, title: 'Frontend Developer (Vue)' }), false);
    assert.equal(isSameRole(base, { ...base, seniority: 'junior' }), false);
    assert.equal(isSameRole(base, { ...base, workplace: 'onsite' }), false);
    assert.equal(isSameRole(base, { ...base, countries: ['FR'] }), false);
    assert.equal(isSameRole(base, { ...base, cities: [2] }), false);
  });

  test('a title without letters and digits is never a duplicate', () => {
    assert.equal(isSameRole(fields({ title: '🔥🔥' }), fields({ title: '🔥🔥' })), false);
  });
});

describe('saveVacancies with skipDuplicates', () => {
  before(async () => {
    await removeTestRows();
    const [source] = await db
      .insert(sources)
      .values({ connector: 'open-telegram', key: KEY, platform: 'geekjobs', name: KEY })
      .returning({ id: sources.id });
    assert.ok(source !== undefined);
    sourceId = source.id;
  });

  beforeEach(removePublications);

  after(async () => {
    await removeTestRows();
    await getDb().$client.end();
  });

  test('a role saved from another publication is not written, the rest are renumbered', async () => {
    const first = await addPublication(1);
    const second = await addPublication(2, 3);
    await saveVacancies(db, first, [role('Frontend Developer')], { skipDuplicates: true });

    const summary = await saveVacancies(
      db,
      second,
      [role('🔥 frontend developer'), role('QA Engineer')],
      { skipDuplicates: true },
    );

    assert.deepEqual(summary, { saved: 1, duplicateOf: [first] });
    assert.deepEqual(await titlesOf(second), ['0 QA Engineer']);
    assert.deepEqual(await titlesOf(first), ['0 Frontend Developer']);
  });

  test('without skipDuplicates the same role is written again', async () => {
    const first = await addPublication(1);
    const second = await addPublication(2);
    await saveVacancies(db, first, [role('Frontend Developer')]);

    const summary = await saveVacancies(db, second, [role('Frontend Developer')]);

    assert.deepEqual(summary, { saved: 1, duplicateOf: [] });
    assert.deepEqual(await titlesOf(second), ['0 Frontend Developer']);
  });

  test('a second write of the same publication is not a duplicate of itself', async () => {
    const first = await addPublication(1);
    await saveVacancies(db, first, [role('Frontend Developer')], { skipDuplicates: true });

    const summary = await saveVacancies(db, first, [role('Frontend Developer')], {
      skipDuplicates: true,
    });

    assert.deepEqual(summary, { saved: 1, duplicateOf: [] });
  });

  test('another company, a role without a company and a contradiction are not duplicates', async () => {
    const first = await addPublication(1);
    const second = await addPublication(2);
    await saveVacancies(
      db,
      first,
      [
        role('Frontend Developer', { seniority: 'senior' }),
        role('Designer', { company: null }),
        role('Sales Manager', { places: [GERMANY] }),
      ],
      { skipDuplicates: true },
    );

    const summary = await saveVacancies(
      db,
      second,
      [
        role('Frontend Developer', { company: `Globex ${KEY}` }),
        role('Frontend Developer', { seniority: 'junior' }),
        role('Designer', { company: null }),
        role('Sales Manager', { places: [FRANCE] }),
      ],
      { skipDuplicates: true },
    );

    assert.deepEqual(summary, { saved: 4, duplicateOf: [] });
  });

  test('a role in a city of the country of the saved one is a duplicate', async () => {
    const first = await addPublication(1);
    const second = await addPublication(2);
    await saveVacancies(db, first, [role('Sales Manager', { places: [GERMANY] })], {
      skipDuplicates: true,
    });

    const summary = await saveVacancies(db, second, [role('Sales Manager', { places: [BERLIN] })], {
      skipDuplicates: true,
    });

    assert.deepEqual(summary, { saved: 0, duplicateOf: [first] });
    assert.deepEqual(await titlesOf(second), []);
  });

  test('two transactions writing the same role at once save it once', async () => {
    const first = await addPublication(1);
    const second = await addPublication(2);

    const summaries = await Promise.all(
      [first, second].map(async (publicationId) =>
        db.transaction(async (tx) =>
          saveVacancies(tx, publicationId, [role('Frontend Developer')], { skipDuplicates: true }),
        ),
      ),
    );

    assert.equal(
      summaries.reduce((total, summary) => total + summary.saved, 0),
      1,
    );
  });

  test('publications more than 30 days apart are not duplicates, in either order', async () => {
    const early = await addPublication(1);
    const late = await addPublication(2, 31);
    const near = await addPublication(3, 30);
    await saveVacancies(db, late, [role('Frontend Developer')], { skipDuplicates: true });

    const far = await saveVacancies(db, early, [role('Frontend Developer')], {
      skipDuplicates: true,
    });
    const close = await saveVacancies(db, near, [role('Frontend Developer')], {
      skipDuplicates: true,
    });

    assert.deepEqual(far, { saved: 1, duplicateOf: [] });
    assert.equal(close.saved, 0);
  });

  test('a skipped duplicate leaves a row, and a second write does not double it', async () => {
    const first = await addPublication(1);
    const second = await addPublication(2);
    await saveVacancies(db, first, [role('Frontend-разработчик')], { skipDuplicates: true });
    const roles = [role('Frontend-разработчик'), role('QA Engineer'), role('Designer')];

    await saveVacancies(db, second, roles, { skipDuplicates: true });
    await saveVacancies(db, second, roles, { skipDuplicates: true });

    assert.deepEqual(await titlesOf(second), ['0 QA Engineer', '1 Designer']);
    assert.deepEqual(await duplicatesOf(second), [
      { originalId: first, title: 'Frontend-разработчик' },
    ]);
    assert.deepEqual(await duplicatesOf(first), []);
  });

  test('a publication whose roles are all duplicates leaves a row per role', async () => {
    const first = await addPublication(1);
    const second = await addPublication(2);
    const roles = [role('Frontend-разработчик'), role('QA Engineer'), role('Designer')];
    await saveVacancies(db, first, roles, { skipDuplicates: true });

    const summary = await saveVacancies(db, second, roles, { skipDuplicates: true });

    assert.equal(summary.saved, 0);
    assert.deepEqual(await duplicatesOf(second), [
      { originalId: first, title: 'Designer' },
      { originalId: first, title: 'Frontend-разработчик' },
      { originalId: first, title: 'QA Engineer' },
    ]);
  });

  test('a write without skipDuplicates clears the duplicates of the publication', async () => {
    const first = await addPublication(1);
    const second = await addPublication(2);
    await saveVacancies(db, first, [role('Frontend-разработчик')], { skipDuplicates: true });
    await saveVacancies(db, second, [role('Frontend-разработчик')], { skipDuplicates: true });

    await saveVacancies(db, second, [role('Frontend-разработчик')]);

    assert.deepEqual(await duplicatesOf(second), []);
  });

  test('duplicates are written in the transaction of the caller', async () => {
    const first = await addPublication(1);
    const second = await addPublication(2);
    await saveVacancies(db, first, [role('Frontend-разработчик')], { skipDuplicates: true });

    await assert.rejects(
      db.transaction(async (tx) => {
        await saveVacancies(tx, second, [role('Frontend-разработчик')], { skipDuplicates: true });
        throw new Error('rollback');
      }),
      /rollback/u,
    );

    assert.deepEqual(await duplicatesOf(second), []);
  });
});
