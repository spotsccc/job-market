import { configureLogContext, log } from '@job-market/logger';
import type { LogFields } from '@job-market/logger';
import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { TracerProvider } from '@opentelemetry/sdk-trace';
import type { ReadableSpan, SpanProcessor } from '@opentelemetry/sdk-trace';

/**
 * Span, которым Next.js оборачивает обработку каждого входящего запроса. Он закрывается
 * после ответа и несёт метод, URL, статус и маршрут.
 *
 * Если в приложении появится `proxy.ts`, Next обрабатывает запрос в два прохода (proxy и
 * рендер), и на один запрос придут два таких span'а — тогда проход proxy надо отсеять.
 */
const REQUEST_SPAN_TYPE = 'BaseServer.handleRequest';

/** Служебные запросы Next (чанки, HMR, оверлей): пишутся на уровне debug, чтобы не шуметь. */
const INTERNAL_PATH = /^\/(?:_next|__nextjs)/u;

const requestLog = log.with({ module: 'http' });

type RequestRecord = {
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  readonly message: string;
  readonly fields: LogFields;
};

function toMilliseconds(seconds: number, nanoseconds: number): number {
  return Math.round((seconds * 1e3 + nanoseconds / 1e6) * 10) / 10;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function levelFor(status: number | undefined, path: string): RequestRecord['level'] {
  if (status !== undefined && status >= 500) return 'error';
  if (status !== undefined && status >= 400) return 'warn';
  return INTERNAL_PATH.test(path) ? 'debug' : 'info';
}

/** Запись лога для span'а запроса; `undefined` — span не про входящий запрос. */
export function toRequestRecord(span: ReadableSpan): RequestRecord | undefined {
  const { attributes } = span;
  if (asString(attributes['next.span_type']) !== REQUEST_SPAN_TYPE) return undefined;

  const method = asString(attributes['http.method']) ?? 'UNKNOWN';
  const path = asString(attributes['http.target']) ?? '';
  const status = asNumber(attributes['http.status_code']);
  const durationMs = toMilliseconds(...span.duration);

  return {
    level: levelFor(status, path),
    message: `${method} ${path} ${status ?? '-'} in ${durationMs}ms`,
    fields: {
      method,
      path,
      route: asString(attributes['next.route']),
      status,
      durationMs,
      rsc: attributes['next.rsc'] === true,
      traceId: span.spanContext().traceId,
    },
  };
}

const requestLogProcessor: SpanProcessor = {
  onStart: () => {},
  onEnd: (span) => {
    const record = toRequestRecord(span);
    if (record !== undefined) requestLog[record.level](record.message, record.fields);
  },
  forceFlush: async () => {},
  shutdown: async () => {},
};

/**
 * Регистрирует OpenTelemetry-провайдер, через который Next отдаёт span'ы запросов в логгер,
 * и добавляет `traceId` активного span'а в каждую запись лога: по нему записи кода
 * сопоставляются с записью запроса.
 */
export function registerRequestLogging(): void {
  // Менеджер контекста связывает span'ы одного запроса через async-вызовы: по нему Next
  // находит корневой span запроса и дописывает в него маршрут.
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  trace.setGlobalTracerProvider(new TracerProvider({ spanProcessors: [requestLogProcessor] }));
  configureLogContext(() => ({ traceId: trace.getActiveSpan()?.spanContext().traceId }));
}
