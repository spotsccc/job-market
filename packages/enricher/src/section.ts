/** Раздел вместе с заголовком длиннее этого обрезается: столько символов во входе модели на ссылку. */
export const MAX_SECTION_LENGTH = 8000;

/** Заголовок раздела: `--- Вакансия LinkedIn по ссылке https://…`, отдельной строкой. */
const HEADER = /^--- .+? по ссылке (\S+)$/gmu;

/**
 * Раздел с прочитанным по ссылке для конца текста: пустая строка, заголовок и тело.
 * Раздел вместе с заголовком — не длиннее `MAX_SECTION_LENGTH` символов.
 */
export function formatSection(label: string, url: string, body: string): string {
  const section = `--- ${label} по ссылке ${url}\n${body}`;
  return `\n\n${section.slice(0, MAX_SECTION_LENGTH)}`;
}

/** Url разделов, которые уже дописаны в текст. */
export function sectionUrls(text: string): ReadonlySet<string> {
  const urls = new Set<string>();
  for (const [, url] of text.matchAll(HEADER)) if (url !== undefined) urls.add(url);
  return urls;
}

/** Текст до первого раздела — то, что написал автор публикации. */
export function stripSections(text: string): string {
  const first = new RegExp(HEADER.source, 'mu').exec(text);
  return first === null ? text : text.slice(0, first.index).trimEnd();
}
