import { TelegramPageError } from './errors/telegram-page-error.ts';
import { TelegramRequestError } from './errors/telegram-request-error.ts';
import { parseChannelPage } from './parse-page.ts';
import type { ChannelPage } from './parse-page.ts';

const DEFAULT_BASE_URL = 'https://t.me';
const DEFAULT_TIMEOUT_MS = 15_000;

export type TelegramChannelOptions = {
  /** По умолчанию `https://t.me`. */
  readonly baseUrl?: string;
  /** Таймаут одного запроса, по умолчанию 15 секунд. */
  readonly timeoutMs?: number;
};

export type TelegramChannelError = TelegramRequestError | TelegramPageError;

export type TelegramChannel = {
  /**
   * Страница превью публичного канала: последние сообщения или, с `before`, сообщения
   * с номером меньше `before`. Канал — юзернейм без `@`.
   */
  readonly fetchPage: (
    channel: string,
    before?: number,
  ) => Promise<TelegramChannelError | ChannelPage>;
};

/**
 * Чтение публичных каналов через веб-превью `t.me/s/<канал>`: без аккаунта и
 * ключей, обычными HTTP-запросами. Работает только у каналов с включённым превью.
 */
export function createTelegramChannel(options: TelegramChannelOptions = {}): TelegramChannel {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/u, '');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function fetchPage(
    rawChannel: string,
    before?: number,
  ): Promise<TelegramChannelError | ChannelPage> {
    const channel = rawChannel.replace(/^@/u, '').toLowerCase();
    const url = new URL(`${baseUrl}/s/${encodeURIComponent(channel)}`);
    if (before !== undefined) url.searchParams.set('before', String(before));

    // `async`-обёртка ловит и ошибки чтения тела, и синхронные ошибки `fetch`.
    async function download(): Promise<string> {
      const response = await fetch(url, {
        headers: { Accept: 'text/html' },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => null);
        throw new Error(`HTTP ${String(response.status)} for ${url.href}`);
      }
      return response.text();
    }

    const html = await download().catch(
      (cause: unknown) => new TelegramRequestError({ channel, cause }),
    );
    if (html instanceof Error) return html;

    const page = parseChannelPage(html, channel);
    if (page instanceof Error) return new TelegramPageError({ channel, cause: page });
    return page;
  }

  return { fetchPage };
}
