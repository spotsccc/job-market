import { tryAsync } from '@spotsccc/error-as-value';

import type { Reader } from './reader.ts';
import { formatSection, sectionUrls, stripSections } from './section.ts';

/** Сколько узнанных ссылок читается в одном тексте. Каждая стоит денег и места во входе модели. */
export const MAX_LINKS_PER_TEXT = 3;

/** Ссылка, которую читатель не прочитал: вернул ошибку или бросил. */
export type EnrichFailure = {
  readonly url: string;
  readonly kind: string;
  readonly id: string;
  readonly error: Error;
};

/** Текст с дописанными разделами и сбои по его ссылкам. */
export type Enrichment = {
  readonly text: string;
  readonly failures: readonly EnrichFailure[];
};

export type EnrichOptions = {
  /** Порядок важен: ссылку получает первый читатель, который её узнал. */
  readonly readers: readonly Reader[];
};

type Link = { readonly url: string; readonly reader: Reader; readonly id: string };

const URL_PATTERN = /https?:\/\/[^\s<>()[\]"'`]+/gu;
const TRAILING_PUNCTUATION = /[.,;:!?]+$/u;

/** Ссылки текста по порядку, без закрывающей скобки Markdown и знаков препинания в конце. */
function extractUrls(text: string): string[] {
  const urls: string[] = [];
  for (const [url] of text.matchAll(URL_PATTERN)) urls.push(url.replace(TRAILING_PUNCTUATION, ''));
  return urls;
}

/**
 * Ссылки текста для чтения: узнанные читателями, без повторов, первые три. Берутся только
 * из текста до разделов: ссылки внутри прочитанного не читаются.
 */
function pickLinks(text: string, readers: readonly Reader[]): Link[] {
  const links: Link[] = [];
  const seen = new Set<string>();
  for (const url of extractUrls(stripSections(text))) {
    if (links.length === MAX_LINKS_PER_TEXT) break;
    for (const reader of readers) {
      const id = reader.parseUrl(url);
      if (id === null) continue;
      const key = `${reader.kind}\u0000${id}`;
      if (!seen.has(key)) {
        seen.add(key);
        links.push({ url, reader, id });
      }
      break;
    }
  }
  return links;
}

/** Читатель бросил вместо ошибки значением: один сломанный читатель не роняет вызов. */
async function fetchSafely(
  reader: Reader,
  ids: readonly string[],
): Promise<Error | ReadonlyMap<string, string>> {
  return tryAsync(
    async () => reader.fetch(ids),
    (cause: unknown) => new Error(`Reader ${reader.kind} threw`, { cause }),
  );
}

/**
 * Дописывает в конец каждого текста разделы с прочитанным по его ссылкам. Каждый читатель
 * получает все свои id вызова одной пачкой, читатели работают одновременно. Ссылки, для
 * которых раздел уже есть, не читаются: повтор с дописанным текстом читает только остальные.
 * Сбои возвращаются по каждой ссылке; что с ними делать, решает вызывающий.
 */
export async function enrich(
  texts: readonly string[],
  options: EnrichOptions,
): Promise<Enrichment[]> {
  const pending = texts.map((text) => {
    const done = sectionUrls(text);
    return pickLinks(text, options.readers).filter((link) => !done.has(link.url));
  });

  const idsByReader = new Map<Reader, Set<string>>();
  for (const link of pending.flat()) {
    const ids = idsByReader.get(link.reader) ?? new Set<string>();
    ids.add(link.id);
    idsByReader.set(link.reader, ids);
  }

  const readers = [...idsByReader.keys()];
  const fetched = await Promise.all(
    readers.map(async (reader) => fetchSafely(reader, [...(idsByReader.get(reader) ?? [])])),
  );
  const results = new Map(readers.map((reader, index) => [reader, fetched[index]] as const));

  return texts.map((text, index) => {
    let enriched = text;
    const failures: EnrichFailure[] = [];
    for (const { url, reader, id } of pending[index] ?? []) {
      const result = results.get(reader);
      if (result === undefined) continue;
      if (result instanceof Error) {
        failures.push({ url, kind: reader.kind, id, error: result });
        continue;
      }
      const body = result.get(id);
      if (body === undefined || body.trim() === '') continue;
      enriched += formatSection(reader.label, url, body);
    }
    return { text: enriched, failures };
  });
}
