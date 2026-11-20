import { tryFn } from '@spotsccc/error-as-value';

import { HttpInvalidResponseError } from './errors/http-invalid-response-error.ts';
import { HttpNetworkError } from './errors/http-network-error.ts';
import { HttpStatusError } from './errors/http-status-error.ts';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type QueryValue = string | number | boolean | undefined;

export type HttpClientOptions = {
  /** Базовый URL, может содержать путь: `https://api.apify.com/v2`. */
  readonly baseUrl: string;
  /** Заголовки для каждого запроса, например авторизация. */
  readonly headers?: Readonly<Record<string, string>>;
};

export type RequestOptions<T> = {
  readonly method?: HttpMethod;
  /** Путь относительно `baseUrl`, ведущий `/` не обязателен. */
  readonly path: string;
  /** Параметры со значением `undefined` пропускаются. */
  readonly query?: Readonly<Record<string, QueryValue>>;
  /** Сериализуется в JSON. */
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
  /**
   * Отмена запроса. Для таймаута подходит `AbortSignal.timeout(ms)`: он завершает
   * запрос с `TimeoutError`, который отличают через `isTimeoutError`, а не `isAbortError`.
   */
  readonly signal?: Readonly<AbortSignal>;
  /**
   * Проверяет и типизирует JSON ответа. Пустое тело приходит как `undefined`.
   * Возвращённая ошибка оборачивается в `HttpInvalidResponseError`.
   */
  readonly parse: (data: unknown) => Error | T;
};

export type HttpError = HttpNetworkError | HttpStatusError | HttpInvalidResponseError;

export type HttpClient = {
  readonly request: <T>(options: RequestOptions<T>) => Promise<HttpError | T>;
};

type RequestContext = { readonly method: HttpMethod; readonly path: string };

function buildUrl(baseUrl: string, path: string, query: RequestOptions<unknown>['query']): URL {
  const url = new URL(`${baseUrl}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url;
}

function buildInit(
  method: HttpMethod,
  clientOptions: HttpClientOptions,
  options: RequestOptions<unknown>,
): RequestInit {
  const headers = new Headers({ Accept: 'application/json', ...clientOptions.headers });
  for (const [key, value] of Object.entries(options.headers ?? {})) headers.set(key, value);

  const init: RequestInit = { method, headers };
  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    init.body = JSON.stringify(options.body);
  }
  if (options.signal) init.signal = options.signal;
  return init;
}

function parseJson(
  text: string,
  context: RequestContext,
): HttpInvalidResponseError | { readonly data: unknown } {
  // JSON упакован в объект, чтобы union с ошибкой не схлопнулся в `unknown`.
  return tryFn(
    (): { readonly data: unknown } => ({ data: text === '' ? undefined : JSON.parse(text) }),
    (cause: unknown) => new HttpInvalidResponseError({ ...context, cause }),
  );
}

export function createHttpClient(clientOptions: HttpClientOptions): HttpClient {
  const baseUrl = clientOptions.baseUrl.replace(/\/+$/u, '');

  async function request<T>(options: RequestOptions<T>): Promise<HttpError | T> {
    const method = options.method ?? 'GET';
    const path = `/${options.path.replace(/^\/+/u, '')}`;
    const context: RequestContext = { method, path };

    const response = await fetch(
      buildUrl(baseUrl, path, options.query),
      buildInit(method, clientOptions, options),
    ).catch((cause: unknown) => new HttpNetworkError({ ...context, cause }));
    if (response instanceof Error) return response;

    if (!response.ok) {
      // Тело ошибки не читаем, но освобождаем соединение.
      await response.body?.cancel().catch(() => null);
      return new HttpStatusError({ ...context, status: response.status });
    }

    const text = await response
      .text()
      .catch((cause: unknown) => new HttpNetworkError({ ...context, cause }));
    if (text instanceof Error) return text;

    const json = parseJson(text, context);
    if (json instanceof Error) return json;

    const parsed = options.parse(json.data);
    if (parsed instanceof Error) return new HttpInvalidResponseError({ ...context, cause: parsed });

    return parsed;
  }

  return { request };
}
