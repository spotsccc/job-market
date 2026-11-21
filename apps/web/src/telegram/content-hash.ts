import { createHash } from 'node:crypto';

/**
 * Реклама соседнего канала в конце поста: «**Больше вакансий в HR:** https://t.me/forhr».
 * В разных каналах набора она разная, а остальной текст вакансии — дословно тот же.
 */
// Не `\b`: в JavaScript граница слова только для латиницы, «больше\b» не совпадает.
const CROSS_PROMO_LINE = /^[\s*_]*(?:больше|ещ[её]|more)\s.*https:\/\/t\.me\/\w+\/?\s*$/iu;

/**
 * Хэш текста сообщения для поиска одной вакансии в нескольких каналах. Строки
 * рекламы соседних каналов и разница в пробелах на хэш не влияют.
 */
export function contentHash(content: string): string {
  const normalized = content
    .split('\n')
    .filter((line) => !CROSS_PROMO_LINE.test(line))
    .join('\n')
    .replaceAll(/\s+/gu, ' ')
    .trim();
  return createHash('sha256').update(normalized).digest('hex');
}
