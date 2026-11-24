import type { LinkStatus } from '@job-market/db/values';
import { tryAsync } from '@spotsccc/error-as-value';

import type { Reader } from './reader.ts';
import { formatSection, sectionUrls, stripSections } from './section.ts';
import { expandShortLink, isShortLink } from './short-link.ts';
import type { ExpandShortLink } from './short-link.ts';

/** Сколько узнанных ссылок читается в одном тексте. Каждая стоит денег и места во входе модели. */
export const MAX_LINKS_PER_TEXT = 3;

/** Сколько коротких ссылок раскрывается в одном тексте: до раскрытия не видно, чьи они. */
export const MAX_SHORT_LINKS_PER_TEXT = 10;

/** Чья ссылка в отчёте, если это короткая ссылка, которая не раскрылась. */
export const SHORT_LINK_READER = 'short-link';

/** Что енричер сделал с одной ссылкой текста. */
export type LinkReport = {
  /** Ссылка как в тексте. */
  readonly url: string;
  /** Куда ведёт короткая ссылка; у обычной и не раскрытой — `null`. */
  readonly target: string | null;
  readonly status: LinkStatus;
  /** Читатель, который узнал ссылку, или `short-link`; ссылка без читателя — `null`. */
  readonly reader: string | null;
  /** Причина сбоя при `failed`. */
  readonly error: Readonly<Error> | null;
};

/** Текст с дописанными разделами и отчёт по каждой ссылке текста автора. */
export type Enrichment = {
  readonly text: string;
  /** Каждая ссылка один раз, в порядке текста. Ссылки внутри разделов сюда не входят. */
  readonly links: readonly LinkReport[];
};

export type EnrichOptions = {
  /** Порядок важен: ссылку получает первый читатель, который её узнал. */
  readonly readers: readonly Reader[];
  /** Раскрытие коротких ссылок вроде lnkd.in; по умолчанию — запросом к их сервису. */
  readonly expandShortLink?: ExpandShortLink;
};

type Found = { readonly reader: Reader; readonly id: string };

/**
 * Решение по странице текста. `fetch` — читать, раздел подписывается `url`: первой ссылкой
 * на эту страницу. `done` — раздел уже есть. Повторы страницы получают то же решение.
 */
type Slot =
  | { readonly kind: 'fetch'; readonly found: Found; readonly url: string }
  | { readonly kind: 'done'; readonly reader: string | null }
  | { readonly kind: 'over_limit'; readonly reader: string }
  | { readonly kind: 'unsupported' };

/** Ссылка текста до решения: куда ведёт (короткая — после раскрытия) и есть ли её раздел. */
type Candidate = { readonly url: string; readonly target: string | null; readonly done: boolean };

/** Короткая ссылка, которая не дошла до читателей: не раскрылась или сверх десяти. */
type ShortOutcome = {
  readonly url: string;
  readonly status: LinkStatus;
  readonly error: Readonly<Error> | null;
};

/** Разбор текста: решения по ссылкам, которые дошли до читателей, и итог остальных. */
type TextPlan = {
  /** Ссылки текста автора по порядку, без повторов. */
  readonly urls: readonly string[];
  readonly candidates: readonly Candidate[];
  readonly slots: readonly Slot[];
  readonly short: readonly ShortOutcome[];
};

const URL_PATTERN = /https?:\/\/[^\s<>()[\]"'`]+/gu;
const TRAILING_PUNCTUATION = /[.,;:!?]+$/u;

/** Ссылки текста по порядку без повторов, без скобки Markdown и знаков препинания в конце. */
function extractUrls(text: string): string[] {
  const urls = new Set<string>();
  for (const [url] of text.matchAll(URL_PATTERN)) urls.add(url.replace(TRAILING_PUNCTUATION, ''));
  return [...urls];
}

/** Первый читатель, который узнал ссылку, и id её страницы. */
function recognize(url: string, readers: readonly Reader[]): Found | null {
  for (const reader of readers) {
    const id = reader.parseUrl(url);
    if (id !== null) return { reader, id };
  }
  return null;
}

/**
 * Решения по ссылкам текста. Читаются первые три страницы, которые узнали читатели;
 * страница с разделом тоже занимает место среди трёх. Ссылка с разделом, которую читатель
 * не узнаёт (короткая: её уже не раскрывают), занимает место сама по себе.
 */
function pickSlots(candidates: readonly Candidate[], readers: readonly Reader[]): Slot[] {
  const byKey = new Map<string, Slot>();
  return candidates.map(({ url, target, done }): Slot => {
    const found = recognize(target ?? url, readers);
    if (found === null && !done) return { kind: 'unsupported' };
    const key = found === null ? `\u0000${url}` : `${found.reader.kind}\u0000${found.id}`;
    const known = byKey.get(key);
    if (known !== undefined) return known;
    let slot: Slot;
    if (done || found === null) slot = { kind: 'done', reader: found?.reader.kind ?? null };
    else if (byKey.size >= MAX_LINKS_PER_TEXT)
      slot = { kind: 'over_limit', reader: found.reader.kind };
    else slot = { kind: 'fetch', found, url };
    // Сверх трёх страница место не занимает: решение по повтору берётся из `known`.
    if (slot.kind !== 'over_limit') byKey.set(key, slot);
    return slot;
  });
}

/**
 * Разбор каждого текста. Короткие ссылки всех текстов раскрываются одновременно, каждая
 * один раз; читателю достаётся адрес, куда она ведёт.
 */
async function planTexts(
  texts: readonly string[],
  readers: readonly Reader[],
  expand: ExpandShortLink,
): Promise<TextPlan[]> {
  // Короткие ссылки без раздела; раскрываются первые десять каждого текста.
  const parsed = texts.map((text): ParsedText => {
    const done = sectionUrls(text);
    const urls = extractUrls(stripSections(text));
    const short = urls.filter((url) => !done.has(url) && isShortLink(url));
    return {
      urls: urls.map((url) => ({ url, done: done.has(url) })),
      toExpand: short.slice(0, MAX_SHORT_LINKS_PER_TEXT),
      skipped: short.slice(MAX_SHORT_LINKS_PER_TEXT),
    };
  });
  const unique = [...new Set(parsed.flatMap(({ toExpand }) => toExpand))];
  const results = await Promise.all(unique.map(async (url) => expand(url)));
  const expanded = new Map(unique.map((url, index) => [url, results[index] ?? null] as const));

  return parsed.map(({ urls, toExpand, skipped }) => {
    const short: ShortOutcome[] = skipped.map((url) => ({
      url,
      status: 'over_limit',
      error: null,
    }));
    const candidates: Candidate[] = [];
    for (const { url, done } of urls) {
      const result = expanded.get(url);
      if (result instanceof Error) short.push({ url, status: 'failed', error: result });
      else if (typeof result === 'string') candidates.push({ url, target: result, done });
      else if (toExpand.includes(url)) short.push({ url, status: 'no_data', error: null });
      else if (!skipped.includes(url)) candidates.push({ url, target: null, done });
    }
    return {
      urls: urls.map(({ url }) => url),
      candidates,
      slots: pickSlots(candidates, readers),
      short,
    };
  });
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

/** Ссылки текста до раскрытия: какие короткие раскрыть и какие сверх десяти. */
type ParsedText = {
  readonly urls: readonly { readonly url: string; readonly done: boolean }[];
  readonly toExpand: readonly string[];
  readonly skipped: readonly string[];
};

/** Что вернул читатель по странице: тело раздела, `null` — нет данных, или сбой пачки. */
type Lookup = (found: Found) => Readonly<Error> | string | null;

/**
 * Каждый читатель получает все свои id вызова одной пачкой, читатели работают одновременно.
 * Ответ — поиск результата по странице.
 */
async function fetchAll(plans: readonly TextPlan[]): Promise<Lookup> {
  const idsByReader = new Map<Reader, Set<string>>();
  for (const { slots } of plans) {
    for (const slot of slots) {
      if (slot.kind !== 'fetch') continue;
      const ids = idsByReader.get(slot.found.reader) ?? new Set<string>();
      ids.add(slot.found.id);
      idsByReader.set(slot.found.reader, ids);
    }
  }
  const readers = [...idsByReader.keys()];
  const fetched = await Promise.all(
    readers.map(async (reader) => fetchSafely(reader, [...(idsByReader.get(reader) ?? [])])),
  );
  const results = new Map(readers.map((reader, index) => [reader, fetched[index]] as const));
  return ({ reader, id }) => {
    const result = results.get(reader);
    if (result === undefined) return new Error(`Reader ${reader.kind} gave no result`);
    if (result instanceof Error) return result;
    const body = result.get(id);
    return body === undefined || body.trim() === '' ? null : body;
  };
}

/** Отчёт по ссылке, которая дошла до читателей, и тело раздела, если его дописывать. */
function settle(
  candidate: Candidate,
  slot: Slot,
  lookup: Lookup,
): { readonly report: LinkReport; readonly body: string | null } {
  const base = { url: candidate.url, target: candidate.target, error: null };
  if (slot.kind === 'unsupported') {
    return { report: { ...base, status: 'unsupported', reader: null }, body: null };
  }
  if (slot.kind === 'done') {
    return { report: { ...base, status: 'read', reader: slot.reader }, body: null };
  }
  if (slot.kind === 'over_limit') {
    return { report: { ...base, status: 'over_limit', reader: slot.reader }, body: null };
  }
  const reader = slot.found.reader.kind;
  const result = lookup(slot.found);
  if (typeof result === 'string')
    return { report: { ...base, status: 'read', reader }, body: result };
  if (result === null) return { report: { ...base, status: 'no_data', reader }, body: null };
  return { report: { ...base, status: 'failed', reader, error: result }, body: null };
}

/**
 * Дописывает в конец каждого текста разделы с прочитанным по его ссылкам и отчитывается по
 * каждой ссылке. Короткие ссылки сначала раскрываются, раздел подписан самой короткой
 * ссылкой. Ссылки, для которых раздел уже есть, не читаются: повтор с дописанным текстом
 * читает только остальные. Сбой чтения — статус `failed` в отчёте, текст остаётся без
 * раздела; что с этим делать, решает вызывающий.
 */
export async function enrich(
  texts: readonly string[],
  options: EnrichOptions,
): Promise<Enrichment[]> {
  const plans = await planTexts(texts, options.readers, options.expandShortLink ?? expandShortLink);
  const lookup = await fetchAll(plans);

  return texts.map((text, index) => {
    const plan = plans[index];
    if (plan === undefined) return { text, links: [] };
    let enriched = text;
    const links: LinkReport[] = [];
    const written = new Set<Slot>();
    for (const outcome of plan.short) {
      links.push({ ...outcome, target: null, reader: SHORT_LINK_READER });
    }
    for (const [position, candidate] of plan.candidates.entries()) {
      const slot = plan.slots[position];
      if (slot === undefined) continue;
      const { report, body } = settle(candidate, slot, lookup);
      links.push(report);
      if (body !== null && slot.kind === 'fetch' && !written.has(slot)) {
        written.add(slot);
        enriched += formatSection(slot.found.reader.label, slot.url, body);
      }
    }
    return { text: enriched, links: sortByText(links, plan) };
  });
}

/** Отчёт в порядке ссылок текста. */
function sortByText(links: readonly LinkReport[], plan: TextPlan): LinkReport[] {
  return links.toSorted((a, b) => plan.urls.indexOf(a.url) - plan.urls.indexOf(b.url));
}
