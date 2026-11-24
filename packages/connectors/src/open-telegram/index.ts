import { z } from 'zod';

import type { ConnectorDefinition, Processor } from '../contract.ts';
import type { TelegramChannel } from './channel.ts';
import { parseTelegram } from './parse.ts';
import type { TelegramConfig, TelegramCursor } from './parse.ts';

/** Юзернейм канала без `@`: буквы, цифры и подчёркивание. */
const channelName = z.string().regex(/^\w+$/u);

/**
 * Настройки источника: канал. Без него читается канал с юзернеймом из ключа источника — так
 * заведены источники каналов geekjobs (`config` пустой, `key` — юзернейм).
 */
const configSchema: z.ZodType<TelegramConfig> = z.strictObject({ channel: channelName.optional() });

const messageId = z.int().positive();

/**
 * Курсор: прочитанное прошлыми проходами (`cursorId`) и незаконченный проход (`passTopId`,
 * `resumeBeforeId`). Пустой объект и курсор другой формы не проходят — первый опрос (E2).
 */
const cursorSchema: z.ZodType<TelegramCursor> = z.union([
  z.strictObject({ cursorId: messageId }),
  z.strictObject({
    cursorId: messageId.optional(),
    passTopId: messageId,
    resumeBeforeId: messageId,
  }),
]);

export type OpenTelegramDeps = {
  readonly telegram: Pick<TelegramChannel, 'fetchPage'>;
  readonly process: Processor;
};

/** Коннектор открытых Telegram-каналов: читает веб-превью `t.me/s/<канал>`. */
export function openTelegram(
  deps: OpenTelegramDeps,
): ConnectorDefinition<TelegramConfig, TelegramCursor> {
  return {
    id: 'open-telegram',
    configSchema,
    cursorSchema,
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- в сообщении и публикации `Date`, глубоко readonly его не сделать
    parse: async (input) => parseTelegram(deps.telegram, input),
    process: deps.process,
  };
}
