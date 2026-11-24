import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { enrich, SHORT_LINK_READER } from './enrich.ts';
import type { Enrichment } from './enrich.ts';
import { formatSection } from './section.ts';
import { fakeReader } from './test-utils.ts';
import type { FakeReaderOptions } from './test-utils.ts';

const jobId = (url: string): string | null => /\/jobs\/view\/(\d+)/u.exec(url)?.[1] ?? null;
const postId = (url: string): string | null => /activity-(\d+)/u.exec(url)?.[1] ?? null;

const job = (id: string): string => `https://www.linkedin.com/jobs/view/${id}/`;
const POST = 'https://www.linkedin.com/posts/acme_hiring-activity-7525883513603076096-IOJy';
const PROFILE = 'https://www.linkedin.com/in/jane-doe';
const short = (code: string): string => `https://lnkd.in/${code}`;

const JOB = 'linkedin-job';
const POST_READER = 'linkedin-post';

function jobs(options: Partial<FakeReaderOptions> = {}): ReturnType<typeof fakeReader> {
  return fakeReader({
    kind: JOB,
    label: 'Вакансия LinkedIn',
    match: jobId,
    items: { '1': 'Вакансия 1', '2': 'Вакансия 2', '3': 'Вакансия 3', '4': 'Вакансия 4' },
    ...options,
  });
}

function posts(options: Partial<FakeReaderOptions> = {}): ReturnType<typeof fakeReader> {
  return fakeReader({
    kind: POST_READER,
    label: 'Пост LinkedIn',
    match: postId,
    items: { '7525883513603076096': 'Пост' },
    ...options,
  });
}

/** Раскрытие без сети: короткая → адрес, ошибка или `null`; вызовы по порядку. */
function fakeExpand(targets: Readonly<Record<string, Error | string | null>>): {
  readonly expand: (url: string) => Promise<Error | string | null>;
  readonly calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    async expand(url) {
      await Promise.resolve();
      calls.push(url);
      return targets[url] ?? null;
    },
  };
}

/** Отчёт по ссылкам без ошибок: `[url, статус, читатель]`. */
function report(result: Enrichment | undefined): [string, string, string | null][] {
  assert.ok(result);
  return result.links.map(({ url, status, reader }) => [url, status, reader]);
}

describe('enrich', () => {
  test('reads each id once per call and appends sections in link order', async () => {
    const jobReader = jobs();
    const postReader = posts();
    const texts = [
      `Две ссылки на одну: [тут](${job('1')}) и ${job('1')}?trk=x.`,
      `Пост ${POST} и профиль ${PROFILE}`,
      `Снова ${job('1')}, теперь ещё ${POST}`,
      'Без ссылок',
    ];

    const result = await enrich(texts, { readers: [jobReader, postReader] });

    assert.deepEqual(jobReader.calls, [['1']]);
    assert.deepEqual(postReader.calls, [['7525883513603076096']]);
    assert.deepEqual(
      result.map(({ text }) => text),
      [
        texts[0] + formatSection('Вакансия LinkedIn', job('1'), 'Вакансия 1'),
        texts[1] + formatSection('Пост LinkedIn', POST, 'Пост'),
        texts[2] +
          formatSection('Вакансия LinkedIn', job('1'), 'Вакансия 1') +
          formatSection('Пост LinkedIn', POST, 'Пост'),
        'Без ссылок',
      ],
    );
    assert.deepEqual(report(result[0]), [
      [job('1'), 'read', JOB],
      [`${job('1')}?trk=x`, 'read', JOB],
    ]);
    assert.deepEqual(report(result[1]), [
      [POST, 'read', POST_READER],
      [PROFILE, 'unsupported', null],
    ]);
    assert.deepEqual(report(result[3]), []);
  });

  test('reads only the first three recognized links of a text and reports the rest', async () => {
    const jobReader = jobs();
    const text = `${PROFILE} ${job('1')} ${job('2')} ${job('3')} ${job('4')}`;

    const [result] = await enrich([text], { readers: [jobReader] });

    assert.deepEqual(jobReader.calls, [['1', '2', '3']]);
    assert.ok(result);
    assert.ok(!result.text.includes('Вакансия 4'));
    assert.deepEqual(report(result), [
      [PROFILE, 'unsupported', null],
      [job('1'), 'read', JOB],
      [job('2'), 'read', JOB],
      [job('3'), 'read', JOB],
      [job('4'), 'over_limit', JOB],
    ]);
  });

  test('counts links that already have a section toward the three', async () => {
    const jobReader = jobs();
    const text =
      `${job('1')} ${job('2')} ${job('3')} ${job('4')}` +
      formatSection('Вакансия LinkedIn', job('1'), 'Вакансия 1');

    const [result] = await enrich([text], { readers: [jobReader] });

    assert.deepEqual(jobReader.calls, [['2', '3']]);
    assert.deepEqual(report(result), [
      [job('1'), 'read', JOB],
      [job('2'), 'read', JOB],
      [job('3'), 'read', JOB],
      [job('4'), 'over_limit', JOB],
    ]);
  });

  test('gives a link that several readers recognize to the first of them', async () => {
    const first = jobs({ kind: 'first' });
    const second = jobs({ kind: 'second' });

    const [result] = await enrich([job('1')], { readers: [first, second] });

    assert.deepEqual(first.calls, [['1']]);
    assert.deepEqual(second.calls, []);
    assert.equal(
      result?.text,
      job('1') + formatSection('Вакансия LinkedIn', job('1'), 'Вакансия 1'),
    );
  });

  for (const throws of [false, true]) {
    test(`reports the links of a reader that ${throws ? 'throws' : 'returns an error'} as failed`, async () => {
      const text = `${job('1')} ${job('2')} ${POST}`;

      const [result] = await enrich([text], {
        readers: [jobs({ failCalls: 1, throws }), posts()],
      });

      assert.ok(result);
      assert.equal(result.text, text + formatSection('Пост LinkedIn', POST, 'Пост'));
      assert.deepEqual(report(result), [
        [job('1'), 'failed', JOB],
        [job('2'), 'failed', JOB],
        [POST, 'read', POST_READER],
      ]);
      assert.ok(result.links[0]?.error instanceof Error);
    });
  }

  test('reports a link without data and appends no section', async () => {
    const text = `Вакансии больше нет ${job('9')}`;

    const [result] = await enrich([text], { readers: [jobs()] });

    assert.equal(result?.text, text);
    assert.deepEqual(report(result), [[job('9'), 'no_data', JOB]]);
  });

  test('on retry reads only the links without a section', async () => {
    const jobReader = jobs();
    const postReader = posts({ failCalls: 1 });
    const text = `${job('1')} и ${POST}`;

    const [first] = await enrich([text], { readers: [jobReader, postReader] });
    assert.ok(first);

    const [retry] = await enrich([first.text], { readers: [jobReader, postReader] });

    assert.deepEqual(jobReader.calls, [['1']]);
    assert.deepEqual(postReader.calls, [['7525883513603076096'], ['7525883513603076096']]);
    assert.equal(
      retry?.text,
      text +
        formatSection('Вакансия LinkedIn', job('1'), 'Вакансия 1') +
        formatSection('Пост LinkedIn', POST, 'Пост'),
    );
    assert.deepEqual(report(retry), [
      [job('1'), 'read', JOB],
      [POST, 'read', POST_READER],
    ]);
  });

  test('does not read or report links inside appended sections', async () => {
    const jobReader = jobs();
    const text = `Пост ${POST}` + formatSection('Пост LinkedIn', POST, `Подробнее ${job('2')}`);

    const [result] = await enrich([text], { readers: [jobReader, posts()] });

    assert.deepEqual(jobReader.calls, []);
    assert.equal(result?.text, text);
    assert.deepEqual(report(result), [[POST, 'read', POST_READER]]);
  });

  describe('short links', () => {
    test('reads the page a short link leads to once and signs the section with the short link', async () => {
      const jobReader = jobs();
      const { expand, calls } = fakeExpand({ [short('a')]: job('1') });
      const texts = [`Вакансия ${short('a')}`, `Она же ${short('a')} и ${job('1')}`];

      const result = await enrich(texts, { readers: [jobReader], expandShortLink: expand });

      assert.deepEqual(calls, [short('a')]);
      assert.deepEqual(jobReader.calls, [['1']]);
      assert.deepEqual(
        result.map(({ text }) => text),
        texts.map((text) => text + formatSection('Вакансия LinkedIn', short('a'), 'Вакансия 1')),
      );
      assert.deepEqual(result[0]?.links, [
        { url: short('a'), target: job('1'), status: 'read', reader: JOB, error: null },
      ]);
      assert.deepEqual(report(result[1]), [
        [short('a'), 'read', JOB],
        [job('1'), 'read', JOB],
      ]);
    });

    test('reports short links that failed, lead nowhere or lead to an unknown page', async () => {
      const error = new Error('lnkd.in did not answer');
      const { expand } = fakeExpand({
        [short('err')]: error,
        [short('none')]: null,
        [short('out')]: 'https://example.com/careers',
      });
      const text = `${short('err')} ${short('none')} ${short('out')} ${job('2')}`;

      const [result] = await enrich([text], { readers: [jobs()], expandShortLink: expand });

      assert.equal(result?.text, text + formatSection('Вакансия LinkedIn', job('2'), 'Вакансия 2'));
      assert.deepEqual(result.links, [
        { url: short('err'), target: null, status: 'failed', reader: SHORT_LINK_READER, error },
        {
          url: short('none'),
          target: null,
          status: 'no_data',
          reader: SHORT_LINK_READER,
          error: null,
        },
        {
          url: short('out'),
          target: 'https://example.com/careers',
          status: 'unsupported',
          reader: null,
          error: null,
        },
        { url: job('2'), target: null, status: 'read', reader: JOB, error: null },
      ]);
    });

    test('expands at most ten short links of a text and reports the rest as over the limit', async () => {
      const codes = Array.from({ length: 11 }, (_, index) => `c${String(index)}`);
      const { expand, calls } = fakeExpand({});

      const [result] = await enrich([codes.map((code) => short(code)).join(' ')], {
        readers: [jobs()],
        expandShortLink: expand,
      });

      assert.equal(calls.length, 10);
      assert.deepEqual(report(result).at(-1), [short('c10'), 'over_limit', SHORT_LINK_READER]);
    });

    test('on retry does not expand a short link that has a section, but counts it toward the three', async () => {
      const jobReader = jobs();
      const { expand, calls } = fakeExpand({ [short('a')]: job('1') });
      const text =
        `${short('a')} ${job('2')} ${job('3')} ${job('4')}` +
        formatSection('Вакансия LinkedIn', short('a'), 'Вакансия 1');

      const [result] = await enrich([text], { readers: [jobReader], expandShortLink: expand });

      assert.deepEqual(calls, []);
      assert.deepEqual(jobReader.calls, [['2', '3']]);
      assert.deepEqual(report(result), [
        [short('a'), 'read', null],
        [job('2'), 'read', JOB],
        [job('3'), 'read', JOB],
        [job('4'), 'over_limit', JOB],
      ]);
    });
  });
});
