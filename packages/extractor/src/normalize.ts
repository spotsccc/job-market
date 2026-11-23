import { LANGUAGE_LEVELS } from '@job-market/db/values';
import type { LanguageLevel } from '@job-market/db/values';

import type { ModelPlace, ModelVacancy } from './vacancy.ts';

/**
 * Приводит ответ модели к правилам плана vacancy-extraction: места (П10), навыки (П11), опыт
 * (П13), языки (П14) и пункты разделов (П15). Модель отвечает по схеме, но пустые строки,
 * повторы и маркеры списков она оставляет — их убирает код, а не промпт.
 */

/** Больше 30 лет опыта — ошибка разбора, а не требование (П13). */
const MAX_EXPERIENCE_YEARS = 30;

/** Маркер пункта списка в начале строки: «•», «-», «*», «1.», «2)». */
const LIST_MARKER = /^(?:[•·▪◦‣●○■□➤➢→✓✔✅🔹🔸👉*–—-]+|\d{1,2}[.)])\s*/u;

function blankToNull(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

/** Места по П10: пустые поля — null, место без полей убрано, повтор с той же ролью убран. */
function normalizePlaces(places: readonly ModelPlace[]): ModelPlace[] {
  const seen = new Set<string>();
  const result: ModelPlace[] = [];
  for (const place of places) {
    const city = blankToNull(place.city);
    const country = blankToNull(place.country);
    const region = blankToNull(place.region);
    const fields = [city, country, region].filter((field) => field !== null);
    if (fields.length === 0) continue;
    const key = [place.role, city, country, region].join('\u0000').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      role: place.role,
      city,
      country,
      region,
      raw: blankToNull(place.raw) ?? fields.join(', '),
    });
  }
  return result;
}

/** Без пустых и без повторов без учёта регистра; первое написание остаётся. */
function uniqueTexts(items: readonly string[], exclude: readonly string[] = []): string[] {
  const seen = new Set(exclude);
  const result: string[] = [];
  for (const item of items) {
    const text = item.trim();
    const key = text.toLowerCase();
    if (text === '' || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

/** Опыт по П13: целые годы от 0 до 30, остальное — null. */
function normalizeExperience(years: number | null): number | null {
  if (years === null || !Number.isFinite(years)) return null;
  const whole = Math.floor(years);
  return whole >= 0 && whole <= MAX_EXPERIENCE_YEARS ? whole : null;
}

function levelRank(level: LanguageLevel | null): number {
  return level === null ? -1 : LANGUAGE_LEVELS.indexOf(level);
}

/** Языки по П14: код строчными; повтор языка — остаётся более высокий уровень. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- тип выведен из zod-схемы, массивы в нём изменяемые
function normalizeLanguages(languages: ModelVacancy['languages']): ModelVacancy['languages'] {
  const byCode = new Map<string, LanguageLevel | null>();
  for (const language of languages) {
    const code = language.code.trim().toLowerCase();
    if (code === '') continue;
    const known = byCode.get(code);
    if (known === undefined || levelRank(language.level) > levelRank(known)) {
      byCode.set(code, language.level);
    }
  }
  const result: ModelVacancy['languages'] = [];
  for (const [code, level] of byCode) result.push({ code, level });
  return result;
}

/** Пункты раздела по П15: без маркеров списка и без пустых. */
function normalizeItems(items: readonly string[]): string[] {
  return items
    .map((item) => item.trim().replace(LIST_MARKER, '').trim())
    .filter((item) => item !== '');
}

/** Роль модели после нормализации; поля, которых правила не касаются, — как есть. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- тип выведен из zod-схемы, массивы в нём изменяемые
export function normalizeVacancy(vacancy: ModelVacancy): ModelVacancy {
  const skills = uniqueTexts(vacancy.skills);
  return {
    ...vacancy,
    suggestedOccupation: blankToNull(vacancy.suggestedOccupation),
    experienceYearsMin: normalizeExperience(vacancy.experienceYearsMin),
    places: normalizePlaces(vacancy.places),
    skills,
    niceSkills: uniqueTexts(
      vacancy.niceSkills,
      skills.map((skill) => skill.toLowerCase()),
    ),
    languages: normalizeLanguages(vacancy.languages),
    responsibilities: normalizeItems(vacancy.responsibilities),
    requirements: normalizeItems(vacancy.requirements),
    benefits: normalizeItems(vacancy.benefits),
  };
}
