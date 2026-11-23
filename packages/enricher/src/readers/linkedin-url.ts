import { tryFn } from '@spotsccc/error-as-value';

/**
 * Путь ссылки на linkedin.com или любой его поддомен, раскодированный: `urn:li:activity:`
 * бывает в пути закодированным. Параметры после `?` не важны. Не LinkedIn — `null`.
 */
export function linkedinPath(url: string): string | null {
  const parsed = tryFn(() => new URL(url));
  if (parsed instanceof Error) return null;
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  const host = parsed.hostname.toLowerCase();
  if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) return null;

  const decoded = tryFn(() => decodeURIComponent(parsed.pathname));
  return decoded instanceof Error ? parsed.pathname : decoded;
}
