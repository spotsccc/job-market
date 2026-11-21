import { log as rootLog } from '@job-market/logger';
import { after } from 'next/server';

import { TELEGRAM_CHANNELS } from '../../../../telegram/channels.ts';
import { runTelegramJob } from '../../../../telegram/job.ts';

const log = rootLog.with({ module: 'telegram', step: 'route' });

/** Секунды. 300 — предел функции на Hobby с Fluid compute; на Pro можно поднять. */
export const maxDuration = 300;

const SECRET_ENV = 'CRON_SECRET';
/** Сколько ждём ответа следующего звена: оно сразу отвечает 202 и работает в `after()`. */
const CONTINUE_TIMEOUT_MS = 15_000;

/** `?channels=forproducts,forhr` — только эти каналы из списка: для проверки на одном-двух каналах. */
function parseChannels(raw: string | null): Error | readonly string[] {
  if (raw === null || raw.trim() === '') return TELEGRAM_CHANNELS;
  const channels = raw.split(',').map((channel) => channel.trim().toLowerCase());
  const unknown = channels.filter(
    (channel) => !TELEGRAM_CHANNELS.some((known) => known === channel),
  );
  if (unknown.length > 0) return new Error(`Unknown channels: ${unknown.join(', ')}`);
  return channels;
}

function parseHop(raw: string | null): Error | number {
  if (raw === null) return 0;
  const hop = Number(raw);
  return Number.isInteger(hop) && hop >= 0 ? hop : new Error(`Invalid hop: ${raw}`);
}

/**
 * Ежедневный сбор Telegram-каналов (расписание — в `vercel.json`). Vercel Cron зовёт
 * его с `Authorization: Bearer $CRON_SECRET`. Отвечает сразу 202, а работу делает в
 * `after()`: так продолжение цепочки не ждёт, пока доработает предыдущее звено.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- сигнатура обработчика Next.js
export function GET(request: Request): Response {
  const startedAt = Date.now();
  const secret = process.env[SECRET_ENV];
  if (secret === undefined || secret === '') {
    log.error('Cron secret is not set', { env: SECRET_ENV });
    return Response.json({ error: `${SECRET_ENV} is not set` }, { status: 500 });
  }
  const authorization = `Bearer ${secret}`;
  if (request.headers.get('authorization') !== authorization) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const channels = parseChannels(url.searchParams.get('channels'));
  if (channels instanceof Error) return Response.json({ error: channels.message }, { status: 400 });
  const hop = parseHop(url.searchParams.get('hop'));
  if (hop instanceof Error) return Response.json({ error: hop.message }, { status: 400 });

  async function continueWith(nextHop: number): Promise<Error | null> {
    const next = new URL(url.pathname, url.origin);
    next.searchParams.set('hop', String(nextHop));
    const channelsParam = url.searchParams.get('channels');
    if (channelsParam !== null) next.searchParams.set('channels', channelsParam);

    const response = await fetch(next, {
      headers: { authorization },
      signal: AbortSignal.timeout(CONTINUE_TIMEOUT_MS),
    }).catch((cause: unknown) => new Error(`Calling ${next.pathname} failed`, { cause }));
    if (response instanceof Error) return response;
    await response.body?.cancel().catch(() => null);
    // 401 здесь — почти всегда Deployment Protection на домене: см. README.
    if (response.status !== 202) {
      return new Error(`Continuation returned HTTP ${String(response.status)}`);
    }
    return null;
  }

  after(async () => {
    const result = await runTelegramJob({
      channels,
      hop,
      startedAt,
      maxDurationMs: maxDuration * 1000,
      continueWith,
    });
    if (result instanceof Error) log.error('Telegram job failed', { err: result, hop });
  });

  return Response.json({ status: 'accepted', hop, channels }, { status: 202 });
}
