import assert from 'node:assert/strict';

import { and, asc, authors, db, eq, getDb, like, publications, sources } from '@job-market/db';
import type { PublicationRow, SourceRow } from '@job-market/db';

import { assemble } from './assemble.ts';
import type { Connector, DrainResult, Processor } from './contract.ts';
import { fakeTelegram } from './open-telegram/fake-telegram.test-utils.ts';
import { openTelegram } from './open-telegram/index.ts';
import type { TelegramMessage } from './open-telegram/parse-page.ts';

/** Момент опроса в тестах `drain`: публикации датируются относительно него. */
export const NOW = new Date('2026-11-20T12:00:00.000Z');

export type TestSource = {
  /** Ключ источника и юзернейм канала: начинается с префикса файла. */
  readonly key: string;
  readonly id: () => string;
  readonly row: () => Promise<SourceRow>;
  /** `drain` источника; `Error` роняет тест. */
  readonly drain: (connector: Connector, deadline?: number) => Promise<DrainResult>;
  /** Публикации источника по `external_id`. */
  readonly publications: () => Promise<PublicationRow[]>;
  readonly publication: (externalId: string) => Promise<PublicationRow>;
  /** Перед тестом: без публикаций, авторов и курсора. */
  readonly reset: () => Promise<void>;
  /** После файла: строки удалены, пул закрыт. */
  readonly close: () => Promise<void>;
};

async function removeRows(prefix: string): Promise<void> {
  await db.delete(publications).where(like(publications.externalId, `${prefix}%`));
  await db.delete(authors).where(like(authors.externalId, `${prefix}%`));
}

async function sourceRow(id: string): Promise<SourceRow> {
  const [found] = await db.select().from(sources).where(eq(sources.id, id));
  assert.ok(found !== undefined);
  return found;
}

async function publicationRow(externalId: string): Promise<PublicationRow> {
  const [found] = await db
    .select()
    .from(publications)
    .where(
      and(eq(publications.connector, 'open-telegram'), eq(publications.externalId, externalId)),
    );
  assert.ok(found !== undefined, `publication ${externalId} is not written`);
  return found;
}

/**
 * Источник open-telegram в тестовой базе из `apps/web/.env.test`. Ключ, id публикаций и
 * авторов начинаются с `prefix`: файлы тестов идут параллельно на одной базе (E7).
 */
export async function testSource(prefix: string): Promise<TestSource> {
  const key = `${prefix}forhr`;
  await removeRows(prefix);
  await db.delete(sources).where(eq(sources.key, key));
  const [created] = await db
    .insert(sources)
    .values({ connector: 'open-telegram', key, platform: 'geekjobs', name: key })
    .returning({ id: sources.id });
  assert.ok(created !== undefined);
  const { id } = created;

  return {
    key,
    id: () => id,
    row: async () => sourceRow(id),
    drain: async (connector, deadline = Date.now() + 600_000) => {
      const result = await connector.drain(await sourceRow(id), { now: NOW, deadline });
      assert.ok(!(result instanceof Error), result instanceof Error ? String(result.cause) : '');
      return result;
    },
    publications: async () =>
      db
        .select()
        .from(publications)
        .where(like(publications.externalId, `${prefix}%`))
        .orderBy(asc(publications.externalId)),
    publication: publicationRow,
    reset: async () => {
      await removeRows(prefix);
      await db.update(sources).set({ cursor: null }).where(eq(sources.id, id));
    },
    close: async () => {
      await removeRows(prefix);
      await db.delete(sources).where(eq(sources.id, id));
      await getDb().$client.end();
    },
  };
}

const process: Processor = () => Promise.resolve(new Error('drain does not process'));

/** Коннектор open-telegram на поддельном t.me: для тестов `drain`, модели он не зовёт. */
export function telegramConnector(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- в публикации `Date`, глубоко readonly его не сделать
  messages: ReadonlyMap<string, readonly TelegramMessage[]>,
): Connector {
  const telegram = fakeTelegram(messages);
  return assemble(openTelegram({ telegram, process }), { readers: [] });
}
