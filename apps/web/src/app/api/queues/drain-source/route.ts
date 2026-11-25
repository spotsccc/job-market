import { handleDrainSourceJob } from '@job-market/engine';
import { log } from '@job-market/logger';
import { handleCallback } from '@vercel/queue';

import { engineConnectors } from '../../../../engine/connectors.ts';
import {
  drainSourceMessageSchema,
  drainSourceQueue,
  mineQueue,
} from '../../../../engine/job-queue.ts';

const routeLog = log.with({ module: 'engine', step: 'drain-source-route' });

/** Секунды. Опрос укладывается в `DRAIN_BUDGET_MS`, остальное — запас на чтение ссылок и базу. */
export const maxDuration = 300;

/**
 * Бюджет опроса: после него коннектор не начинает новый запрос к сервису. Запас до
 * `maxDuration` — чтение ссылок LinkedIn после дедлайна (до 60 с) и запись в базу.
 */
const DRAIN_BUDGET_MS = 120_000;

/**
 * Потребитель топика `drain-source` (триггер в `vercel.json`). Сбой базы или отправки —
 * исключение: сообщение не подтверждается, и очередь доставит его снова. Сбой сервиса —
 * обычный итог: его паузу решает движок, сообщение подтверждается.
 */
export const POST = handleCallback(
  async (message: unknown) => {
    const parsed = drainSourceMessageSchema.safeParse(message);
    if (!parsed.success) {
      routeLog.error('Drain source message is invalid', { err: parsed.error, message });
      return;
    }
    const connectors = engineConnectors();
    if (connectors instanceof Error) {
      routeLog.error('Engine connectors are not configured', { err: connectors });
      throw connectors;
    }
    const now = new Date();
    const result = await handleDrainSourceJob({
      sourceId: parsed.data.sourceId,
      connectors,
      queue: drainSourceQueue(),
      mineQueue: mineQueue(),
      now,
      deadline: now.getTime() + DRAIN_BUDGET_MS,
    });
    if (result instanceof Error) {
      routeLog.error('Drain source job failed', { sourceId: parsed.data.sourceId, err: result });
      throw result;
    }
  },
  { visibilityTimeoutSeconds: maxDuration + 60 },
);
