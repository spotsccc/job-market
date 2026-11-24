import {
  EMPLOYMENT_TYPES,
  HIRING_PARTIES,
  SALARY_PERIODS,
  SENIORITIES,
  WORKPLACES,
} from '@job-market/db/values';
import type { EmploymentType, LanguageLevel, Seniority, Workplace } from '@job-market/db/values';

import { APPLY_METHODS, POSTED_WITHIN_DAYS, SALARY_TAXES } from './filters.ts';
import type { ApplyMethod, HiringParty, SalaryPeriod, SalaryTax } from './filters.ts';

/** Подписи значений полей вакансии: общие у карточки и фильтров. */

export const SENIORITY_LABELS: Readonly<Record<Seniority, string>> = {
  intern: 'стажёр',
  junior: 'junior',
  middle: 'middle',
  senior: 'senior',
  lead: 'lead',
  principal: 'principal',
};

export const WORKPLACE_LABELS: Readonly<Record<Workplace, string>> = {
  remote: 'удалённо',
  hybrid: 'гибрид',
  onsite: 'в офисе',
};

export const EMPLOYMENT_TYPE_LABELS: Readonly<Record<EmploymentType, string>> = {
  full_time: 'полная занятость',
  part_time: 'частичная занятость',
  contract: 'контракт',
  freelance: 'фриланс',
  internship: 'стажировка',
};

export const HIRING_PARTY_LABELS: Readonly<Record<HiringParty, string>> = {
  employer: 'работодатель',
  agency: 'агентство или рекрутёр',
  unknown: 'не ясно',
};

/** Период зарплаты после суммы: «€5 000 в месяц». */
export const SALARY_PERIOD_LABELS: Readonly<Record<SalaryPeriod, string>> = {
  year: 'в год',
  month: 'в месяц',
  day: 'в день',
  hour: 'в час',
};

export const SALARY_TAX_LABELS: Readonly<Record<SalaryTax, string>> = {
  gross: 'до налогов',
  net: 'на руки',
};

export const LANGUAGE_LEVEL_LABELS: Readonly<Record<LanguageLevel, string>> = {
  A1: 'A1',
  A2: 'A2',
  B1: 'B1',
  B2: 'B2',
  C1: 'C1',
  C2: 'C2',
  native: 'родной',
};

export const APPLY_METHOD_LABELS: Readonly<Record<ApplyMethod, string>> = {
  url: 'ссылка',
  email: 'почта',
  dm: 'написать автору',
};

/** Варианты выбора: значения по порядку и их подписи. */
export function optionsOf<T extends string>(
  values: readonly T[],
  labels: Readonly<Record<T, string>>,
): { value: T; label: string }[] {
  return values.map((value) => ({ value, label: labels[value] }));
}

const yearsPlural = new Intl.PluralRules('ru');

/** «от 1 года», «от 3 лет», «от 21 года»: после «от» — родительный падеж. */
export function formatYearsFrom(years: number): string {
  return `от ${String(years)} ${yearsPlural.select(years) === 'one' ? 'года' : 'лет'}`;
}

/** Варианты полей фильтра со списком значений из кода. */
export const SENIORITY_OPTIONS = optionsOf(SENIORITIES, SENIORITY_LABELS);
export const WORKPLACE_OPTIONS = optionsOf(WORKPLACES, WORKPLACE_LABELS);
export const EMPLOYMENT_OPTIONS = optionsOf(EMPLOYMENT_TYPES, EMPLOYMENT_TYPE_LABELS);
export const HIRING_OPTIONS = optionsOf(HIRING_PARTIES, HIRING_PARTY_LABELS);
export const APPLY_OPTIONS = optionsOf(APPLY_METHODS, APPLY_METHOD_LABELS);
export const PERIOD_OPTIONS = optionsOf(SALARY_PERIODS, SALARY_PERIOD_LABELS);
export const TAX_OPTIONS = optionsOf(SALARY_TAXES, SALARY_TAX_LABELS);
export const PLACE_MODE_OPTIONS = [
  { value: 'work', label: 'Можно работать отсюда' },
  { value: 'office', label: 'Офис здесь' },
];
export const POSTED_OPTIONS = POSTED_WITHIN_DAYS.map((days) => ({
  value: String(days),
  label: days === 1 ? 'за сутки' : `за ${String(days)} дн.`,
}));

export const LOCATION_ROLE_LABELS = { office: 'офис', hiring: 'откуда работать' } as const;

/** Итог сведения места к справочнику. */
export const RESOLUTION_LABELS = {
  resolved: 'найдено',
  partial: 'только страна',
  not_found: 'не найдено',
  ambiguous: 'неоднозначно',
} as const;

/** Да, нет или «не сказано» для полей, где `null` — в тексте об этом ничего. */
export function yesNo(value: boolean | null): string {
  if (value === null) return 'не сказано';
  return value ? 'да' : 'нет';
}
