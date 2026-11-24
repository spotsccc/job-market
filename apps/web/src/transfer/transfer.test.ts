// oxlint-disable max-lines -- сценарии переноса делят одну тестовую базу и помощники
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

import {
  asc,
  authors,
  contentHash,
  db,
  eq,
  getDb,
  inArray,
  legacyPosts,
  like,
  publicationLinks,
  publications,
  sources,
  vacancies,
  vacancyLocations,
} from '@job-market/db';
import type { NewLegacyPostRow, PublicationLinkRow, PublicationRow } from '@job-market/db';
import type { Reader } from '@job-market/enricher';
import { fakeReader } from '@job-market/enricher/test-utils';
import { MockLanguageModelV4 } from 'ai/test';

import { transferPosts } from './transfer.ts';
import type { TransferOptions, TransferSummary } from './transfer.ts';

/**
 * Тесты идут в тестовую базу из `.env.test`: `pnpm db:up && pnpm db:migrate:test`. Посты теста
 * датированы 2001 годом: они старше постов других тестов, и запуск с `limit` берёт только их.
 */

const PREFIX = 'transfer-test';
const CHANNEL_A = `${PREFIX}-a`;
const CHANNEL_B = `${PREFIX}-b`;

/** Что модель отвечает на текст: по маркеру в посте. */
type Answer = 'role' | 'two_roles' | 'no_roles' | 'throw';

type ModelMock = {
  readonly model: MockLanguageModelV4;
  /** Тексты, на которые модель вызвана, по порядку. */
  readonly prompts: string[];
};

function role(title: string): unknown {
  return {
    title,
    company: 'Acme',
    companyUrl: null,
    hiringParty: 'employer',
    occupation: 'root',
    suggestedOccupation: null,
    seniority: null,
    experienceYearsMin: null,
    workplace: 'onsite',
    places: [{ role: 'office', city: 'Berlin', country: 'Germany', region: null, raw: 'Berlin' }],
    employmentTypes: [],
    salary: null,
    equity: null,
    skills: [],
    niceSkills: [],
    languages: [],
    relocation: null,
    visaSponsorship: null,
    apply: { urls: [], emails: [], directMessage: true },
    summary: 'Делать продукт.',
    responsibilities: [],
    requirements: [],
    benefits: [],
  };
}

const ANSWERS: Readonly<Record<Exclude<Answer, 'throw'>, unknown>> = {
  role: { vacancies: [role('Engineer')] },
  two_roles: { vacancies: [role('Frontend'), role('QA')] },
  no_roles: { vacancies: [] },
};

/**
 * Модель отвечает по маркеру `[answer]` в тексте поста; без маркера — одна роль. `decide`
 * меняет ответ на ходу: так пост падает в первом запуске и проходит во втором.
 */
const ANSWER_NAMES: readonly Answer[] = ['role', 'two_roles', 'no_roles', 'throw'];

function modelMock(
  decide: (prompt: string) => Answer | null | Promise<null> = () => null,
): ModelMock {
  const prompts: string[] = [];
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      const prompt = JSON.stringify(options.prompt);
      prompts.push(prompt);
      const marker = /\[(two_roles|no_roles|throw|role)\]/u.exec(prompt)?.[1];
      const answer =
        (await decide(prompt)) ?? ANSWER_NAMES.find((name) => name === marker) ?? 'role';
      if (answer === 'throw') throw new Error('Gateway timeout');
      return {
        content: [{ type: 'text', text: JSON.stringify(ANSWERS[answer]) }],
        finishReason: { unified: 'stop', raw: 'end_turn' },
        usage: {
          inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 20, text: 20, reasoning: 0 },
        },
        warnings: [],
      };
    },
  });
  return { model, prompts };
}

let postNumber = 0;

function legacyPost(content: string, overrides: Partial<NewLegacyPostRow> = {}): NewLegacyPostRow {
  postNumber += 1;
  const channel = overrides.externalId?.split('/')[0] ?? CHANNEL_A;
  return {
    source: 'telegram',
    externalId: `${channel}/${String(postNumber)}`,
    url: `https://t.me/${channel}/${String(postNumber)}`,
    content,
    postedAt: new Date(Date.UTC(2001, 0, 1, 0, postNumber)),
    authorName: channel,
    authorUrl: `https://t.me/${channel}`,
    authorHeadline: null,
    authorHandle: channel,
    ...overrides,
  };
}

/** Вставляет посты; ответ — их id по порядку. */
async function insertPosts(posts: readonly NewLegacyPostRow[]): Promise<string[]> {
  const rows = await db
    .insert(legacyPosts)
    .values([...posts])
    .returning({ id: legacyPosts.id, postedAt: legacyPosts.postedAt });
  return rows.toSorted((a, b) => a.postedAt.getTime() - b.postedAt.getTime()).map((row) => row.id);
}

async function findPublication(id: string): Promise<PublicationRow | undefined> {
  const [row] = await db.select().from(publications).where(eq(publications.id, id));
  return row;
}

/** Ссылки публикации по порядку, без её id и номера. */
async function linksOf(
  id: string,
): Promise<Pick<PublicationLinkRow, 'url' | 'host' | 'status' | 'reader' | 'error'>[]> {
  return db
    .select({
      url: publicationLinks.url,
      host: publicationLinks.host,
      status: publicationLinks.status,
      reader: publicationLinks.reader,
      error: publicationLinks.error,
    })
    .from(publicationLinks)
    .where(eq(publicationLinks.publicationId, id))
    .orderBy(asc(publicationLinks.position));
}

async function publicationOf(id: string): Promise<PublicationRow> {
  const row = await findPublication(id);
  assert.ok(row !== undefined, `publication ${id} is missing`);
  return row;
}

async function vacancyTitles(publicationId: string): Promise<string[]> {
  const rows = await db
    .select({ title: vacancies.title, schemaVersion: vacancies.schemaVersion })
    .from(vacancies)
    .where(eq(vacancies.publicationId, publicationId))
    .orderBy(asc(vacancies.position));
  return rows.map((row) => `${row.title} v${String(row.schemaVersion)}`);
}

const noReaders: readonly Reader[] = [];

async function run(
  options: Partial<TransferOptions> & { model: MockLanguageModelV4 },
): Promise<TransferSummary> {
  return transferPosts({ db, readers: noReaders, ...options });
}

async function removeTestRows(): Promise<void> {
  const posts = await db
    .select({ id: legacyPosts.id })
    .from(legacyPosts)
    .where(like(legacyPosts.externalId, `${PREFIX}%`));
  const ids = posts.map((post) => post.id);
  if (ids.length > 0) {
    // Копии ссылаются на оригинал: сначала они, потом остальные.
    await db.update(publications).set({ duplicateOfId: null }).where(inArray(publications.id, ids));
    await db.delete(publications).where(inArray(publications.id, ids));
  }
  await db.delete(legacyPosts).where(like(legacyPosts.externalId, `${PREFIX}%`));
  await db.delete(authors).where(like(authors.externalId, `${PREFIX}%`));
}

describe('transferPosts', () => {
  before(async () => {
    await removeTestRows();
    await db.delete(sources).where(like(sources.key, `${PREFIX}%`));
    await db.insert(sources).values(
      [CHANNEL_A, CHANNEL_B].map((key) => ({
        connector: 'open-telegram' as const,
        key,
        platform: 'geekjobs',
        name: key,
        enabled: false,
      })),
    );
  });

  beforeEach(async () => {
    await removeTestRows();
  });

  after(async () => {
    await removeTestRows();
    await db.delete(sources).where(like(sources.key, `${PREFIX}%`));
    await getDb().$client.end();
  });

  test('a run writes vacancies, copies, failures and empty posts; no roles is a failure', async () => {
    const text = 'Ищем фронтендера и QA [two_roles]';
    const [a, b, c, d, e] = await insertPosts([
      legacyPost(text),
      legacyPost(`${text}\n**Больше вакансий в HR:** https://t.me/forhr`, {
        externalId: `${CHANNEL_B}/x`,
      }),
      legacyPost('Ищем аналитика [throw]'),
      legacyPost('Мы растём [no_roles]'),
      legacyPost(''),
    ]);
    assert.ok(
      a !== undefined && b !== undefined && c !== undefined && d !== undefined && e !== undefined,
    );
    const mock = modelMock();

    const summary = await run({ model: mock.model, limit: 5 });

    const pa = await publicationOf(a);
    assert.equal(pa.status, 'vacancy');
    assert.equal(pa.connector, 'open-telegram');
    assert.deepEqual(await vacancyTitles(a), ['Frontend v2', 'QA v2']);
    const places = await db
      .select({ cityId: vacancyLocations.cityId })
      .from(vacancyLocations)
      .innerJoin(vacancies, eq(vacancies.id, vacancyLocations.vacancyId))
      .where(eq(vacancies.publicationId, a));
    assert.deepEqual(places, [{ cityId: 2_950_159 }, { cityId: 2_950_159 }]);

    const pb = await publicationOf(b);
    assert.equal(pb.status, 'duplicate');
    assert.equal(pb.duplicateOfId, a);
    const pc = await publicationOf(c);
    assert.equal(pc.status, 'failed');
    assert.equal(pc.attempts, 1);
    assert.match(pc.lastError ?? '', /Gateway timeout/u);
    const pd = await publicationOf(d);
    assert.equal(pd.status, 'failed');
    assert.match(pd.lastError ?? '', /Vacancy extraction failed/u);
    const pe = await publicationOf(e);
    assert.deepEqual([pe.status, pe.notVacancyReason], ['not_vacancy', 'not_hiring']);

    // Модель не видит копию и пустой пост (П4, П5, E7).
    assert.equal(mock.prompts.length, 3);
    assert.deepEqual(
      [
        summary.posts,
        summary.vacancies,
        summary.duplicates,
        summary.notVacancy,
        summary.errors.length,
      ],
      [5, 2, 1, 1, 2],
    );
  });

  test('a failed post is retried until it has failed three times', async () => {
    const [c] = await insertPosts([legacyPost('Ищем аналитика [throw]')]);
    assert.ok(c !== undefined);
    const mock = modelMock();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      // oxlint-disable-next-line no-await-in-loop -- запуски идут один за другим
      await run({ model: mock.model, limit: 1 });
    }
    assert.equal((await publicationOf(c)).attempts, 3);

    const [z] = await insertPosts([legacyPost('Ищем дизайнера')]);
    assert.ok(z !== undefined);
    await run({ model: mock.model, limit: 1 });

    assert.equal((await publicationOf(c)).attempts, 3);
    assert.equal((await publicationOf(z)).status, 'vacancy');
  });

  test('a post that failed in the first batch is not taken again in the same run', async () => {
    const posts = [
      legacyPost('Ищем аналитика [throw]'),
      ...Array.from({ length: 20 }, (_, index) => legacyPost(`Вакансия ${String(index)}`)),
    ];
    const [c] = await insertPosts(posts);
    assert.ok(c !== undefined);
    const mock = modelMock();

    const summary = await run({ model: mock.model, limit: 21 });

    assert.equal(summary.posts, 21);
    assert.equal(mock.prompts.filter((prompt) => prompt.includes('[throw]')).length, 1);
    assert.equal((await publicationOf(c)).attempts, 1);
  });

  test('a copy waits for the next run when its original fails in the same batch', async () => {
    const text = 'Ищем PM [role]';
    const [g, f] = await insertPosts([
      legacyPost(text),
      legacyPost(text, { externalId: `${CHANNEL_B}/x` }),
    ]);
    assert.ok(g !== undefined && f !== undefined);
    let failing = true;
    const mock = modelMock(() => (failing ? 'throw' : null));

    const first = await run({ model: mock.model, limit: 2 });

    assert.equal((await publicationOf(g)).status, 'failed');
    assert.equal(await findPublication(f), undefined);
    assert.equal(first.postponed, 1);

    failing = false;
    await run({ model: mock.model, limit: 2 });

    assert.equal((await publicationOf(g)).status, 'vacancy');
    const copy = await publicationOf(f);
    assert.deepEqual([copy.status, copy.duplicateOfId], ['duplicate', g]);
  });

  test('a dry run tries every post once, writes nothing and reports the same summary', async () => {
    const ids = await insertPosts(
      Array.from({ length: 25 }, (_, index) =>
        legacyPost(index === 3 ? 'Ищем [two_roles]' : `Вакансия ${String(index)}`),
      ),
    );
    const mock = modelMock();

    const dry = await run({ model: mock.model, limit: 25, dryRun: true });

    assert.equal(dry.posts, 25);
    assert.equal(new Set(mock.prompts).size, 25);
    const written = await db.select().from(publications).where(inArray(publications.id, ids));
    assert.equal(written.length, 0);

    const real = await run({ model: mock.model, limit: 25 });
    assert.deepEqual(
      [dry.posts, dry.vacancies, dry.duplicates, dry.errors.length],
      [real.posts, real.vacancies, real.duplicates, real.errors.length],
    );
  });

  test('limit 1 takes the oldest post', async () => {
    const [oldest, newer] = await insertPosts([legacyPost('Ищем A'), legacyPost('Ищем B')]);
    assert.ok(oldest !== undefined && newer !== undefined);

    await run({ model: modelMock().model, limit: 1 });

    assert.equal((await publicationOf(oldest)).status, 'vacancy');
    assert.equal(await findPublication(newer), undefined);
  });

  test('links are read before the extractor and a link that failed does not stop the post', async () => {
    const link = 'https://www.linkedin.com/jobs/view/111/';
    const original = `Ищем фронтендера ${link} https://example.com/careers`;
    const [read, failed] = await insertPosts([
      legacyPost(original),
      legacyPost('Ищем бэкендера https://www.linkedin.com/jobs/view/222/'),
    ]);
    assert.ok(read !== undefined && failed !== undefined);
    const reader = fakeReader({
      kind: 'linkedin-job',
      match: (url) => /jobs\/view\/(\d+)/u.exec(url)?.[1] ?? null,
      label: 'Вакансия LinkedIn',
      items: { '111': 'Senior Frontend в Acme' },
    });
    const broken = fakeReader({
      kind: 'linkedin-job',
      match: (url) => /jobs\/view\/(222)/u.exec(url)?.[1] ?? null,
      failCalls: 1,
    });
    const mock = modelMock();

    const summary = await run({ model: mock.model, limit: 2, readers: [broken, reader] });

    const pRead = await publicationOf(read);
    assert.equal(pRead.status, 'vacancy');
    assert.match(pRead.content, /--- Вакансия LinkedIn по ссылке .+\nSenior Frontend в Acme/u);
    assert.equal(pRead.contentHash, contentHash(original));
    assert.ok(mock.prompts.some((prompt) => prompt.includes('Senior Frontend в Acme')));
    // Ссылка не прочиталась: пост перенесён по своему тексту, ссылка — failed.
    const pFailed = await publicationOf(failed);
    assert.equal(pFailed.status, 'vacancy');
    assert.doesNotMatch(pFailed.content, /---/u);
    assert.deepEqual(await linksOf(read), [
      { url: link, host: 'www.linkedin.com', status: 'read', reader: 'linkedin-job', error: null },
      {
        url: 'https://example.com/careers',
        host: 'example.com',
        status: 'unsupported',
        reader: null,
        error: null,
      },
    ]);
    const failedLinks = await linksOf(failed);
    assert.deepEqual(
      failedLinks.map(({ status }) => status),
      ['failed'],
    );
    assert.match(failedLinks.map(({ error }) => error).join(), /Fake reader failed/u);
    assert.deepEqual(
      [summary.links.read, summary.links.failed, summary.links.unsupported, summary.errors.length],
      [1, 1, 1, 0],
    );
  });

  test('a publication written by another run is counted and not duplicated', async () => {
    const [a] = await insertPosts([legacyPost('Ищем A [two_roles]')]);
    assert.ok(a !== undefined);
    const [source] = await db
      .select({ id: sources.id })
      .from(sources)
      .where(eq(sources.key, CHANNEL_A));
    assert.ok(source !== undefined);
    const [post] = await db.select().from(legacyPosts).where(eq(legacyPosts.id, a));
    assert.ok(post !== undefined);
    // Другой запуск пишет публикацию, пока этот ждёт модель.
    const mock = modelMock(async () => {
      await db.insert(publications).values({
        id: a,
        sourceId: source.id,
        connector: 'open-telegram',
        externalId: post.externalId,
        url: post.url,
        content: post.content,
        postedAt: post.postedAt,
        contentHash: 'other-run',
        status: 'vacancy',
      });
      return null;
    });

    const summary = await run({ model: mock.model, limit: 1 });

    assert.equal(summary.alreadyTransferred, 1);
    assert.deepEqual(await vacancyTitles(a), []);
  });

  test('posts without roles are failures but do not stop the run', async () => {
    const ids = await insertPosts([
      legacyPost('Подкаст [no_roles]'),
      legacyPost('Статья [no_roles]'),
    ]);
    const mock = modelMock();

    const summary = await run({ model: mock.model, limit: 2 });

    assert.equal(summary.stopped, null);
    assert.equal(summary.errors.length, 2);
    for (const id of ids) {
      // oxlint-disable-next-line no-await-in-loop -- две проверки по очереди
      const publication = await publicationOf(id);
      assert.deepEqual([publication.status, publication.attempts], ['failed', 1]);
    }
  });

  test('a run stops after a batch in which every model call failed', async () => {
    await insertPosts(
      Array.from({ length: 21 }, (_, index) => legacyPost(`Вакансия ${String(index)}`)),
    );
    const mock = modelMock(() => 'throw');

    const summary = await run({ model: mock.model, limit: 21 });

    assert.equal(summary.posts, 20);
    assert.equal(mock.prompts.length, 20);
    assert.match(summary.stopped ?? '', /все вызовы модели упали/u);
  });
});
