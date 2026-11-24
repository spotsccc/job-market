import type { ExtractedRole, ModelVacancy } from '@job-market/extractor';
import { MockLanguageModelV4 } from 'ai/test';

/** Модель, которая отвечает JSON текстом, как провайдер при structured outputs. */
export function mockModel(output: unknown): MockLanguageModelV4 {
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

/** Роль в ответе модели экстрактора. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- тип выведен из zod-схемы, массивы в нём изменяемые
export function roleOutput(overrides: Partial<ModelVacancy> = {}): ModelVacancy {
  return {
    title: 'Senior Frontend',
    company: null,
    companyUrl: null,
    hiringParty: 'unknown',
    occupation: 'frontend',
    suggestedOccupation: null,
    seniority: 'senior',
    experienceYearsMin: null,
    workplace: 'remote',
    places: [],
    employmentTypes: [],
    salary: null,
    equity: null,
    skills: [],
    niceSkills: [],
    languages: [],
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

/** Роль, как её возвращает `extract`: для фейкового `process`. */
export function extractedRole(overrides: Partial<ExtractedRole> = {}): ExtractedRole {
  return {
    schemaVersion: 2,
    title: 'Product Manager',
    company: null,
    companyUrl: null,
    hiringParty: 'unknown',
    occupationId: 'it',
    suggestedOccupation: null,
    seniority: 'senior',
    experienceYearsMin: null,
    workplace: 'remote',
    employmentTypes: [],
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    salaryRaw: null,
    salaryGross: null,
    equity: null,
    skills: [],
    niceSkills: [],
    languages: [],
    relocation: null,
    visaSponsorship: null,
    apply: { urls: [], emails: [], directMessage: false },
    summary: 'Вести продукт.',
    responsibilities: [],
    requirements: [],
    benefits: [],
    places: [],
    ...overrides,
  };
}
