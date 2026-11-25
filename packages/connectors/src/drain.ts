import { isOutOfCredits } from '@job-market/apify';
import {
  addPublications,
  authorKey,
  contentHash,
  db,
  saveCursor,
  upsertAuthors,
} from '@job-market/db';
import type { AuthorToSave, LinkToSave, NewPublicationToSave } from '@job-market/db';
import { enrich } from '@job-market/enricher';
import type { Enrichment, LinkReport, Reader } from '@job-market/enricher';
import { log } from '@job-market/logger';

import { DEPTH_DAYS } from './contract.ts';
import type {
  ConnectorDefinition,
  DrainOptions,
  DrainResult,
  DrainSource,
  ParsedPublication,
  ParseResult,
} from './contract.ts';

const moduleLog = log.with({ module: 'connectors' });

const DAY_MS = 24 * 60 * 60 * 1000;

/** Сколько раз всего зовётся `enrich`, если ссылки не прочитались (E8). */
export const MAX_ENRICH_ATTEMPTS = 3;

/** Повтор `enrich` начинается, только если до `deadline` не меньше этого: столько ждёт актор (E8). */
export const ENRICH_RETRY_MIN_MS = 60_000;

/** Ошибка одной строкой для `publication_links.error`: сообщение и причина. */
function errorText(error: Readonly<Error>): string {
  const cause = error.cause instanceof Error ? `: ${error.cause.message}` : '';
  return `${error.message}${cause}`.split('\n')[0] ?? error.message;
}

function linkRow(link: LinkReport): LinkToSave {
  return {
    url: link.url,
    targetUrl: link.target,
    status: link.status,
    reader: link.reader,
    error: link.error === null ? null : errorText(link.error),
  };
}

const hasFailure = (enrichment: Enrichment): boolean =>
  enrichment.links.some((link) => link.status === 'failed');

/**
 * Дописывает разделы по ссылкам и повторяет `enrich` для текстов со сбоем (П13, E8): повтор
 * получает уже дописанный текст и читает только непрочитанные ссылки. Первый вызов идёт и после
 * `deadline`; повтор — только пока до него не меньше минуты, не больше трёх вызовов всего и не
 * после 402.
 */
async function enrichWithRetries(
  texts: readonly string[],
  readers: readonly Reader[],
  deadline: number,
): Promise<Enrichment[]> {
  const results = await enrich(texts, { readers });
  for (let attempt = 1; attempt < MAX_ENRICH_ATTEMPTS; attempt += 1) {
    const failed = results.flatMap((result, index) => (hasFailure(result) ? [index] : []));
    if (failed.length === 0) break;
    const outOfCredits = failed.some(
      (index) =>
        results[index]?.links.some((link) => link.error !== null && isOutOfCredits(link.error)) ===
        true,
    );
    if (outOfCredits || deadline - Date.now() < ENRICH_RETRY_MIN_MS) break;

    // Повтор ждёт предыдущий: он читает то, что тот не прочитал.
    // oxlint-disable-next-line eslint/no-await-in-loop
    const retried = await enrich(
      failed.map((index) => results[index]?.text ?? ''),
      { readers },
    );
    for (const [position, index] of failed.entries()) {
      const result = retried[position];
      if (result !== undefined) results[index] = result;
    }
  }
  return results;
}

type Connector = ConnectorDefinition['id'];

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- в публикации `Date`, глубоко readonly его не сделать
function authorRow(connector: Connector, publication: ParsedPublication): AuthorToSave[] {
  const { author } = publication;
  if (author === null) return [];
  const { externalId, name, url, headline } = author;
  return [{ connector, externalId, name, url, headline }];
}

/**
 * Тексты публикаций с разделами по ссылкам LinkedIn и отчёт по ссылкам (П13): по индексу
 * публикации. Ссылка, которая не прочиталась и после повторов, — предупреждение в лог; итог
 * `drain` она не меняет.
 */
async function readLinks(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- в публикации `Date`, глубоко readonly его не сделать
  publications: readonly ParsedPublication[],
  readers: readonly Reader[],
  deadline: number,
): Promise<ReadonlyMap<number, Enrichment>> {
  if (publications.length === 0) return new Map();
  const results = await enrichWithRetries(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- в публикации `Date`, глубоко readonly его не сделать
    publications.map((publication) => publication.content),
    readers,
    deadline,
  );
  const enriched = new Map<number, Enrichment>();
  for (const [index, result] of results.entries()) {
    enriched.set(index, result);
    for (const link of result.links) {
      if (link.status !== 'failed') continue;
      moduleLog.warn('Linked content fetch failed', {
        kind: link.reader,
        id: publications[index]?.externalId,
        url: link.url,
        err: link.error,
      });
    }
  }
  return enriched;
}

/** Строка публикации для записи (П10): текст с разделами, хэш — по тексту без них. */
function publicationRow(
  connector: Connector,
  sourceId: string,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- в публикации `Date`, глубоко readonly его не сделать
  publication: ParsedPublication,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- в публикации `Date`, глубоко readonly его не сделать
  context: {
    readonly now: Date;
    readonly enrichment: Enrichment | undefined;
    readonly authors: ReadonlyMap<string, string>;
  },
): NewPublicationToSave {
  const { enrichment, authors } = context;
  const authorId =
    publication.author === null
      ? null
      : (authors.get(authorKey(connector, publication.author.externalId)) ?? null);
  return {
    publication: {
      sourceId,
      connector,
      externalId: publication.externalId,
      url: publication.url,
      content: enrichment?.text ?? publication.content,
      contentHash: contentHash(publication.content),
      postedAt: publication.publishedAt ?? context.now,
      payload: publication.payload ?? null,
      status: 'pending',
      authorId,
    },
    links: (enrichment?.links ?? []).map((link) => linkRow(link)),
  };
}

/**
 * Авторы, новые публикации со ссылками и курсор одной транзакцией (П9, П10). Ответ — id новых
 * публикаций; сбой базы — `Error`, не записано ничего.
 */
async function write(
  connector: Connector,
  source: DrainSource,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- в публикации `Date`, глубоко readonly его не сделать
  parsed: ParseResult<unknown>,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- в публикации `Date`, глубоко readonly его не сделать
  context: { readonly now: Date; readonly enriched: ReadonlyMap<number, Enrichment> },
): Promise<Error | readonly string[]> {
  const { publications } = parsed;
  return (
    db
      // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- транзакцию drizzle передаёт сам
      .transaction(async (tx) => {
        const authors = await upsertAuthors(
          tx,
          // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- в публикации `Date`, глубоко readonly его не сделать
          publications.flatMap((publication) => authorRow(connector, publication)),
        );
        // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- в публикации `Date`, глубоко readonly его не сделать
        const rows = publications.map((publication, index) =>
          publicationRow(connector, source.id, publication, {
            now: context.now,
            enrichment: context.enriched.get(index),
            authors,
          }),
        );
        const inserted = await addPublications(tx, rows);
        await saveCursor(tx, source.id, parsed.cursor);
        return [...inserted.values()];
      })
      .catch(
        (cause: unknown) =>
          new Error(`Writing publications of source ${source.key} failed`, { cause }),
      )
  );
}

/**
 * Опрос источника (П9–П11, П13): `parse` коннектора, чтение ссылок LinkedIn и запись авторов,
 * новых публикаций, их ссылок и курсора одной транзакцией. Расписание источника — ошибки
 * подряд, `next_run_at` и прочее — не трогает: его пишет движок. `Error` — только сбой базы.
 */
export async function drain<Config, Cursor>(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- в публикации `Date`, глубоко readonly его не сделать
  connector: ConnectorDefinition<Config, Cursor>,
  source: DrainSource,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- в публикации `Date`, глубоко readonly его не сделать
  options: DrainOptions & { readonly readers: readonly Reader[] },
): Promise<Error | DrainResult> {
  const config = connector.configSchema.safeParse(source.config);
  if (!config.success) {
    const error = new Error(`Config of source ${source.key} is invalid`, { cause: config.error });
    return { status: 'failed', inserted: 0, pendingIds: [], cursor: source.cursor, error };
  }
  const cursor = connector.cursorSchema.safeParse(source.cursor);
  const parsed = await connector.parse({
    config: config.data,
    cursor: cursor.success ? cursor.data : null,
    key: source.key,
    since: new Date(options.now.getTime() - DEPTH_DAYS * DAY_MS),
    deadline: options.deadline,
  });
  if (parsed instanceof Error) {
    return { status: 'failed', inserted: 0, pendingIds: [], cursor: source.cursor, error: parsed };
  }

  const enriched = await readLinks(parsed.publications, options.readers, options.deadline);
  const pendingIds = await write(connector.id, source, parsed, { now: options.now, enriched });
  if (pendingIds instanceof Error) return pendingIds;

  const written = { inserted: pendingIds.length, pendingIds, cursor: parsed.cursor };
  if (parsed.error !== undefined) return { status: 'failed', ...written, error: parsed.error };
  return { status: parsed.more ? 'more' : 'done', ...written };
}
