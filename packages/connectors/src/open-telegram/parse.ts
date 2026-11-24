import type { ParsedPublication, ParseInput, ParseResult } from '../contract.ts';
import type { TelegramChannel } from './channel.ts';
import type { TelegramMessage } from './parse-page.ts';

/**
 * Где проход по каналу (П4–П6). Проход идёт от новых сообщений вниз, пока не встретит уже
 * прочитанное, границу глубины или начало канала.
 * - `cursorId` — до какого номера всё прочитано прошлыми проходами;
 * - `passTopId` — самое новое сообщение незаконченного прохода;
 * - `resumeBeforeId` — с какого номера качать следующую страницу незаконченного прохода.
 */
export type TelegramCursor = {
  readonly cursorId?: number | undefined;
  readonly passTopId?: number;
  readonly resumeBeforeId?: number;
};

export type TelegramConfig = {
  /** Юзернейм канала; без него — ключ источника. */
  readonly channel?: string | undefined;
};

/** Проход по каналу: где он сейчас. */
type Pass = {
  readonly cursorId: number | null;
  /** `null` — первая страница прохода ещё не скачана. */
  readonly passTopId: number | null;
};

type PagePlan = {
  readonly messages: readonly TelegramMessage[];
  /** Номер, с которого качать следующую страницу; `null` — проход закончен. */
  readonly nextBefore: number | null;
  readonly passTopId: number | null;
};

/**
 * Что делать со скачанной страницей: какие сообщения взять и идти ли дальше вниз. Дальше не
 * идём, если дошли до уже прочитанного, до границы глубины или до начала канала.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- в сообщении и публикации `Date`, глубоко readonly его не сделать
function planPage(messages: readonly TelegramMessage[], pass: Pass, cutoff: number): PagePlan {
  const { cursorId } = pass;
  const oldest = messages[0];
  const passTopId = pass.passTopId ?? messages.at(-1)?.id ?? null;
  const taken = messages.filter(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- в сообщении и публикации `Date`, глубоко readonly его не сделать
    (message) =>
      (cursorId === null || message.id > cursorId) && message.postedAt.getTime() >= cutoff,
  );
  const reachedEnd =
    oldest === undefined ||
    (cursorId !== null && oldest.id <= cursorId) ||
    oldest.postedAt.getTime() < cutoff ||
    oldest.id <= 1;
  return { messages: taken, passTopId, nextBefore: reachedEnd ? null : oldest.id };
}

/** Курсор без пустых полей: `{ cursorId: 10 }`, а не `{ cursorId: 10, passTopId: null }`. */
function cursorOf(
  cursorId: number | null,
  passTopId: number | null,
  resumeBeforeId: number | null,
): TelegramCursor | null {
  const cursor = {
    ...(cursorId === null ? {} : { cursorId }),
    ...(passTopId === null ? {} : { passTopId }),
    ...(resumeBeforeId === null ? {} : { resumeBeforeId }),
  };
  return Object.keys(cursor).length === 0 ? null : cursor;
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- в сообщении и публикации `Date`, глубоко readonly его не сделать
function toPublication(message: TelegramMessage): ParsedPublication {
  return {
    externalId: `${message.channel}/${String(message.id)}`,
    url: message.url,
    content: message.content,
    publishedAt: message.postedAt,
    author: {
      externalId: message.channel,
      name: message.authorName,
      url: `https://t.me/${message.channel}`,
      headline: null,
    },
  };
}

/**
 * Проход по страницам `t.me/s/<канал>` от новых вниз (П4–П7). Первый проход берёт всё не
 * старше `since`, следующие — только новее `cursorId`. После `deadline` новая страница не
 * качается: `more` и курсор незаконченного прохода. Сбой страницы — прочитанное, курсор
 * последней удачной страницы и `error`; не скачано ни одной страницы — `Error`.
 */
export async function parseTelegram(
  channel: Pick<TelegramChannel, 'fetchPage'>,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- в сообщении и публикации `Date`, глубоко readonly его не сделать
  input: ParseInput<TelegramConfig, TelegramCursor>,
): Promise<Error | ParseResult<TelegramCursor>> {
  const name = input.config.channel ?? input.key;
  const cutoff = input.since.getTime();
  const cursorId = input.cursor?.cursorId ?? null;
  let passTopId = input.cursor?.passTopId ?? null;
  let before = input.cursor?.resumeBeforeId ?? null;
  const publications: ParsedPublication[] = [];
  let pages = 0;

  for (;;) {
    const cursor = cursorOf(cursorId, passTopId, before);
    if (Date.now() >= input.deadline) return { publications, cursor, more: true };

    // Страницы одного канала идут строго по очереди: следующая начинается там, где кончилась эта.
    // oxlint-disable-next-line eslint/no-await-in-loop
    const page = await channel.fetchPage(name, before ?? undefined);
    if (page instanceof Error) {
      if (pages === 0) return page;
      return { publications, cursor, more: false, error: page };
    }
    pages += 1;

    const plan = planPage(page.messages, { cursorId, passTopId }, cutoff);
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- в сообщении и публикации `Date`, глубоко readonly его не сделать
    publications.push(...plan.messages.map((message) => toPublication(message)));
    if (plan.nextBefore === null) {
      const top = Math.max(cursorId ?? 0, plan.passTopId ?? 0);
      return { publications, cursor: cursorOf(top === 0 ? null : top, null, null), more: false };
    }
    ({ passTopId } = plan);
    before = plan.nextBefore;
  }
}
