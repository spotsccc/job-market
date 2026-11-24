import type { LegacyPostRow, VacancyToSave } from '@job-market/db';
import type { LinkReport } from '@job-market/enricher';

import type { MappedPost } from './map-post.ts';

/** Чем закончился разбор поста до записи. */
export type Outcome =
  /** Ещё не решено: пост идёт в экстрактор. */
  | { readonly kind: 'pending' }
  | { readonly kind: 'vacancy'; readonly roles: readonly VacancyToSave[] }
  /** Пустой текст: модель не зовётся (П5). */
  | { readonly kind: 'not_vacancy'; readonly reason: 'not_hiring'; readonly note: string }
  | { readonly kind: 'duplicate'; readonly originalId: string }
  /** Копия ждёт оригинал из этой пачки (П4, E7). */
  | { readonly kind: 'follower'; readonly leaderId: string }
  /**
   * `fromModel` — не выполнился сам вызов модели: сеть, 429, кончились кредиты. По нему запуск
   * решает, не остановиться ли (E8). Ответ не по схеме, в том числе без ролей, — не такой сбой.
   */
  | { readonly kind: 'failed'; readonly error: Error; readonly fromModel: boolean };

/** Итог, с которым пост пишется. */
export type Written = Exclude<Outcome, { kind: 'follower' } | { kind: 'pending' }>;

/** Пост пачки: что пишется и с каким итогом. */
export type Prepared = {
  readonly post: Readonly<LegacyPostRow>;
  readonly mapped: MappedPost;
  /** Текст с разделами по ссылкам (П8). */
  readonly content: string;
  /** Хэш текста без разделов (П4). */
  readonly hash: string;
  /** Что енричер сделал с каждой ссылкой текста (П8): пишется в `publication_links`. */
  readonly links: readonly LinkReport[];
  outcome: Outcome;
};

/** Ошибка одной строкой для `last_error` и итога: сообщение и причина. */
export function errorText(error: Readonly<Error>): string {
  const cause = error.cause instanceof Error ? `: ${error.cause.message}` : '';
  return `${error.message}${cause}`.split('\n')[0] ?? error.message;
}
