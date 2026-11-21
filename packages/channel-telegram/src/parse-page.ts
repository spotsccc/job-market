import { decodeEntities, htmlToMarkdown } from './html-to-markdown.ts';

/** Сообщение публичного канала из веб-превью `t.me/s/<канал>`. */
export type TelegramMessage = {
  /** Юзернейм канала в нижнем регистре, без `@`: `forproducts`. */
  readonly channel: string;
  /** Номер сообщения в канале. Растёт со временем, уникален только внутри канала. */
  readonly id: number;
  /** `https://t.me/forproducts/10907`. */
  readonly url: string;
  /** Текст в Markdown, ссылки сохранены. Пустая строка — сообщение без текста: картинка, служебное. */
  readonly content: string;
  readonly postedAt: Date;
  /** Название канала, от имени которого сообщение: «Job for Products and Projects». */
  readonly authorName: string;
};

/** Одна страница превью: до 20 сообщений, по возрастанию номера. */
export type ChannelPage = {
  readonly messages: readonly TelegramMessage[];
};

const MESSAGE_SEPARATOR = '<div class="tgme_widget_message_wrap';

function parseMessage(block: string, channel: string): Error | TelegramMessage {
  const post = /data-post="([^"/]+)\/(\d+)"/u.exec(block);
  if (post === null) return new Error('Message has no data-post');
  const [, postChannel = '', rawId = ''] = post;
  if (postChannel.toLowerCase() !== channel) {
    return new Error(`Message belongs to ${postChannel}, expected ${channel}`);
  }

  const time = /class="tgme_widget_message_date"[^>]*>\s*<time datetime="([^"]+)"/u.exec(block);
  const postedAt = new Date(time?.[1] ?? '');
  if (Number.isNaN(postedAt.getTime())) return new Error(`Message ${rawId} has no valid date`);

  const owner = /class="tgme_widget_message_owner_name"[^>]*>(.*?)<\/a>/su.exec(block);
  const authorName = decodeEntities((owner?.[1] ?? '').replaceAll(/<[^>]*>/gu, '')).trim();

  // Основной текст — первый `js-message_text`. Превью ответа размечено другим классом.
  const text = /class="tgme_widget_message_text js-message_text"[^>]*>(.*?)<\/div>/su.exec(block);

  const id = Number(rawId);
  return {
    channel,
    id,
    url: `https://t.me/${channel}/${rawId}`,
    content: htmlToMarkdown(text?.[1] ?? ''),
    postedAt,
    authorName: authorName === '' ? channel : authorName,
  };
}

/**
 * Разбирает HTML страницы `t.me/s/<channel>`. Страница без ленты сообщений — ошибка:
 * так выглядит канал с выключенным превью, группа или несуществующий канал (Telegram
 * отдаёт заглушку «Contact @…» со статусом 200). Пустая лента — не ошибка: мы
 * пролистали канал до самого начала.
 */
export function parseChannelPage(html: string, channel: string): Error | ChannelPage {
  if (!html.includes('tgme_channel_history')) {
    return new Error('Page has no message history: preview is off or channel does not exist');
  }

  const messages: TelegramMessage[] = [];
  for (const block of html.split(MESSAGE_SEPARATOR).slice(1)) {
    const message = parseMessage(block, channel);
    if (message instanceof Error) return message;
    messages.push(message);
  }
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- в сообщении `Date`, глубоко readonly его не сделать
  messages.sort((left, right) => left.id - right.id);
  return { messages };
}
