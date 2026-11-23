import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { PublicationForModel } from '@job-market/publication-text';
import { MockLanguageModelV4 } from 'ai/test';

import { extract } from './extract.ts';
import type { ExtractedVacancy } from './vacancy.ts';

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

const publication: PublicationForModel = {
  connector: 'linkedin',
  content:
    "We're hiring a Senior Frontend Engineer in Berlin, €80–95k. Apply: https://acme.dev/jobs",
  postedAt: new Date('2026-11-19T10:00:00.000Z'),
  author: {
    name: 'Jane Doe',
    url: 'https://www.linkedin.com/in/jane',
    headline: 'Engineering Manager at Acme',
  },
};

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

describe('extract', () => {
  test('returns the roles in the order of the answer', async () => {
    const second = extractedVacancy({ title: 'QA Engineer', salary: null, seniority: null });
    const model = mockModel({ vacancies: [extractedVacancy(), second] });

    const result = await extract(publication, model);

    assert.ok(!(result instanceof Error), result instanceof Error ? result.message : '');
    assert.deepEqual(
      result.map((vacancy) => vacancy.title),
      ['Senior Frontend Engineer', 'QA Engineer'],
    );
    const call = model.doGenerateCalls[0];
    // Модель видит публикацию в общем формате, без рассуждений: их токены оплачиваются как выход.
    assert.match(JSON.stringify(call?.prompt), /Источник: LinkedIn/u);
    assert.match(JSON.stringify(call?.prompt), /Senior Frontend/u);
    assert.equal(call?.reasoning, 'none');
  });

  test('returns an error when the answer has no roles', async () => {
    const result = await extract(publication, mockModel({ vacancies: [] }));

    assert.ok(result instanceof Error);
    assert.match(result.message, /Vacancy extraction failed/u);
  });

  test('returns an error when the answer does not match the schema', async () => {
    const result = await extract(
      publication,
      mockModel({ vacancies: [extractedVacancy({ title: '  ' })] }),
    );

    assert.ok(result instanceof Error);
  });

  test('returns an error when the model provider fails', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: () => Promise.reject(new Error('Gateway unavailable')),
    });

    const result = await extract(publication, model);

    assert.ok(result instanceof Error);
    assert.match(result.message, /Vacancy extraction failed/u);
  });
});
