import { getDomain } from 'tldts';

import type { CompanyKeyKind } from './company.ts';

/** Ключ компании: `domain yandex.ru`, `linkedin company/acme`, `name яндекс`. */
export type CompanyKey = { readonly kind: CompanyKeyKind; readonly value: string };

/** Организационно-правовые формы: убираются целым словом в начале или в конце названия (П1). */
const LEGAL_FORMS = [
  'ооо',
  'оао',
  'зао',
  'пао',
  'ао',
  'ип',
  'llc',
  'inc',
  'ltd',
  'gmbh',
  'corp',
  'plc',
  'co',
].join('|');
const LEADING_FORM = new RegExp(`^(?:${LEGAL_FORMS})(?=[\\s\\p{P}]|$)`, 'u');
const TRAILING_FORM = new RegExp(`(?<=^|[\\s\\p{P}])(?:${LEGAL_FORMS})$`, 'u');
const QUOTES = /[«»"'„“”`]/gu;
const EDGE_PUNCTUATION = /^[\s\p{P}]+|[\s\p{P}]+$/gu;

/**
 * Название в одном виде (П1): NFKC, нижний регистр, ё → е, без кавычек, без
 * организационно-правовой формы по краям и знаков препинания по краям, пробелы схлопнуты.
 * `null` — после этого ничего не осталось: ключа по названию нет.
 */
export function normalizeName(company: string): string | null {
  let name = company
    .normalize('NFKC')
    .toLowerCase()
    .replaceAll('ё', 'е')
    .replaceAll(QUOTES, '')
    .replaceAll(/\s+/gu, ' ');
  for (;;) {
    const next = name
      .replaceAll(EDGE_PUNCTUATION, '')
      .replace(LEADING_FORM, '')
      .replace(TRAILING_FORM, '')
      .replaceAll(EDGE_PUNCTUATION, '');
    if (next === name) break;
    name = next;
  }
  return name === '' ? null : name;
}

/**
 * Хосты, ссылка на которые не говорит, что за компания: агрегаторы, мессенджеры, формы и
 * конструкторы страниц. Хост из списка или его поддомен ключа не даёт (П2).
 */
export const NOT_COMPANY_HOSTS: readonly string[] = [
  'hh.ru',
  't.me',
  'telegram.me',
  'forms.gle',
  'docs.google.com',
  'notion.site',
  'greenhouse.io',
  'lever.co',
  'career.habr.com',
  'getmatch.ru',
];

const LINKEDIN_COMPANY = /^\/company\/([^/]+)/iu;
const SCHEME = /^[a-z][a-z\d+.-]*:\/\//iu;

function parseUrl(url: string): URL | null {
  try {
    return new URL(SCHEME.test(url) ? url : `https://${url}`);
  } catch {
    return null;
  }
}

function isUnder(host: string, parent: string): boolean {
  return host === parent || host.endsWith(`.${parent}`);
}

/**
 * Ключ по ссылке на компанию (П2): страница компании LinkedIn — `linkedin company/<slug>`,
 * иначе — регистрируемый домен хоста. Хост берётся из `URL`, поэтому он в нижнем регистре и в
 * punycode. `null` — ссылка не разбирается, ведёт не на компанию или у хоста нет домена.
 */
export function keyOfUrl(url: string): CompanyKey | null {
  const parsed = parseUrl(url.trim());
  if (parsed === null || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) {
    return null;
  }
  const host = parsed.hostname;
  if (isUnder(host, 'linkedin.com')) {
    const slug = LINKEDIN_COMPANY.exec(parsed.pathname)?.[1];
    return slug === undefined ? null : { kind: 'linkedin', value: `company/${slug.toLowerCase()}` };
  }
  if (NOT_COMPANY_HOSTS.some((parent) => isUnder(host, parent))) return null;
  const domain = getDomain(host);
  return domain === null ? null : { kind: 'domain', value: domain };
}

/** Ключи вакансии в порядке поиска (П3): domain, linkedin, name. Пустой — ключей нет. */
export function keysOf(company: string | null, companyUrl: string | null): CompanyKey[] {
  const keys: CompanyKey[] = [];
  const urlKey = companyUrl === null ? null : keyOfUrl(companyUrl);
  if (urlKey !== null) keys.push(urlKey);
  const name = company === null ? null : normalizeName(company);
  if (name !== null) keys.push({ kind: 'name', value: name });
  return keys;
}
