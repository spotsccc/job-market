import { tryFn } from '@spotsccc/error-as-value';
import { eq } from 'drizzle-orm';

import type { DbExecutor } from '../client.ts';
import type { NewPublicationLinkRow } from './publication-link.ts';
import { publicationLinks } from './publication-link.ts';

/** Ссылка публикации для записи: номер ссылки — её индекс в списке, хост считается здесь. */
export type LinkToSave = Readonly<
  Pick<NewPublicationLinkRow, 'url' | 'targetUrl' | 'status' | 'reader' | 'error'>
>;

/** Хост ссылки в нижнем регистре; ссылка не разбирается — пустая строка. */
function hostOf(url: string): string {
  const parsed = tryFn(() => new URL(url));
  return parsed instanceof Error ? '' : parsed.hostname.toLowerCase();
}

/**
 * Перезаписывает ссылки публикации: удаляет прежние и вставляет `links` по порядку. Хост —
 * по `targetUrl`, а без него — по `url`. Транзакцию держит вызывающий.
 */
export async function replacePublicationLinks(
  db: DbExecutor,
  publicationId: string,
  links: readonly LinkToSave[],
): Promise<void> {
  await db.delete(publicationLinks).where(eq(publicationLinks.publicationId, publicationId));
  if (links.length === 0) return;
  await db.insert(publicationLinks).values(
    links.map((link, position) => ({
      ...link,
      publicationId,
      position,
      host: hostOf(link.targetUrl ?? link.url),
    })),
  );
}
