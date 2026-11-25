import { decodeEntities, htmlToMarkdown } from '../open-telegram/html-to-markdown.ts';
import type { GreenhouseJob } from './channel.ts';

const stripTags = (html: string): string => html.replaceAll(/<[^>]*>/gu, '');

/**
 * Описание вакансии в Markdown (П8). Greenhouse отдаёт HTML, записанный сущностями, поэтому
 * сущности раскрываются один раз до разбора тегов; сущности внутри текста (`&#39;`) раскрывает
 * потом `htmlToMarkdown` (E1). Блочные теги переводятся здесь: заголовки — `## …`, пункты — `- …`,
 * абзацы и блоки — пустая строка. Ссылки, жирный, курсив и остальное — `htmlToMarkdown`;
 * незнакомые теги снимаются, текст остаётся (E2).
 */
export function descriptionMarkdown(content: string): string {
  const blocks = decodeEntities(content)
    // Переводы строк в HTML — просто пробелы; строки задают только блоки и `<br>`.
    .replaceAll(/\s+/gu, ' ')
    .replaceAll(
      /<h[1-6][^>]*>(.*?)<\/h[1-6]>/gisu,
      (_match, inner: string) => `\n\n## ${stripTags(inner).trim()}\n\n`,
    )
    .replaceAll(/<li[^>]*>/giu, '\n- ')
    .replaceAll(/<\/li>/giu, '')
    .replaceAll(/<\/?(?:p|div|ul|ol|section|article|table|tr)(?:\s[^>]*)?>/giu, '\n\n');

  return htmlToMarkdown(blocks)
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replaceAll(/\n{3,}/gu, '\n\n')
    .trim();
}

/**
 * Текст публикации вакансии (П8): «# название», «Локация: …», «Отделы: …» через запятую,
 * пустая строка и описание. Строки без значения не пишутся.
 */
export function jobContent(job: GreenhouseJob): string {
  const lines = [`# ${job.title.replaceAll(/\s+/gu, ' ').trim()}`];
  if (job.location !== null) lines.push(`Локация: ${job.location}`);
  if (job.departments.length > 0) lines.push(`Отделы: ${job.departments.join(', ')}`);
  const description = descriptionMarkdown(job.content);
  return description === '' ? lines.join('\n') : `${lines.join('\n')}\n\n${description}`;
}
