/**
 * Почему публикацию нечего разбирать:
 * - `empty` — текста нет или одни пробелы: картинка без подписи, репост без комментария;
 * - `no_words` — нет ни одной буквы: только эмодзи, цифры и знаки («🔥🔥🔥», «+»).
 */
export const SKIP_REASONS = ['empty', 'no_words'] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

/**
 * Причина не звать модель или `undefined`, если в тексте есть хоть одна буква. Ссылка
 * состоит из букв, поэтому публикация из одной ссылки разбирается: за ней может быть вакансия.
 */
export function skipReason(content: string): SkipReason | undefined {
  if (content.trim() === '') return 'empty';
  if (!/\p{L}/u.test(content)) return 'no_words';
  return undefined;
}
