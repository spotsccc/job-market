import type { AuthorToSave, LegacyPostRow, PostSource } from '@job-market/db';
import type { Connector } from '@job-market/db/values';

/**
 * Пост `legacy_posts` в новой модели (П2, П3): ключ источника, автор и поля публикации, которые
 * переносятся без изменений. Статус, текст с разделами и хэш добавляет перенос.
 */

/** Коннектор публикации по источнику поста (П2). */
export const CONNECTOR_BY_SOURCE: Readonly<Record<PostSource, Connector>> = {
  telegram: 'open-telegram',
  linkedin: 'linkedin',
};

/** Ключ источника ручного поиска LinkedIn: его заводит миграция `0010_occupations_sources`. */
const LINKEDIN_MANUAL_KEY = 'manual';

/** Путь профиля LinkedIn: `in/jane-doe` или `company/acme`. */
const LINKEDIN_PROFILE = /^\/(in|company)\/([^/]+)/u;

export type MappedPost = {
  /** Источник по `(connector, key)` — его заводит миграция для всех каналов постов. */
  readonly source: { readonly connector: Connector; readonly key: string };
  /** `null` — у поста LinkedIn ссылка автора не на профиль: публикация пишется без автора. */
  readonly author: AuthorToSave | null;
  readonly publication: {
    /** Тот же id, что у поста: «перенесён ли пост» проверяется без таблицы соответствий. */
    readonly id: string;
    readonly connector: Connector;
    readonly externalId: string;
    readonly url: string;
    readonly content: string;
    readonly postedAt: Date;
  };
};

/** Путь профиля из ссылки автора LinkedIn; `null` — ссылка не на человека и не на компанию. */
function linkedinProfile(url: string): string | null {
  if (!URL.canParse(url)) return null;
  const match = LINKEDIN_PROFILE.exec(new URL(url).pathname);
  const [, kind, name] = match ?? [];
  return kind === undefined || name === undefined ? null : `${kind}/${decodeURIComponent(name)}`;
}

function authorExternalId(post: Readonly<LegacyPostRow>, channel: string): string | null {
  return post.source === 'telegram' ? channel : linkedinProfile(post.authorUrl);
}

/** Публикация, источник и автор поста. */
export function mapPost(post: Readonly<LegacyPostRow>): MappedPost {
  const connector = CONNECTOR_BY_SOURCE[post.source];
  // Telegram: external_id — «канал/номер», канал — и ключ источника, и автор.
  const channel = post.externalId.split('/')[0] ?? post.externalId;
  const authorId = authorExternalId(post, channel);
  return {
    source: { connector, key: post.source === 'telegram' ? channel : LINKEDIN_MANUAL_KEY },
    author:
      authorId === null
        ? null
        : {
            connector,
            externalId: authorId,
            name: post.authorName,
            url: post.authorUrl,
            headline: post.authorHeadline,
          },
    publication: {
      id: post.id,
      connector,
      externalId: post.externalId,
      url: post.url,
      content: post.content,
      postedAt: post.postedAt,
    },
  };
}
