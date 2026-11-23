/**
 * Проверка разбора и поиска руками на локальной базе (адрес — из `apps/web/.env.local`):
 *
 * `pnpm --filter @job-market/geo lookup resolve city:Питер "city:Alexandria country:US"` —
 * каждый аргумент — один вход из полей `city:`, `country:`, `region:`; печатает место,
 * его предков и название (S6).
 *
 * `pnpm --filter @job-market/geo lookup search бер [--en]` — автодополнение (S7).
 */
import { getDb } from '@job-market/db';

import { ancestors, formatPlace, placeKey } from '../src/index.ts';
import type { Locale } from '../src/index.ts';
import { resolvePlaces, searchPlaces } from '../src/server.ts';
import type { PlaceField, PlaceInput, ResolvedPlace } from '../src/server.ts';

const KIND_NAMES = {
  country: { ru: 'страна', en: 'country' },
  region: { ru: 'регион', en: 'region' },
  anywhere: { ru: 'откуда угодно', en: 'anywhere' },
};

const [command, ...rest] = process.argv.slice(2);
const locale: Locale = rest.includes('--en') ? 'en' : 'ru';
const args = rest.filter((arg) => arg !== '--en');

const output =
  command === 'resolve' && args.length > 0
    ? await resolve(args)
    : command === 'search' && args.length > 0
      ? await search(args.join(' '))
      : undefined;
await getDb().$client.end();

if (output === undefined) {
  console.error('Usage: lookup resolve <city:… country:… region:…>… | lookup search <text> [--en]');
  process.exit(1);
}
if (output instanceof Error) {
  console.error(output);
  process.exit(1);
}
console.log(output.join('\n'));

async function resolve(rawInputs: readonly string[]): Promise<Error | string[]> {
  const inputs = rawInputs.map((raw) => parseInput(raw));
  const results = await resolvePlaces(getDb(), inputs);
  if (results instanceof Error) return results;
  return results.map((result, index) => {
    const input = inputs[index] ?? {};
    const text = (['city', 'country', 'region'] as const)
      .map((field) => input[field])
      .filter((value) => value !== undefined && value !== null)
      .join(', ');
    return `${text} → ${describe(result)}`;
  });
}

function describe(result: ResolvedPlace): string {
  if (result.status === 'unresolved') return `unresolved: ${result.reason}`;
  const place = `${placeKey(result.place)} · ${formatPlace(result.place, locale, result.city ?? undefined)}`;
  if (result.status === 'partial') {
    const { field, text, reason } = result.unresolved;
    return `partial: ${place}; ${field} «${text}» — ${reason}`;
  }
  const parents = ancestors(result.place).map((parent) => placeKey(parent));
  return parents.length === 0 ? place : `${place} · предки: ${parents.join(', ')}`;
}

/** «city:Санкт Петербург country:RU» → поля входа; значение может содержать пробелы. */
function parseInput(raw: string): PlaceInput {
  const input: Partial<Record<PlaceField, string>> = {};
  for (const part of raw.split(/\s+(?=(?:city|country|region):)/u)) {
    const match = /^(city|country|region):(.*)$/su.exec(part.trim());
    if (match?.[1] === 'city' || match?.[1] === 'country' || match?.[1] === 'region') {
      input[match[1]] = match[2] ?? '';
    } else {
      input.city = part.trim();
    }
  }
  return input;
}

async function search(query: string): Promise<Error | string[]> {
  const suggestions = await searchPlaces(getDb(), query, { locale, limit: 10 });
  if (suggestions instanceof Error) return suggestions;
  return suggestions.map(({ place, label, population }) => {
    if (place.kind === 'city') return `${label} · ${formatPopulation(population ?? 0)}`;
    return `${label} · ${KIND_NAMES[place.kind][locale]}`;
  });
}

function formatPopulation(population: number): string {
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  if (population >= 1_000_000) {
    return `${number.format(population / 1_000_000)} ${locale === 'ru' ? 'млн' : 'M'}`;
  }
  return `${number.format(Math.round(population / 1000))} ${locale === 'ru' ? 'тыс.' : 'K'}`;
}
