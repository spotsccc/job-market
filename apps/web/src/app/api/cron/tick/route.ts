import { tick } from '@job-market/engine';
import { log } from '@job-market/logger';

import { engineConnectors } from '../../../../engine/connectors.ts';
import { drainSourceQueue } from '../../../../engine/job-queue.ts';

const routeLog = log.with({ module: 'engine', step: 'tick-route' });

/** Секунды. Тик — пара запросов к базе и до 20 пачек в очередь. */
export const maxDuration = 60;

const SECRET_ENV = 'CRON_SECRET';

/**
 * Тик опроса: расписание `sources-tick` в `schedules` из `vercel.json` зовёт его GET-запросом
 * с `Authorization: Bearer $CRON_SECRET`. Повтор запуска безопасен: источники берутся с
 * блокировкой, а задания одного тика отбрасывает ключ. Отвечает итогом тика.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- сигнатура обработчика Next.js
export async function GET(request: Request): Promise<Response> {
  const secret = process.env[SECRET_ENV];
  if (secret === undefined || secret === '') {
    routeLog.error('Cron secret is not set', { env: SECRET_ENV });
    return Response.json({ error: `${SECRET_ENV} is not set` }, { status: 500 });
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const connectors = engineConnectors();
  if (connectors instanceof Error) {
    routeLog.error('Engine connectors are not configured', { err: connectors });
    return Response.json({ error: connectors.message }, { status: 500 });
  }
  const result = await tick({ now: new Date(), connectors, queue: drainSourceQueue() });
  if (result instanceof Error) {
    routeLog.error('Tick failed', { err: result });
    return Response.json({ error: result.message }, { status: 500 });
  }
  return Response.json(result);
}
