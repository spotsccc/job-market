import type { AuthorRow } from '@job-market/db';
import type { Connector } from '@job-market/db/values';

import { CONNECTOR_LABELS } from './connectors.ts';

/**
 * Публикация, которую видит модель: строка `publications` с автором из `authors`. Автора
 * может не быть: публикация без автора пишется, если его не удалось определить.
 */
export type PublicationForModel = {
  readonly connector: Connector;
  readonly content: string;
  readonly postedAt: Date;
  readonly author: Readonly<Pick<AuthorRow, 'name' | 'url' | 'headline'>> | null;
};

/**
 * Публикация как текст для модели: источник, автор с подписью и ссылкой помогают понять,
 * кто нанимает и в какую компанию. Текст публикации — в теге `<post>`: промпт говорит
 * модели, что это данные, а не инструкции. Этот же текст получают классификатор и экстрактор.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- в публикации `Date`, глубоко readonly его не сделать
export function formatPublication(publication: PublicationForModel): string {
  const { author } = publication;
  const lines = [`Источник: ${CONNECTOR_LABELS[publication.connector].label}`];
  if (author !== null) {
    lines.push(`Автор: ${author.name}`);
    if (author.headline !== null) lines.push(`Подпись автора: ${author.headline}`);
    lines.push(`Ссылка на автора: ${author.url}`);
  }
  lines.push(`Опубликован: ${publication.postedAt.toISOString()}`);
  return `<post>
${lines.join('\n')}

${publication.content}
</post>`;
}
