import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { PublicationForModel } from '@job-market/publication-text';
import { MockLanguageModelV4 } from 'ai/test';

import { extract } from './extract.ts';
import type { OccupationNode } from './occupations.ts';
import type { ModelVacancy } from './vacancy.ts';

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

const node = (id: string, parentId: string | null, description: string): OccupationNode => ({
  id,
  parentId,
  name: id,
  description,
});

const TREE: readonly OccupationNode[] = [
  node('frontend', 'engineering', 'Интерфейсы в браузере.'),
  node('root', null, 'Без профессии.'),
  node('engineering', 'it', 'Разработчики без понятного направления.'),
  node('it', 'root', 'Софт и инфраструктура.'),
];

/** Текст сценария S1 плана vacancy-extraction. */
const publication: PublicationForModel = {
  connector: 'open-telegram',
  content:
    'Senior Frontend (React, TypeScript), 5+ years. Remote from EU or office in Berlin. English B2. Nice to have: Next.js. €70–90k gross',
  postedAt: new Date('2026-11-19T10:00:00.000Z'),
  author: { name: 'forhr', url: 'https://t.me/forhr', headline: null },
};

function modelVacancy(overrides: Partial<ModelVacancy> = {}): ModelVacancy {
  return {
    title: 'Senior Frontend',
    company: null,
    companyUrl: null,
    hiringParty: 'unknown',
    occupation: 'frontend',
    suggestedOccupation: null,
    seniority: 'senior',
    experienceYearsMin: 5,
    workplace: 'hybrid',
    places: [
      { role: 'hiring', city: null, country: null, region: 'ЕС', raw: 'Remote from EU' },
      { role: 'office', city: 'Berlin', country: null, region: null, raw: 'office in Berlin' },
    ],
    employmentTypes: [],
    salary: {
      min: 70_000,
      max: 90_000,
      currency: 'EUR',
      period: 'year',
      raw: '€70–90k gross',
      gross: true,
    },
    equity: null,
    skills: ['React', 'TypeScript'],
    niceSkills: ['Next.js'],
    languages: [{ code: 'en', level: 'B2' }],
    relocation: null,
    visaSponsorship: null,
    apply: { urls: [], emails: [], directMessage: false },
    summary: 'Фронтенд продукта.',
    responsibilities: [],
    requirements: [],
    benefits: [],
    ...overrides,
  };
}

describe('extract', () => {
  test('returns a detailed role of schema version 2', async () => {
    const model = mockModel({ vacancies: [modelVacancy()] });

    const result = await extract(publication, { occupations: TREE, model });

    assert.ok(!(result instanceof Error), result instanceof Error ? result.message : '');
    const [role] = result;
    assert.equal(result.length, 1);
    assert.ok(role !== undefined);
    assert.equal(role.schemaVersion, 2);
    assert.equal(role.occupationId, 'frontend');
    assert.equal(role.salaryGross, true);
    assert.deepEqual(role.languages, [{ code: 'en', level: 'B2' }]);
    assert.deepEqual(
      role.places.map((place) => [place.role, place.city ?? place.region]),
      [
        ['hiring', 'ЕС'],
        ['office', 'Berlin'],
      ],
    );
  });

  test('the prompt carries the occupation tree and the hiring regions', async () => {
    const model = mockModel({ vacancies: [modelVacancy()] });

    await extract(publication, { occupations: TREE, model });

    const call = model.doGenerateCalls[0];
    const prompt = JSON.stringify(call?.prompt);
    assert.match(prompt, /it › engineering › frontend — Интерфейсы в браузере\./u);
    assert.match(prompt, /European Union \(Евросоюз\)/u);
    // Модель видит публикацию в общем формате, без рассуждений: их токены оплачиваются как выход.
    assert.match(prompt, /Senior Frontend/u);
    assert.equal(call?.reasoning, 'none');
  });

  test('roles keep the order of the answer', async () => {
    const model = mockModel({
      vacancies: [modelVacancy(), modelVacancy({ title: 'QA Engineer', occupation: 'it' })],
    });

    const result = await extract(publication, { occupations: TREE, model });

    assert.ok(!(result instanceof Error));
    assert.deepEqual(
      result.map((role) => role.title),
      ['Senior Frontend', 'QA Engineer'],
    );
  });

  test('a suggested occupation is kept only above a leaf', async () => {
    const model = mockModel({
      vacancies: [
        modelVacancy({ suggestedOccupation: 'Solidity-разработчик' }),
        modelVacancy({ occupation: 'engineering', suggestedOccupation: 'Solidity-разработчик' }),
      ],
    });

    const result = await extract(publication, { occupations: TREE, model });

    assert.ok(!(result instanceof Error));
    assert.deepEqual(
      result.map((role) => role.suggestedOccupation),
      [null, 'Solidity-разработчик'],
    );
  });

  test('an occupation that is not a node id is an error', async () => {
    const result = await extract(publication, {
      occupations: TREE,
      model: mockModel({ vacancies: [modelVacancy({ occupation: 'frontend developer' })] }),
    });

    assert.ok(result instanceof Error);
  });

  test('a node missing from the given tree is an error', async () => {
    const result = await extract(publication, {
      occupations: TREE,
      model: mockModel({ vacancies: [modelVacancy({ occupation: 'backend' })] }),
    });

    assert.ok(result instanceof Error);
  });

  test('an answer without roles is an error', async () => {
    const result = await extract(publication, {
      occupations: TREE,
      model: mockModel({ vacancies: [] }),
    });

    assert.ok(result instanceof Error);
    assert.match(result.message, /Vacancy extraction failed/u);
  });

  test('a provider failure is an error', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: () => Promise.reject(new Error('Gateway unavailable')),
    });

    const result = await extract(publication, { occupations: TREE, model });

    assert.ok(result instanceof Error);
    assert.match(result.message, /Vacancy extraction failed/u);
  });
});
