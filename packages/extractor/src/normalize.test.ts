import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { normalizeVacancy } from './normalize.ts';
import type { ModelPlace, ModelVacancy } from './vacancy.ts';

function vacancy(overrides: Partial<ModelVacancy> = {}): ModelVacancy {
  return {
    title: 'Frontend',
    company: null,
    companyUrl: null,
    hiringParty: 'employer',
    occupation: 'root',
    suggestedOccupation: null,
    seniority: null,
    experienceYearsMin: null,
    workplace: null,
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
    summary: '',
    responsibilities: [],
    requirements: [],
    benefits: [],
    ...overrides,
  };
}

const place = (fields: Partial<ModelPlace>): ModelPlace => ({
  role: 'office',
  city: null,
  country: null,
  region: null,
  raw: '',
  ...fields,
});

describe('normalizeVacancy', () => {
  test('places: empty and repeated places are removed, an empty raw is built from fields', () => {
    const { places } = normalizeVacancy(
      vacancy({
        places: [
          place({ role: 'hiring', region: 'ЕС', raw: 'remote из ЕС' }),
          place({ city: 'Berlin', country: 'Germany' }),
          place({ city: 'berlin', country: 'germany', raw: 'Berlin' }),
          place({ city: ' ', country: '', raw: 'где-то' }),
        ],
      }),
    );

    assert.deepEqual(places, [
      place({ role: 'hiring', region: 'ЕС', raw: 'remote из ЕС' }),
      place({ city: 'Berlin', country: 'Germany', raw: 'Berlin, Germany' }),
    ]);
  });

  test('skills: repeats are removed and a required skill leaves the nice-to-have list', () => {
    const result = normalizeVacancy(
      vacancy({ skills: ['react', 'React', 'TypeScript'], niceSkills: ['typescript', 'Next.js'] }),
    );

    assert.deepEqual(result.skills, ['react', 'TypeScript']);
    assert.deepEqual(result.niceSkills, ['Next.js']);
  });

  test('experience outside 0–30 years is dropped', () => {
    assert.equal(normalizeVacancy(vacancy({ experienceYearsMin: 45 })).experienceYearsMin, null);
    assert.equal(normalizeVacancy(vacancy({ experienceYearsMin: 0 })).experienceYearsMin, 0);
  });

  test('a repeated language keeps the higher level', () => {
    const { languages } = normalizeVacancy(
      vacancy({
        languages: [
          { code: 'en', level: 'B1' },
          { code: 'EN', level: 'C1' },
        ],
      }),
    );

    assert.deepEqual(languages, [{ code: 'en', level: 'C1' }]);
  });

  test('section items lose list markers, blank items are removed', () => {
    const { responsibilities } = normalizeVacancy(
      vacancy({ responsibilities: ['• Писать тесты', '   ', '2) Ревьюить код'] }),
    );

    assert.deepEqual(responsibilities, ['Писать тесты', 'Ревьюить код']);
  });
});
