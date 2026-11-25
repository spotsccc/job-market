import { handleMineJob } from '@job-market/engine';
import { log } from '@job-market/logger';
import { handleCallback } from '@vercel/queue';

import { engineConnectors } from '../../../../engine/connectors.ts';
import { mineMessageSchema, mineQueue } from '../../../../engine/job-queue.ts';

const routeLog = log.with({ module: 'engine', step: 'mine-route' });

/**
 * Секунды. Должно быть меньше `CLAIM_TIMEOUT_MINUTES` движка (15 минут): дольше взятая
 * публикация считается брошенной.
 */
export const maxDuration = 300;

/**
 * Потребитель топика `mine` (триггер в `vercel.json`). Сбой базы или отправки повтора —
 * исключение: сообщение не подтверждается, и очередь доставит его снова. Сбой моделей —
 * обычный итог: паузу и число попыток решает движок, сообщение подтверждается.
 */
export const POST = handleCallback(
  async (message: unknown) => {
    const parsed = mineMessageSchema.safeParse(message);
    if (!parsed.success) {
      routeLog.error('Mine message is invalid', { err: parsed.error, message });
      return;
    }
    const connectors = engineConnectors();
    if (connectors instanceof Error) {
      routeLog.error('Engine connectors are not configured', { err: connectors });
      throw connectors;
    }
    const { publicationId } = parsed.data;
    const result = await handleMineJob({
      publicationId,
      connectors,
      queue: mineQueue(),
      now: new Date(),
    });
    if (result instanceof Error) {
      routeLog.error('Mine job failed', { publicationId, err: result });
      throw result;
    }
  },
  { visibilityTimeoutSeconds: maxDuration + 60 },
);
