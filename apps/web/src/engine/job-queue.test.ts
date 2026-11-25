import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { BatchSendMessage, BatchSendResult } from '@vercel/queue';

import { DRAIN_SOURCE_TOPIC, drainSourceQueue, mineQueue } from './job-queue.ts';
import type { SendBatch } from './job-queue.ts';

type Call = { readonly topic: string; readonly messages: readonly BatchSendMessage[] };

/** Фейк `sendBatch`: запоминает вызовы и отвечает `respond` на каждый. */
function fakeSend(
  respond: (call: Call) => BatchSendResult[] | Promise<BatchSendResult[]> = ({ messages }) =>
    messages.map((_, index) => ({ status: 'sent', messageId: String(index) })),
): { readonly send: SendBatch; readonly calls: Call[] } {
  const calls: Call[] = [];
  const send: SendBatch = async (topic, messages) => {
    const call = { topic, messages };
    calls.push(call);
    return respond(call);
  };
  return { send, calls };
}

const drainJob = (index: number) => ({
  sourceId: `s${String(index)}`,
  delaySeconds: index,
  idempotencyKey: `s${String(index)}:t`,
});

describe('vercelJobQueue', () => {
  test('шлёт задания пачками по 100 с телом, задержкой и ключом задания', async () => {
    const { send, calls } = fakeSend();
    const jobs = Array.from({ length: 250 }, (_, index) => drainJob(index));

    assert.equal(await drainSourceQueue(send).enqueue(jobs), undefined);

    assert.deepEqual(
      calls.map((call) => [call.topic, call.messages.length]),
      [
        [DRAIN_SOURCE_TOPIC, 100],
        [DRAIN_SOURCE_TOPIC, 100],
        [DRAIN_SOURCE_TOPIC, 50],
      ],
    );
    assert.deepEqual(calls[2]?.messages[49], {
      payload: { v: 1, sourceId: 's249' },
      delaySeconds: 249,
      idempotencyKey: 's249:t',
    });
  });

  test('тело задания разбора — id публикации', async () => {
    const { send, calls } = fakeSend();
    const sent = await mineQueue(send).enqueue([
      { publicationId: 'p1', delaySeconds: 300, idempotencyKey: 'p1:1' },
    ]);

    assert.equal(sent, undefined);
    assert.deepEqual(calls[0], {
      topic: 'mine',
      messages: [
        { payload: { v: 1, publicationId: 'p1' }, delaySeconds: 300, idempotencyKey: 'p1:1' },
      ],
    });
  });

  test('отложенное сообщение считается принятым', async () => {
    const { send } = fakeSend(({ messages }) =>
      messages.map(() => ({ status: 'deferred', messageId: null })),
    );
    assert.equal(await drainSourceQueue(send).enqueue([drainJob(1)]), undefined);
  });

  test('сообщение, которое очередь не приняла, — Error, следующие пачки не уходят', async () => {
    const { send, calls } = fakeSend(({ messages }) =>
      messages.map((_, index) =>
        index === 3
          ? { status: 'failed', statusCode: 400, error: 'delay too long', retryable: false }
          : { status: 'sent', messageId: String(index) },
      ),
    );
    const jobs = Array.from({ length: 150 }, (_, index) => drainJob(index));

    const sent = await drainSourceQueue(send).enqueue(jobs);

    assert.ok(sent instanceof Error);
    assert.match(sent.message, /rejected 1 of 100 messages: delay too long/u);
    assert.equal(calls.length, 1);
  });

  test('брошенная ошибка отправки — Error с причиной', async () => {
    const cause = new Error('socket hang up');
    const { send } = fakeSend(() => Promise.reject(cause));

    const sent = await drainSourceQueue(send).enqueue([drainJob(1)]);

    assert.ok(sent instanceof Error);
    assert.equal(sent.cause, cause);
  });
});
