import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { enrich } from './enrich.ts';
import { formatSection } from './section.ts';
import { fakeReader } from './test-utils.ts';
import type { FakeReaderOptions } from './test-utils.ts';

const jobId = (url: string): string | null => /\/jobs\/view\/(\d+)/u.exec(url)?.[1] ?? null;
const postId = (url: string): string | null => /activity-(\d+)/u.exec(url)?.[1] ?? null;

const job = (id: string): string => `https://www.linkedin.com/jobs/view/${id}/`;
const POST = 'https://www.linkedin.com/posts/acme_hiring-activity-7525883513603076096-IOJy';
const PROFILE = 'https://www.linkedin.com/in/jane-doe';

function jobs(options: Partial<FakeReaderOptions> = {}): ReturnType<typeof fakeReader> {
  return fakeReader({
    kind: 'linkedin-job',
    label: 'Вакансия LinkedIn',
    match: jobId,
    items: { '1': 'Вакансия 1', '2': 'Вакансия 2', '3': 'Вакансия 3', '4': 'Вакансия 4' },
    ...options,
  });
}

function posts(options: Partial<FakeReaderOptions> = {}): ReturnType<typeof fakeReader> {
  return fakeReader({
    kind: 'linkedin-post',
    label: 'Пост LinkedIn',
    match: postId,
    items: { '7525883513603076096': 'Пост' },
    ...options,
  });
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
    assert.deepEqual(result, [
      {
        text: texts[0] + formatSection('Вакансия LinkedIn', job('1'), 'Вакансия 1'),
        failures: [],
      },
      { text: texts[1] + formatSection('Пост LinkedIn', POST, 'Пост'), failures: [] },
      {
        text:
          texts[2] +
          formatSection('Вакансия LinkedIn', job('1'), 'Вакансия 1') +
          formatSection('Пост LinkedIn', POST, 'Пост'),
        failures: [],
      },
      { text: 'Без ссылок', failures: [] },
    ]);
  });

  test('reads only the first three recognized links of a text', async () => {
    const jobReader = jobs();
    const text = `${PROFILE} ${job('1')} ${job('2')} ${job('3')} ${job('4')}`;

    const [result] = await enrich([text], { readers: [jobReader] });

    assert.deepEqual(jobReader.calls, [['1', '2', '3']]);
    assert.ok(result);
    assert.ok(!result.text.includes('Вакансия 4'));
  });

  test('counts links that already have a section toward the three', async () => {
    const jobReader = jobs();
    const text =
      `${job('1')} ${job('2')} ${job('3')} ${job('4')}` +
      formatSection('Вакансия LinkedIn', job('1'), 'Вакансия 1');

    await enrich([text], { readers: [jobReader] });

    assert.deepEqual(jobReader.calls, [['2', '3']]);
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
    test(`fails the links of a reader that ${throws ? 'throws' : 'returns an error'}`, async () => {
      const text = `${job('1')} ${job('2')} ${POST}`;

      const [result] = await enrich([text], {
        readers: [jobs({ failCalls: 1, throws }), posts()],
      });

      assert.ok(result);
      assert.equal(result.text, text + formatSection('Пост LinkedIn', POST, 'Пост'));
      assert.deepEqual(
        result.failures.map(({ url, kind, id }) => ({ url, kind, id })),
        [
          { url: job('1'), kind: 'linkedin-job', id: '1' },
          { url: job('2'), kind: 'linkedin-job', id: '2' },
        ],
      );
      assert.ok(result.failures.every(({ error }) => error instanceof Error));
    });
  }

  test('skips a link without data and reports no failure', async () => {
    const text = `Вакансии больше нет ${job('9')}`;

    const result = await enrich([text], { readers: [jobs()] });

    assert.deepEqual(result, [{ text, failures: [] }]);
  });

  test('on retry reads only the links without a section', async () => {
    const jobReader = jobs();
    const postReader = posts({ failCalls: 1 });
    const text = `${job('1')} и ${POST}`;

    const [first] = await enrich([text], { readers: [jobReader, postReader] });
    assert.ok(first);
    assert.equal(first.failures.length, 1);

    const [retry] = await enrich([first.text], { readers: [jobReader, postReader] });

    assert.deepEqual(jobReader.calls, [['1']]);
    assert.deepEqual(postReader.calls, [['7525883513603076096'], ['7525883513603076096']]);
    assert.deepEqual(retry, {
      text:
        text +
        formatSection('Вакансия LinkedIn', job('1'), 'Вакансия 1') +
        formatSection('Пост LinkedIn', POST, 'Пост'),
      failures: [],
    });
  });

  test('does not read links inside appended sections', async () => {
    const jobReader = jobs();
    const text = `Пост ${POST}` + formatSection('Пост LinkedIn', POST, `Подробнее ${job('2')}`);

    const result = await enrich([text], { readers: [jobReader, posts()] });

    assert.deepEqual(jobReader.calls, []);
    assert.deepEqual(result, [{ text, failures: [] }]);
  });
});
