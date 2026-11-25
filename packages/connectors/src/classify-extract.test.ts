import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { OccupationNode } from '@job-market/extractor';
import type { PublicationForModel } from '@job-market/publication-text';
import { MockLanguageModelV4 } from 'ai/test';

import { classifyAndExtract, extractOnly } from './classify-extract.ts';
import { mockModel, roleOutput } from './models.test-utils.ts';

const TREE: readonly OccupationNode[] = [
  { id: 'root', parentId: null, name: 'root', description: 'Без профессии.' },
  { id: 'it', parentId: 'root', name: 'it', description: 'Софт.' },
  { id: 'frontend', parentId: 'it', name: 'frontend', description: 'Интерфейсы.' },
];

const publication: PublicationForModel = {
  connector: 'open-telegram',
  content: 'Senior Frontend и Junior Frontend в Acme, Berlin',
  postedAt: new Date('2026-11-19T10:00:00.000Z'),
  author: { name: 'forhr', url: 'https://t.me/forhr', headline: null },
};

const failing = (cause: Error): MockLanguageModelV4 =>
  new MockLanguageModelV4({
    doGenerate: () => {
      throw cause;
    },
  });

describe('classifyAndExtract', () => {
  test('a post the classifier rejects is trash and the extractor is not called', async () => {
    const extractor = mockModel({ vacancies: [] });
    const process = classifyAndExtract({
      classifier: mockModel({ verdict: 'not_vacancy', note: 'Ищет работу' }),
      extractor,
    });

    const outcome = await process(publication, { occupations: TREE });

    assert.deepEqual(outcome, { kind: 'not_vacancy', reason: 'trash', note: 'Ищет работу' });
    assert.equal(extractor.doGenerateCalls.length, 0);
  });

  test('a vacancy gives the roles in the order of the answer, extracted with the tree', async () => {
    const extractor = mockModel({
      vacancies: [
        roleOutput({ title: 'Senior Frontend' }),
        roleOutput({ title: 'Junior Frontend' }),
      ],
    });
    const process = classifyAndExtract({
      classifier: mockModel({ verdict: 'vacancy', note: '' }),
      extractor,
    });

    const outcome = await process(publication, { occupations: TREE });

    assert.ok(!(outcome instanceof Error), outcome instanceof Error ? String(outcome.cause) : '');
    assert.equal(outcome.kind, 'vacancy');
    assert.deepEqual(
      outcome.roles.map((role) => role.title),
      ['Senior Frontend', 'Junior Frontend'],
    );
    assert.match(JSON.stringify(extractor.doGenerateCalls[0]?.prompt), /it › frontend/u);
  });

  test('a post without letters is empty and neither model is called', async () => {
    const classifier = mockModel({ verdict: 'vacancy', note: '' });
    const extractor = mockModel({ vacancies: [] });
    const process = classifyAndExtract({ classifier, extractor });

    const outcome = await process({ ...publication, content: '🔥🔥🔥' }, { occupations: TREE });

    assert.deepEqual(outcome, { kind: 'not_vacancy', reason: 'empty' });
    assert.equal(classifier.doGenerateCalls.length, 0);
    assert.equal(extractor.doGenerateCalls.length, 0);
  });

  test('a classifier timeout is an Error and the extractor is not called', async () => {
    const extractor = mockModel({ vacancies: [] });
    const process = classifyAndExtract({
      classifier: failing(new DOMException('The operation timed out.', 'TimeoutError')),
      extractor,
    });

    const outcome = await process(publication, { occupations: TREE });

    assert.ok(outcome instanceof Error);
    assert.equal(extractor.doGenerateCalls.length, 0);
  });

  test('an extractor failure is an Error', async () => {
    const process = classifyAndExtract({
      classifier: mockModel({ verdict: 'vacancy', note: '' }),
      extractor: failing(new Error('Gateway unavailable')),
    });

    const outcome = await process(publication, { occupations: TREE });

    assert.ok(outcome instanceof Error);
  });
});

describe('extractOnly', () => {
  test('a role from the extractor is a vacancy without a classifier verdict', async () => {
    const process = extractOnly({ extractor: mockModel({ vacancies: [roleOutput()] }) });

    const outcome = await process(publication, { occupations: TREE });

    assert.ok(!(outcome instanceof Error), outcome instanceof Error ? String(outcome.cause) : '');
    assert.equal(outcome.kind, 'vacancy');
    assert.deepEqual(
      outcome.roles.map((role) => role.title),
      ['Senior Frontend'],
    );
  });

  test('a text without letters is empty and the extractor is not called', async () => {
    const extractor = mockModel({ vacancies: [] });
    const process = extractOnly({ extractor });

    const outcome = await process({ ...publication, content: '🔥🔥🔥' }, { occupations: TREE });

    assert.deepEqual(outcome, { kind: 'not_vacancy', reason: 'empty' });
    assert.equal(extractor.doGenerateCalls.length, 0);
  });

  test('an extractor answer out of schema is an Error', async () => {
    const process = extractOnly({ extractor: mockModel({ roles: 'nope' }) });

    const outcome = await process(publication, { occupations: TREE });

    assert.ok(outcome instanceof Error);
  });
});
