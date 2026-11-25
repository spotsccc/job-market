import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { asc, eq, inArray, like } from 'drizzle-orm';

import { db, getDb } from '../client.ts';
import {
  platforms,
  publicationLinks,
  publications,
  sourceRuns,
  sources,
} from '../publication/index.ts';
import type { NewPublicationRow } from '../publication/index.ts';
import { vacancies, vacancyDuplicates } from '../vacancy/index.ts';
import type { NewVacancyRow } from '../vacancy/index.ts';
import { events, sources as monitoringSources } from './monitoring.ts';

/**
 * Тесты идут в тестовую базу из `apps/web/.env.test`: `pnpm db:up && pnpm db:migrate:test`. На той
 * же базе параллельно идут тесты других файлов, поэтому у теста своя площадка и свои источники,
 * а события читаются только по их `source_id` (E3 плана мониторинга).
 */
const PREFIX = 'test_db_monitoring_';
const PLATFORM = 'test-monitoring';

const BASE = new Date('2026-11-20T00:00:00.000Z').getTime();
/** Момент через `minutes` минут после начала суток теста: у каждого события своё время. */
const at = (minutes: number): Date => new Date(BASE + minutes * 60 * 1000);

let ids: { a: string; b: string } = { a: '', b: '' };

async function addSource(suffix: string, platform: string): Promise<string> {
  const [row] = await db
    .insert(sources)
    .values({
      connector: 'open-telegram',
      key: `${PREFIX}${suffix}`,
      platform,
      name: `Источник ${suffix}`,
    })
    .returning({ id: sources.id });
  assert.ok(row !== undefined);
  return row.id;
}

async function addPublication(
  sourceId: string,
  number: number,
  overrides: Partial<NewPublicationRow>,
): Promise<string> {
  const [row] = await db
    .insert(publications)
    .values({
      sourceId,
      connector: 'open-telegram',
      externalId: `${PREFIX}${String(number)}`,
      url: `https://t.me/${PREFIX}/${String(number)}`,
      content: 'Ищем фронтендера',
      postedAt: at(0),
      contentHash: `${PREFIX}${String(number)}`,
      ...overrides,
    })
    .returning({ id: publications.id });
  assert.ok(row !== undefined);
  return row.id;
}

function vacancy(publicationId: string, position: number, minutes: number): NewVacancyRow {
  return {
    publicationId,
    position,
    schemaVersion: 2,
    title: `Роль ${String(position)}`,
    hiringParty: 'employer',
    occupationId: 'root',
    isRemoteFromAnywhere: false,
    apply: { urls: [], emails: [], directMessage: true },
    summary: 'Делать продукт.',
    createdAt: at(minutes),
  };
}

async function removeRows(): Promise<void> {
  const ours = db
    .select({ id: sources.id })
    .from(sources)
    .where(like(sources.key, `${PREFIX}%`));
  await db.delete(publications).where(inArray(publications.sourceId, ours));
  // Строки истории опросов удаляются вместе с источником (ON DELETE CASCADE).
  await db.delete(sources).where(like(sources.key, `${PREFIX}%`));
  await db.delete(platforms).where(eq(platforms.id, PLATFORM));
}

before(async () => {
  await removeRows();
  await db.insert(platforms).values({ id: PLATFORM, name: 'Test monitoring' });
  ids = { a: await addSource('a', PLATFORM), b: await addSource('b', 'geekjobs') };
  const { a, b } = ids;

  const original = await addPublication(b, 1, { status: 'vacancy', createdAt: at(1) });
  const found = await addPublication(a, 2, { status: 'vacancy', createdAt: at(2) });
  await addPublication(a, 3, {
    status: 'not_vacancy',
    notVacancyReason: 'trash',
    note: 'реклама курса',
    createdAt: at(3),
    processedAt: at(30),
  });
  await addPublication(a, 4, {
    status: 'duplicate',
    duplicateOfId: original,
    createdAt: at(4),
    processedAt: at(40),
  });
  await addPublication(a, 5, {
    status: 'failed',
    attempts: 3,
    lastError: 'Model timed out',
    createdAt: at(5),
    processedAt: at(50),
  });
  await addPublication(a, 6, { status: 'pending', attempts: 1, createdAt: at(6) });
  await addPublication(a, 7, {
    status: 'processing',
    attempts: 2,
    lastError: 'Model timed out',
    createdAt: at(7),
  });

  await db.insert(vacancies).values([vacancy(found, 0, 20), vacancy(found, 1, 21)]);
  await db.insert(vacancyDuplicates).values({
    publicationId: found,
    originalId: original,
    title: 'Frontend-разработчик',
    createdAt: at(22),
  });
  await db.insert(publicationLinks).values([
    {
      publicationId: found,
      position: 0,
      url: 'https://www.linkedin.com/jobs/view/1',
      host: 'linkedin.com',
      status: 'failed',
      error: 'HTTP 999',
    },
    {
      publicationId: found,
      position: 1,
      url: 'https://example.com/job',
      host: 'example.com',
      status: 'read',
      reader: 'html',
    },
  ]);
  await db.insert(sourceRuns).values([
    { sourceId: a, status: 'done', inserted: 6, startedAt: at(60), finishedAt: at(61) },
    { sourceId: a, status: 'more', inserted: 0, startedAt: at(62), finishedAt: at(63) },
    {
      sourceId: a,
      status: 'failed',
      inserted: 3,
      error: 'HTTP 503',
      startedAt: at(64),
      finishedAt: at(65),
    },
  ]);
});

after(async () => {
  await removeRows();
  await getDb().$client.end();
});

describe('monitoring.events', () => {
  test('counts each kind of event by its own time, source and detail', async () => {
    const rows = await db
      .select({
        at: events.at,
        kind: events.kind,
        sourceId: events.sourceId,
        source: events.source,
        platform: events.platform,
        detail: events.detail,
      })
      .from(events)
      .where(inArray(events.sourceId, [ids.a, ids.b]))
      .orderBy(asc(events.at), asc(events.kind));

    const fromA = { sourceId: ids.a, source: 'Источник a', platform: PLATFORM };
    const fromB = { sourceId: ids.b, source: 'Источник b', platform: 'geekjobs' };
    const publication = (minutes: number) => ({
      at: at(minutes),
      kind: 'publication',
      detail: null,
      ...fromA,
    });
    assert.deepEqual(rows, [
      { at: at(1), kind: 'publication', detail: null, ...fromB },
      // Ссылка своего времени не имеет: её событие — во время записи публикации (П4).
      { at: at(2), kind: 'link_error', detail: 'linkedin.com', ...fromA },
      publication(2),
      publication(3),
      publication(4),
      publication(5),
      publication(6),
      publication(7),
      { at: at(20), kind: 'vacancy', detail: null, ...fromA },
      { at: at(21), kind: 'vacancy', detail: null, ...fromA },
      { at: at(22), kind: 'vacancy_duplicate', detail: 'Frontend-разработчик', ...fromA },
      { at: at(30), kind: 'not_vacancy', detail: 'trash', ...fromA },
      // Дубль — под своим источником, а не под источником оригинала (П5).
      { at: at(40), kind: 'duplicate', detail: null, ...fromA },
      { at: at(50), kind: 'extraction_error', detail: 'Model timed out', ...fromA },
      // Проход упал, хоть и записал публикации; done и more — не ошибки (П3).
      { at: at(65), kind: 'parse_error', detail: 'HTTP 503', ...fromA },
    ]);
  });
});

describe('monitoring.sources', () => {
  test('lists sources with their platforms', async () => {
    const rows = await db
      .select()
      .from(monitoringSources)
      .where(inArray(monitoringSources.id, [ids.a, ids.b]))
      .orderBy(asc(monitoringSources.name));

    assert.deepEqual(rows, [
      {
        id: ids.a,
        name: 'Источник a',
        platform: PLATFORM,
        connector: 'open-telegram',
        enabled: true,
      },
      {
        id: ids.b,
        name: 'Источник b',
        platform: 'geekjobs',
        connector: 'open-telegram',
        enabled: true,
      },
    ]);
  });
});
