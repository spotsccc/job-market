import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { PublicationForModel } from '@job-market/publication-text';
import { MockLanguageModelV4 } from 'ai/test';

import { classify } from './classify.ts';
import { ClassificationError, NothingToClassifyError } from './errors/index.ts';

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

/** Типичная вакансия: одна роль, стек и формат работы. */
function publication(overrides: Partial<PublicationForModel> = {}): PublicationForModel {
  return {
    connector: 'open-telegram',
    content: 'Ищем Senior Frontend (React) в команду платежей, remote из ЕС',
    postedAt: new Date('2026-11-20T10:00:00.000Z'),
    author: {
      name: 'Job for Products and Projects',
      url: 'https://t.me/forproducts',
      headline: null,
    },
    ...overrides,
  };
}

describe('classify', () => {
  test('returns the vacancy verdict with its note and asks for no reasoning', async () => {
    const model = mockModel({ verdict: 'vacancy', note: 'Нанимают фронтендера' });

    const result = await classify(publication(), { model });

    assert.deepEqual(result, { verdict: 'vacancy', note: 'Нанимают фронтендера' });
    const [call] = model.doGenerateCalls;
    assert.ok(call);
    assert.equal(call.reasoning, 'none');
    assert.match(JSON.stringify(call.prompt), /Senior Frontend/u);
  });

  test('returns a not-vacancy reason with its note', async () => {
    const model = mockModel({ verdict: 'job_seeker', note: 'Автор ищет работу' });

    const result = await classify(
      publication({ connector: 'linkedin', content: 'Open to work as a frontend developer' }),
      { model },
    );

    assert.deepEqual(result, { verdict: 'job_seeker', note: 'Автор ищет работу' });
  });

  test('refuses a text without letters and does not call the model', async () => {
    const model = mockModel({ verdict: 'vacancy', note: '' });

    const result = await classify(publication({ content: '  \n' }), { model });

    assert.ok(result instanceof NothingToClassifyError);
    assert.equal(result.reason, 'empty');
    assert.equal(model.doGenerateCalls.length, 0);
  });

  test('returns ClassificationError with the provider failure as the cause', async () => {
    const failure = new Error('Gateway unavailable');
    const model = new MockLanguageModelV4({
      doGenerate: () => Promise.reject(failure),
    });

    const result = await classify(publication(), { model });

    assert.ok(result instanceof ClassificationError);
    assert.equal(result.cause, failure);
  });

  test('returns ClassificationError when the model does not answer in time', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async ({ abortSignal }) =>
        new Promise((_, reject) => {
          abortSignal?.addEventListener('abort', () => {
            reject(new Error('Aborted', { cause: abortSignal.reason }));
          });
        }),
    });

    const result = await classify(publication(), { model, timeoutMs: 50 });

    assert.ok(result instanceof ClassificationError);
  });
});
