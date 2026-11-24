import type { TelegramChannel, TelegramChannelError } from './channel.ts';
import { TelegramRequestError } from './errors/telegram-request-error.ts';
import type { ChannelPage, TelegramMessage } from './parse-page.ts';

export type FakeTelegramOptions = {
  /** Сколько сообщений на странице, по умолчанию 3. */
  readonly pageSize?: number;
  /** Номер вызова `fetchPage`, на котором поддельный t.me отвечает 429. */
  readonly failOnCall?: number;
};

export type FakeTelegram = Pick<TelegramChannel, 'fetchPage'> & {
  /** Сколько раз звали `fetchPage`. */
  calls: number;
};

/**
 * Поддельный t.me: страницы по `pageSize` сообщений из списка, как у превью — самые новые с
 * номером меньше `before`, по возрастанию номера.
 */
export function fakeTelegram(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- в сообщении и публикации `Date`, глубоко readonly его не сделать
  messages: ReadonlyMap<string, readonly TelegramMessage[]>,
  options: FakeTelegramOptions = {},
): FakeTelegram {
  const pageSize = options.pageSize ?? 3;
  const fake: FakeTelegram = {
    calls: 0,
    async fetchPage(channel: string, before?: number): Promise<TelegramChannelError | ChannelPage> {
      // Ответ приходит в следующей задаче, как от настоящего t.me.
      await Promise.resolve();
      fake.calls += 1;
      if (fake.calls === options.failOnCall) {
        return new TelegramRequestError({ channel, cause: new Error('HTTP 429') });
      }
      const older = (messages.get(channel) ?? [])
        // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- в сообщении и публикации `Date`, глубоко readonly его не сделать
        .filter((item) => before === undefined || item.id < before)
        // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- в сообщении и публикации `Date`, глубоко readonly его не сделать
        .toSorted((left, right) => left.id - right.id);
      return { messages: older.slice(-pageSize) };
    },
  };
  return fake;
}

/** Сообщение канала `id`, опубликованное `daysAgo` дней до `now`. */
export function telegramMessage(
  channel: string,
  id: number,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- в сообщении и публикации `Date`, глубоко readonly его не сделать
  options: { readonly now: Date; readonly daysAgo: number; readonly content?: string },
): TelegramMessage {
  return {
    channel,
    id,
    url: `https://t.me/${channel}/${String(id)}`,
    content: options.content ?? `Вакансия ${String(id)}`,
    postedAt: new Date(options.now.getTime() - options.daysAgo * 24 * 60 * 60 * 1000),
    authorName: `Канал ${channel}`,
  };
}
