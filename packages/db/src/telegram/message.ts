import { NOT_VACANCY_REASONS } from '@job-market/core';
import { relations } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { posts } from '../vacancy/post.ts';

/**
 * Статус сообщения в очереди разбора:
 * - `pending` — собрано, ждёт моделей;
 * - `processing` — взято в разбор; если `claimedAt` давно, разбор умер и сообщение берут снова;
 * - `vacancy` — вакансия, пост и вакансии записаны в `posts`/`vacancies` (`postId`);
 * - `not_vacancy` — модели решили, что не вакансия (`notVacancyReason`, `note`);
 * - `duplicate` — тот же текст уже разобран в другом сообщении (`duplicateOfId`);
 * - `empty` — сообщение без текста: картинка, служебное. Модели не зовём;
 * - `failed` — разбор упал, `lastError`. Повторяем, пока `attempts` меньше предела.
 */
export const TELEGRAM_MESSAGE_STATUSES = [
  'pending',
  'processing',
  'vacancy',
  'not_vacancy',
  'duplicate',
  'empty',
  'failed',
] as const;
export type TelegramMessageStatus = (typeof TELEGRAM_MESSAGE_STATUSES)[number];

/**
 * Каждое собранное сообщение Telegram-канала, в том числе не вакансии: это и
 * очередь разбора моделями, и память о том, что уже собрано. Вакансии отсюда
 * попадают в общие `posts`/`vacancies`, как посты LinkedIn.
 */
export const telegramMessages = pgTable(
  'telegram_messages',
  {
    id: uuid().primaryKey().defaultRandom(),
    /** Юзернейм канала в нижнем регистре: `forproducts`. */
    channel: text().notNull(),
    /** Номер сообщения в канале. */
    messageId: integer().notNull(),
    url: text().notNull(),
    /** Текст в Markdown со ссылками. */
    content: text().notNull(),
    postedAt: timestamp({ withTimezone: true }).notNull(),
    /** Название канала. */
    authorName: text().notNull(),
    /**
     * Хэш текста без рекламы соседних каналов. Каналы набора публикуют одну вакансию
     * дословно в нескольких каналах: моделями разбираем только одну копию.
     */
    contentHash: text().notNull(),
    status: text({ enum: TELEGRAM_MESSAGE_STATUSES }).notNull().default('pending'),
    /** Сколько раз сообщение брали в разбор. */
    attempts: integer().notNull().default(0),
    claimedAt: timestamp({ withTimezone: true }),
    processedAt: timestamp({ withTimezone: true }),
    lastError: text(),
    notVacancyReason: text({ enum: NOT_VACANCY_REASONS }),
    /** Пояснение классификатора, почему не вакансия. */
    note: text(),
    postId: uuid().references(() => posts.id, { onDelete: 'set null' }),
    duplicateOfId: uuid().references((): AnyPgColumn => telegramMessages.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('telegram_messages_channel_message_id_unique').on(table.channel, table.messageId),
    index().on(table.status),
    index().on(table.contentHash),
  ],
);

export type TelegramMessageRow = typeof telegramMessages.$inferSelect;
export type NewTelegramMessageRow = typeof telegramMessages.$inferInsert;

export const telegramMessagesRelations = relations(telegramMessages, ({ one }) => ({
  post: one(posts, { fields: [telegramMessages.postId], references: [posts.id] }),
}));
