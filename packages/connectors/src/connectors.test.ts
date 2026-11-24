import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createConnectors, createLinkedinChannel } from './index.ts';
import { mockModel } from './models.test-utils.ts';
import { fakeTelegram } from './open-telegram/fake-telegram.test-utils.ts';

const NOW = new Date('2026-11-20T12:00:00.000Z');

function registry(): {
  readonly connectors: ReturnType<typeof createConnectors>;
  readonly telegram: ReturnType<typeof fakeTelegram>;
} {
  const telegram = fakeTelegram(new Map());
  const connectors = createConnectors({
    telegram,
    linkedin: createLinkedinChannel({ token: 'test-token' }),
    models: { classifier: mockModel({}), extractor: mockModel({}) },
    readers: [],
  });
  return { connectors, telegram };
}

describe('createConnectors', () => {
  test('gives a connector by its id and nothing for an unknown id', () => {
    const { connectors } = registry();

    assert.deepEqual([...connectors.keys()].toSorted(), ['linkedin', 'open-telegram']);
    assert.equal(connectors.get('open-telegram')?.id, 'open-telegram');
    assert.equal(connectors.get('greenhouse'), undefined);
  });

  test('open-telegram fails a source whose channel has @ or is empty, without reading t.me', async () => {
    const { connectors, telegram } = registry();
    const connector = connectors.get('open-telegram');
    assert.ok(connector !== undefined);

    for (const channel of ['@forhr', '']) {
      // oxlint-disable-next-line eslint/no-await-in-loop
      const result = await connector.drain(
        { id: 'source-1', key: 'forhr', config: { channel }, cursor: null },
        { now: NOW, deadline: Date.now() + 60_000 },
      );
      assert.ok(!(result instanceof Error));
      assert.equal(result.status, 'failed');
    }
    assert.equal(telegram.calls, 0);
  });
});
