import {
  EMPLOYMENT_TYPES,
  HIRING_PARTIES,
  SALARY_PERIODS,
  SENIORITIES,
  WORKPLACES,
} from '@job-market/db/values';
import type { EmploymentType, Seniority, Workplace } from '@job-market/db/values';
import { parsePlaceKey } from '@job-market/geo';
import type { PlaceRef } from '@job-market/geo';

export type HiringParty = (typeof HIRING_PARTIES)[number];
export type SalaryPeriod = (typeof SALARY_PERIODS)[number];

/** Способ отклика: ссылка, почта или написать автору. */
export const APPLY_METHODS = ['url', 'email', 'dm'] as const;
export type ApplyMethod = (typeof APPLY_METHODS)[number];

/**
 * Как место фильтра сравнивается с местами вакансии:
 * - `work` — можно работать отсюда: место вакансии внутри выбранного, регион найма его
 *   покрывает или вакансия «откуда угодно»;
 * - `office` — офис вакансии внутри выбранного места.
 */
export const PLACE_MODES = ['work', 'office'] as const;
export type PlaceMode = (typeof PLACE_MODES)[number];

/** За сколько последних дней опубликована вакансия. */
export const POSTED_WITHIN_DAYS = [1, 3, 7, 14, 30, 90] as const;

/** Уровень оплаты: до налогов или на руки. */
export const SALARY_TAXES = ['gross', 'net'] as const;
export type SalaryTax = (typeof SALARY_TAXES)[number];

/**
 * Фильтры страницы вакансий. Пустой список и `null` — фильтра нет; булев флаг `true` —
 * «только где да»: «нет» и «не сказано» в данных не различаются для поиска.
 */
export type VacancyFilters = {
  /** Полнотекстовый запрос; пустая строка — без поиска. */
  readonly q: string;
  /** Узлы дерева профессий: вакансия в узле или его поддереве. `root` — только «Без профессии». */
  readonly occupations: readonly string[];
  readonly seniorities: readonly Seniority[];
  /** Мой опыт, лет: вакансии, где требуют не больше, и те, где опыт не назван. */
  readonly experienceYears: number | null;
  readonly workplaces: readonly Workplace[];
  readonly remoteFromAnywhere: boolean;
  readonly place: PlaceRef | null;
  readonly placeMode: PlaceMode;
  readonly employmentTypes: readonly EmploymentType[];
  readonly hiringParties: readonly HiringParty[];
  /**
   * Компания справочника — id из адреса как есть: не uuid или неизвестный id показываются
   * как «Компания не найдена», а не отбрасываются молча (П9, packages/db/src/company/README.md).
   */
  readonly companyId: string | null;
  /** Навыки: все выбранные есть среди обязательных или «плюсом», без учёта регистра. */
  readonly skills: readonly string[];
  /** Языки ISO 639-1: вакансия упоминает хотя бы один. */
  readonly languages: readonly string[];
  readonly withSalary: boolean;
  /** Нижняя граница зарплаты; сравнивается только в выбранной валюте. */
  readonly salaryFrom: number | null;
  readonly salaryCurrency: string | null;
  readonly salaryPeriod: SalaryPeriod | null;
  readonly salaryTax: SalaryTax | null;
  readonly equity: boolean;
  readonly relocation: boolean;
  readonly visaSponsorship: boolean;
  readonly applyMethods: readonly ApplyMethod[];
  readonly platforms: readonly string[];
  readonly postedWithinDays: number | null;
  /** Номер страницы с 1. */
  readonly page: number;
};

export const EMPTY_FILTERS: VacancyFilters = {
  q: '',
  occupations: [],
  seniorities: [],
  experienceYears: null,
  workplaces: [],
  remoteFromAnywhere: false,
  place: null,
  placeMode: 'work',
  employmentTypes: [],
  hiringParties: [],
  companyId: null,
  skills: [],
  languages: [],
  withSalary: false,
  salaryFrom: null,
  salaryCurrency: null,
  salaryPeriod: null,
  salaryTax: null,
  equity: false,
  relocation: false,
  visaSponsorship: false,
  applyMethods: [],
  platforms: [],
  postedWithinDays: null,
  page: 1,
};

export type SearchParams = Readonly<Record<string, string | readonly string[] | undefined>>;

/** Значения параметра: повтор `?a=1&a=2` и список через запятую `?a=1,2`, без пустых. */
function list(params: SearchParams, name: string): string[] {
  const raw = params[name];
  const values = raw === undefined ? [] : typeof raw === 'string' ? [raw] : raw;
  return [
    ...new Set(values.flatMap((value) => value.split(',')).map((value) => value.trim())),
  ].filter((value) => value !== '');
}

function single(params: SearchParams, name: string): string {
  return list(params, name)[0] ?? '';
}

function oneOf<T extends string>(allowed: readonly T[], value: string): value is T {
  return (allowed as readonly string[]).includes(value);
}

function listOf<T extends string>(params: SearchParams, name: string, allowed: readonly T[]): T[] {
  return list(params, name).filter((value): value is T => oneOf(allowed, value));
}

/** Целое из диапазона; иначе `null`. */
function integer(params: SearchParams, name: string, min: number, max: number): number | null {
  const value = Number(single(params, name));
  if (single(params, name) === '' || !Number.isInteger(value)) return null;
  return value >= min && value <= max ? value : null;
}

function flag(params: SearchParams, name: string): boolean {
  return single(params, name) === '1';
}

const OCCUPATION_ID = /^[a-z][a-z0-9_]*$/u;
const LANGUAGE_CODE = /^[a-z]{2}$/u;
const CURRENCY_CODE = /^[A-Z]{3}$/u;
const PLATFORM_ID = /^[a-z0-9-]+$/u;

/**
 * Фильтры из адреса страницы. Неизвестные значения отбрасываются молча: испорченная или
 * устаревшая ссылка показывает вакансии без этого фильтра, а не ошибку.
 */
export function parseFilters(params: SearchParams): VacancyFilters {
  const placeKey = single(params, 'place');
  const place = placeKey === '' ? null : parsePlaceKey(placeKey);
  const placeMode = single(params, 'placeMode');
  const salaryTax = single(params, 'salaryTax');
  const salaryPeriod = single(params, 'salaryPeriod');
  const currency = single(params, 'salaryCurrency').toUpperCase();
  const posted = integer(params, 'posted', 1, 365);
  return {
    q: single(params, 'q'),
    occupations: list(params, 'occupation').filter((id) => OCCUPATION_ID.test(id)),
    seniorities: listOf(params, 'seniority', SENIORITIES),
    experienceYears: integer(params, 'experience', 0, 30),
    workplaces: listOf(params, 'workplace', WORKPLACES),
    remoteFromAnywhere: flag(params, 'anywhere'),
    place: place instanceof Error || place?.kind === 'anywhere' ? null : place,
    placeMode: oneOf(PLACE_MODES, placeMode) ? placeMode : 'work',
    employmentTypes: listOf(params, 'employment', EMPLOYMENT_TYPES),
    hiringParties: listOf(params, 'hiring', HIRING_PARTIES),
    companyId: single(params, 'company') === '' ? null : single(params, 'company'),
    skills: list(params, 'skill'),
    languages: list(params, 'language')
      .map((code) => code.toLowerCase())
      .filter((code) => LANGUAGE_CODE.test(code)),
    withSalary: flag(params, 'withSalary'),
    salaryFrom: integer(params, 'salaryFrom', 1, 1_000_000_000),
    salaryCurrency: CURRENCY_CODE.test(currency) ? currency : null,
    salaryPeriod: oneOf(SALARY_PERIODS, salaryPeriod) ? salaryPeriod : null,
    salaryTax: oneOf(SALARY_TAXES, salaryTax) ? salaryTax : null,
    equity: flag(params, 'equity'),
    relocation: flag(params, 'relocation'),
    visaSponsorship: flag(params, 'visa'),
    applyMethods: listOf(params, 'apply', APPLY_METHODS),
    platforms: list(params, 'platform').filter((id) => PLATFORM_ID.test(id)),
    postedWithinDays: posted,
    page: integer(params, 'page', 1, 10_000) ?? 1,
  };
}

/** Сколько фильтров задано, кроме запроса и страницы: для заголовка панели. */
export function countActiveFilters(filters: VacancyFilters): number {
  const { q: _q, page: _page, placeMode: _placeMode, ...rest } = filters;
  let active = 0;
  for (const value of Object.values(rest)) {
    const empty = Array.isArray(value)
      ? value.length === 0
      : value === null || value === false || value === '';
    if (!empty) active += 1;
  }
  return active;
}
