import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { ExtractedVacancy } from '@job-market/extractor';
import { MockLanguageModelV4 } from 'ai/test';

import type { PostProcessingModels } from './models.ts';
import { processPost } from './process-post.ts';
import type { Post } from './process-post.ts';

/** Модель, которая отвечает JSON текстом, как провайдер при structured outputs. */
function mockModel(output: unknown): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: 'text', text: JSON.stringify(output) }],
      finishReason: { unified: 'stop', raw: 'end_turn' },
      usage: {
        inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 20, text: 20, reasoning: 0 },
      },
      warnings: [],
    },
  });
}

function post(overrides: Partial<Post> = {}): Post {
  return {
    source: 'linkedin',
    externalId: '7330988768578920448',
    url: 'https://www.linkedin.com/posts/jane_hiring-activity-7330988768578920448',
    content:
      "We're hiring a Senior Frontend Engineer in Berlin, €80–95k. Apply: https://acme.dev/jobs",
    postedAt: new Date('2026-11-19T10:00:00.000Z'),
    authorName: 'Jane Doe',
    authorUrl: 'https://www.linkedin.com/in/jane',
    authorHeadline: 'Engineering Manager at Acme',
    authorHandle: 'jane',
    ...overrides,
  };
}

function extractedVacancy(overrides: Partial<ExtractedVacancy> = {}): ExtractedVacancy {
  return {
    title: 'Senior Frontend Engineer',
    company: 'Acme',
    companyUrl: null,
    hiringParty: 'employer',
    seniority: 'senior',
    workplace: 'onsite',
    isRemoteFromAnywhere: false,
    locations: ['Berlin'],
    employmentTypes: ['full_time'],
    salary: { min: 80_000, max: 95_000, currency: 'EUR', period: 'year', raw: '€80–95k' },
    skills: ['React', 'TypeScript'],
    relocation: null,
    visaSponsorship: null,
    apply: { urls: ['https://acme.dev/jobs'], emails: [], directMessage: false },
    summary: 'Фронтенд продукта Acme.',
    ...overrides,
  };
}

function models(
  classifierOutput: unknown,
  extractorOutput: unknown,
): {
  readonly models: PostProcessingModels;
  readonly classifier: MockLanguageModelV4;
  readonly extractor: MockLanguageModelV4;
} {
  const classifier = mockModel(classifierOutput);
  const extractor = mockModel(extractorOutput);
  return { models: { classifier, extractor }, classifier, extractor };
}

describe('processPost', () => {
  test('returns the post and vacancies as rows when the classifier says vacancy', async () => {
    const second = extractedVacancy({ title: 'QA Engineer', salary: null, seniority: null });
    const mocks = models(
      { verdict: 'vacancy', note: 'Нанимают фронтендера' },
      { vacancies: [extractedVacancy(), second] },
    );

    const result = await processPost(post(), mocks.models);

    assert.ok(!(result instanceof Error), result instanceof Error ? result.message : '');
    assert.ok(result.kind === 'vacancy');
    assert.deepEqual(result.post, post());
    assert.deepEqual(
      result.vacancies.map((vacancy) => [vacancy.position, vacancy.title]),
      [
        [0, 'Senior Frontend Engineer'],
        [1, 'QA Engineer'],
      ],
    );
    assert.deepEqual(
      {
        min: result.vacancies[0]?.salaryMin,
        max: result.vacancies[0]?.salaryMax,
        currency: result.vacancies[0]?.salaryCurrency,
        period: result.vacancies[0]?.salaryPeriod,
        raw: result.vacancies[0]?.salaryRaw,
      },
      { min: 80_000, max: 95_000, currency: 'EUR', period: 'year', raw: '€80–95k' },
    );
    assert.equal(result.vacancies[1]?.salaryRaw, null);
    // Пост доходит до обеих моделей.
    assert.match(JSON.stringify(mocks.classifier.doGenerateCalls[0]?.prompt), /Senior Frontend/u);
    assert.match(JSON.stringify(mocks.extractor.doGenerateCalls[0]?.prompt), /Senior Frontend/u);
    // Рассуждения выключены: их токены оплачиваются как выход. У экстрактора — в его тесте.
    assert.equal(mocks.classifier.doGenerateCalls[0]?.reasoning, 'none');
  });

  test('tells the models which source the post came from', async () => {
    const mocks = models({ verdict: 'not_hiring', note: 'Статья' }, null);

    await processPost(
      post({
        source: 'telegram',
        externalId: 'forproducts/10907',
        authorName: 'Job for Products and Projects',
        authorUrl: 'https://t.me/forproducts',
        authorHeadline: null,
        authorHandle: 'forproducts',
      }),
      mocks.models,
    );

    const prompt = JSON.stringify(mocks.classifier.doGenerateCalls[0]?.prompt);
    assert.match(prompt, /Источник: Telegram-канал/u);
    assert.match(prompt, /Автор: Job for Products and Projects/u);
    assert.doesNotMatch(prompt, /Подпись автора/u);
  });

  test('does not call the extractor when the post is not a vacancy', async () => {
    const mocks = models({ verdict: 'job_seeker', note: 'Автор ищет работу' }, null);

    const result = await processPost(
      post({ content: 'Open to work as a frontend developer' }),
      mocks.models,
    );

    assert.deepEqual(result, {
      kind: 'not_vacancy',
      reason: 'job_seeker',
      note: 'Автор ищет работу',
    });
    assert.equal(mocks.extractor.doGenerateCalls.length, 0);
  });

  test('skips posts without text without calling models', async () => {
    const mocks = models({ verdict: 'vacancy', note: '' }, null);

    const result = await processPost(post({ content: '  \n' }), mocks.models);

    assert.ok(!(result instanceof Error));
    assert.equal(result.kind, 'not_vacancy');
    assert.equal(mocks.classifier.doGenerateCalls.length, 0);
  });

  test('returns an error when the classifier answer does not match the schema', async () => {
    const mocks = models({ verdict: 'maybe', note: '' }, null);

    const result = await processPost(post(), mocks.models);

    assert.ok(result instanceof Error);
    assert.match(result.message, /classification failed/u);
    assert.equal(mocks.extractor.doGenerateCalls.length, 0);
  });

  test('returns an error when the extractor finds no roles in a vacancy post', async () => {
    const mocks = models({ verdict: 'vacancy', note: '' }, { vacancies: [] });

    const result = await processPost(post(), mocks.models);

    assert.ok(result instanceof Error);
    assert.match(result.message, /Post 7330988768578920448 vacancy extraction failed/u);
  });

  test('returns an error when the model provider fails', async () => {
    const classifier = new MockLanguageModelV4({
      doGenerate: () => Promise.reject(new Error('Gateway unavailable')),
    });
    const extractor = new MockLanguageModelV4();

    const result = await processPost(post(), { classifier, extractor });

    assert.ok(result instanceof Error);
    assert.match(result.message, /classification failed/u);
  });
});
