import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Курсор сбора Telegram-канала. Инвариант: все сообщения канала от границы глубины
 * сбора до `cursorId` включительно уже лежат в `telegram_messages`. Проход идёт от
 * самых новых сообщений вниз и может прерваться, тогда следующий запуск продолжает
 * его с `resumeBeforeId`. Только законченный проход сдвигает `cursorId` на
 * `passTopId`, поэтому прерванный проход не оставляет дыр.
 */
export const telegramChannels = pgTable('telegram_channels', {
  /** Юзернейм канала в нижнем регистре, без `@`: `forproducts`. */
  channel: text().primaryKey(),
  /** До какого номера сообщения всё собрано. `null` — законченных проходов ещё не было. */
  cursorId: integer(),
  /** Самое новое сообщение текущего прохода. `null` — прохода нет. */
  passTopId: integer(),
  /** Где продолжать текущий проход: следующая страница — сообщения с номером меньше этого. */
  resumeBeforeId: integer(),
  /** Когда закончился последний проход. */
  lastCrawledAt: timestamp({ withTimezone: true }),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type TelegramChannelRow = typeof telegramChannels.$inferSelect;
