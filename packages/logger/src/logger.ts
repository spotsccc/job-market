import { Writable } from 'node:stream';

import { pino } from 'pino';
import type { LogFn } from 'pino';
import { PinoPretty } from 'pino-pretty';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

/**
 * Поля записи. Ошибку кладут в `err`: сериализатор разворачивает её цепочку `cause`
 * с `_tag`, `messageTemplate` и переменными шаблона на каждом уровне.
 */
export type LogFields = Readonly<Record<string, unknown>>;

export type Logger = {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  /** Синоним `warn`. */
  warning(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** Дочерний логгер: `fields` добавляются в каждую его запись. */
  with(fields: LogFields): Logger;
};

export type LoggerOptions = {
  readonly level?: LogLevel;
  /** `json` — строка JSON на запись, `pretty` — читаемый цветной вывод для разработки. */
  readonly format?: 'json' | 'pretty';
  /** Куда писать вместо stdout: получает готовые строки. Нужен тестам и нестандартным выводам. */
  readonly write?: (chunk: string) => void;
  /**
   * Поля окружения, которые добавляются в каждую запись: вызывается на каждой записи.
   * Так в лог попадает, например, `traceId` текущего запроса.
   */
  readonly context?: () => LogFields;
};

const LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error', 'silent'];

/**
 * `errWithCause` из pino обходит `.cause` и копирует собственные поля ошибки на каждом
 * уровне. `fingerprint` тегированной ошибки объявлен на прототипе и туда не попадает,
 * поэтому выносим его отдельно: по нему записи группируются.
 */
function serializeError(value: unknown): unknown {
  if (!(value instanceof Error)) return value;
  const serialized = pino.stdSerializers.errWithCause(value);
  if (!('fingerprint' in value) || !Array.isArray(value.fingerprint)) return serialized;
  return { ...serialized, fingerprint: value.fingerprint };
}

function toStream(sink: (chunk: string) => void): Writable {
  return new Writable({
    write(chunk, _encoding, callback) {
      sink(String(chunk));
      callback();
    },
  });
}

type WriteLevel = 'debug' | 'info' | 'warn' | 'error';

/** Та часть логгера pino, на которую опирается обёртка. */
type PinoLike = { readonly [Level in WriteLevel]: LogFn } & {
  readonly child: (bindings: LogFields) => PinoLike;
};

function wrap(logger: PinoLike): Logger {
  const write =
    (level: WriteLevel) =>
    (message: string, fields?: LogFields): void => {
      if (fields === undefined) logger[level](message);
      else logger[level](fields, message);
    };
  const warn = write('warn');
  return {
    debug: write('debug'),
    info: write('info'),
    warn,
    warning: warn,
    error: write('error'),
    with: (fields) => wrap(logger.child(fields)),
  };
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const format = options.format ?? 'json';
  const common = {
    level: options.level ?? 'info',
    serializers: { err: serializeError },
    ...(options.context === undefined ? {} : { mixin: options.context }),
  };

  if (format === 'pretty') {
    const pretty = PinoPretty({
      colorize: true,
      sync: true,
      translateTime: 'SYS:HH:MM:ss.l',
      ignore: 'pid,hostname',
      ...(options.write === undefined ? {} : { destination: toStream(options.write) }),
    });
    return wrap(pino(common, pretty));
  }

  const json = pino(
    {
      ...common,
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
    },
    options.write === undefined ? undefined : { write: options.write },
  );
  return wrap(json);
}

function parseLevel(value: string | undefined): LogLevel | undefined {
  return LEVELS.find((level) => level === value);
}

/**
 * Настройки из окружения: `LOG_LEVEL` (debug | info | warn | error | silent, по умолчанию
 * info) и `LOG_FORMAT` (json | pretty; по умолчанию pretty вне production).
 */
export function readLoggerOptions(env: Readonly<NodeJS.ProcessEnv> = process.env): LoggerOptions {
  const level = parseLevel(env['LOG_LEVEL']) ?? 'info';
  const explicitFormat = env['LOG_FORMAT'];
  const format =
    explicitFormat === 'json' || explicitFormat === 'pretty'
      ? explicitFormat
      : env['NODE_ENV'] === 'production'
        ? 'json'
        : 'pretty';
  return { level, format };
}

let readContext: () => LogFields = () => ({});

/**
 * Задаёт поля окружения для общего логгера `log`: функция вызывается на каждой записи.
 * Приложение вызывает это один раз при старте, например чтобы добавить `traceId`.
 */
export function configureLogContext(context: () => LogFields): void {
  readContext = context;
}

/** Общий логгер приложения и пакетов. Пакет добавляет свой контекст: `log.with({ module })`. */
export const log: Logger = createLogger({ ...readLoggerOptions(), context: () => readContext() });
