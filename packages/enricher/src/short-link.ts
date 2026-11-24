import { tryFn } from '@spotsccc/error-as-value';

/** Хосты коротких ссылок: енричер раскрывает их и отдаёт читателям адрес, куда они ведут. */
const SHORT_HOSTS = new Set(['lnkd.in', 'www.lnkd.in']);

const EXPAND_TIMEOUT_MS = 10_000;

/**
 * Куда ведёт короткая ссылка. `null` — раскрыть нечего: ссылки нет или она ведёт на
 * страницу-заглушку. Ошибка — сервис не ответил, и повтор может помочь.
 */
export type ExpandShortLink = (url: string) => Promise<Error | string | null>;

export function isShortLink(url: string): boolean {
  const parsed = tryFn(() => new URL(url));
  return !(parsed instanceof Error) && SHORT_HOSTS.has(parsed.hostname.toLowerCase());
}

/**
 * Адрес из `Location` ответа 3xx, без перехода по нему. Ответ без редиректа — `null`:
 * так lnkd.in отдаёт мёртвые ссылки и заглушку перед внешними сайтами, а их читатели всё
 * равно не прочитают. Сеть, таймаут, 429 и 5xx — ошибка.
 */
export async function expandShortLink(url: string): Promise<Error | string | null> {
  const response = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(EXPAND_TIMEOUT_MS),
  }).catch((cause: unknown) => new Error(`Short link ${url} did not answer`, { cause }));
  if (response instanceof Error) return response;
  // Тело не нужно, но соединение освобождаем.
  await response.body?.cancel().catch(() => null);

  const { status } = response;
  if (status === 429 || status >= 500) {
    return new Error(`Short link ${url} answered ${String(status)}`);
  }
  const location = response.headers.get('location');
  if (status < 300 || status >= 400 || location === null) return null;
  const target = tryFn(() => new URL(location, url).href);
  return target instanceof Error ? null : target;
}
