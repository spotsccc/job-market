import { CountryRemovedError } from '../errors/index.ts';
import type { GeonamesParseError } from '../errors/index.ts';
import { normalizeName } from '../normalize.ts';
import { cell, parseCoordinate, parseInteger, splitRow } from './parse.ts';
import type {
  AliasRecord,
  CityRecord,
  CountryRecord,
  GeonamesData,
  GeonamesSources,
} from './types.ts';

/** Коды, выведенные из ISO 3166-1 (П1). */
const REMOVED_COUNTRY_CODES = new Set(['CS', 'AN']);
/** Части города и исторические места (П2). */
const EXCLUDED_FEATURE_CODES = new Set(['PPLX', 'PPLH', 'PPLQ', 'PPLW', 'PPLCH']);
/** Языки названий кроме первого языка страны (П3). */
const ALIAS_LANGUAGES = ['ru', 'en', 'abbr'];

const COUNTRY_INFO_COLUMNS = 19;
const CITY_COLUMNS = 19;
const ALTERNATE_NAME_COLUMNS = 10;

type CountryRow = {
  readonly country: CountryRecord;
  /** Название страны в countryInfo: Germany. */
  readonly name: string;
  /** Первый язык страны без региона: `de` из `de-DE`; `null` — языков нет. */
  readonly language: string | null;
};

type CityRow = { readonly city: CityRecord; readonly asciiName: string };

type CityRows = { readonly kept: readonly CityRow[]; readonly dropped: number };

/** Альтернативное название и его признаки из alternateNamesV2. */
type AlternateName = {
  readonly name: string;
  readonly lang: string;
  readonly preferred: boolean;
  readonly short: boolean;
  readonly colloquial: boolean;
};

/** Языки, на которых берутся названия места, по его geonameid. */
type PlaceLanguages = Readonly<Record<number, readonly string[]>>;

type AlternateNames = Readonly<Record<number, readonly AlternateName[]>>;

/**
 * Собирает страны, города и их названия по П1–П3. Ничего не пишет: результат уходит в
 * `buildGeonamesSql`. `previousCodes` — коды из прошлого `src/generated/countries.ts`:
 * если какого-то нет в новом countryInfo, возвращается `CountryRemovedError` (П7).
 */
export async function readGeonames(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- итераторы строк по природе изменяемы
  sources: GeonamesSources,
  previousCodes: readonly string[],
): Promise<GeonamesParseError | CountryRemovedError | GeonamesData> {
  const countries = await readCountryInfo(sources.countryInfo);
  if (countries instanceof Error) return countries;

  const codes = countries.map((row) => row.country.code);
  const removed = previousCodes.filter((code) => !codes.includes(code));
  if (removed.length > 0) return new CountryRemovedError({ codes: removed.join(', ') });

  const cities = await readCities(sources.cities, codes);
  if (cities instanceof Error) return cities;

  const alternates = await readAlternateNames(
    sources.alternateNames,
    placeLanguages(countries, cities.kept),
  );
  if (alternates instanceof Error) return alternates;

  return assemble(countries, cities, alternates);
}

function assemble(
  countries: readonly CountryRow[],
  cities: CityRows,
  alternates: AlternateNames,
): GeonamesData {
  const aliases: AliasRecord[] = [];
  for (const { country, name } of countries) {
    const own = [name, country.code, country.iso3];
    const place = { countryCode: country.code, cityId: null };
    aliases.push(...placeAliases(own, alternates[country.geonameId] ?? [], place));
  }
  const cityRecords: CityRecord[] = [];
  for (const { city, asciiName } of cities.kept) {
    const names = alternates[city.id] ?? [];
    const nameEn = pickName(names, 'en');
    cityRecords.push({
      ...city,
      nameEn: nameEn === city.name ? null : nameEn,
      nameRu: pickName(names, 'ru'),
    });
    const place = { countryCode: null, cityId: city.id };
    aliases.push(...placeAliases([city.name, asciiName], names, place));
  }
  return {
    countries: countries.map((row) => row.country),
    cities: cityRecords,
    aliases,
    droppedCities: cities.dropped,
  };
}

const displayNames = {
  ru: new Intl.DisplayNames(['ru'], { type: 'region', fallback: 'none' }),
  en: new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' }),
};

/** Название страны из Intl (П1). Его отсутствие — сломанная сборка ICU, а не данные. */
function displayName(locale: keyof typeof displayNames, code: string): string {
  const name = displayNames[locale].of(code);
  if (name === undefined || name === code) {
    throw new Error(`Intl.DisplayNames has no ${locale} name for country ${code}`);
  }
  return name;
}

async function readCountryInfo(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- итератор строк по природе изменяем
  lines: AsyncIterable<string>,
): Promise<GeonamesParseError | CountryRow[]> {
  const file = 'countryInfo.txt';
  const rows: CountryRow[] = [];
  let line = 0;
  for await (const text of lines) {
    line += 1;
    if (text === '' || text.startsWith('#')) continue;
    const position = { file, line };
    const cells = splitRow(text, COUNTRY_INFO_COLUMNS, position);
    if (cells instanceof Error) return cells;
    const code = cell(cells, 0);
    if (REMOVED_COUNTRY_CODES.has(code)) continue;

    const geonameId = parseInteger(cell(cells, 16), 'geonameid', position);
    if (geonameId instanceof Error) return geonameId;
    const population = parseInteger(cell(cells, 7), 'population', position);
    if (population instanceof Error) return population;

    const language = cell(cells, 15).split(',')[0]?.split('-')[0] ?? '';
    rows.push({
      country: {
        code,
        iso3: cell(cells, 1),
        geonameId,
        continent: cell(cells, 8),
        nameEn: displayName('en', code),
        nameRu: displayName('ru', code),
        population,
      },
      name: cell(cells, 4),
      language: language === '' ? null : language,
    });
  }
  return rows;
}

async function readCities(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- итератор строк по природе изменяем
  lines: AsyncIterable<string>,
  countryCodes: readonly string[],
): Promise<GeonamesParseError | CityRows> {
  const file = 'cities15000.txt';
  const kept: CityRow[] = [];
  let dropped = 0;
  let line = 0;
  for await (const text of lines) {
    line += 1;
    if (text === '') continue;
    const cells = splitRow(text, CITY_COLUMNS, { file, line });
    if (cells instanceof Error) return cells;
    const city = parseCity(cells, { file, line });
    if (city instanceof Error) return city;
    if (EXCLUDED_FEATURE_CODES.has(cell(cells, 7)) || !countryCodes.includes(city.countryCode)) {
      dropped += 1;
      continue;
    }
    kept.push({ city, asciiName: cell(cells, 2) });
  }
  return { kept, dropped };
}

function parseCity(
  cells: readonly string[],
  position: { readonly file: string; readonly line: number },
): GeonamesParseError | CityRecord {
  const id = parseInteger(cell(cells, 0), 'geonameid', position);
  if (id instanceof Error) return id;
  const lat = parseCoordinate(cell(cells, 4), 'latitude', position);
  if (lat instanceof Error) return lat;
  const lng = parseCoordinate(cell(cells, 5), 'longitude', position);
  if (lng instanceof Error) return lng;
  const population = parseInteger(cell(cells, 14), 'population', position);
  if (population instanceof Error) return population;
  const admin1Code = cell(cells, 10);
  return {
    id,
    countryCode: cell(cells, 8),
    admin1Code: admin1Code === '' ? null : admin1Code,
    name: cell(cells, 1),
    nameEn: null,
    nameRu: null,
    lat,
    lng,
    population,
    timezone: cell(cells, 17),
  };
}

/** Для каждой страны и города — языки его названий: ru, en, abbr и первый язык страны (П3). */
function placeLanguages(
  countries: readonly CountryRow[],
  cities: readonly CityRow[],
): PlaceLanguages {
  const byCountry: Record<string, readonly string[]> = {};
  const languages: Record<number, readonly string[]> = {};
  for (const { country, language } of countries) {
    const list = language === null ? ALIAS_LANGUAGES : [...ALIAS_LANGUAGES, language];
    byCountry[country.code] = list;
    languages[country.geonameId] = list;
  }
  for (const { city } of cities) {
    languages[city.id] = byCountry[city.countryCode] ?? ALIAS_LANGUAGES;
  }
  return languages;
}

/** Читает только названия наших мест на их языках, без исторических (П3). */
async function readAlternateNames(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- итератор строк по природе изменяем
  lines: AsyncIterable<string>,
  languages: PlaceLanguages,
): Promise<GeonamesParseError | AlternateNames> {
  const file = 'alternateNamesV2.txt';
  const names: Record<number, AlternateName[]> = {};
  let line = 0;
  for await (const text of lines) {
    line += 1;
    if (text === '') continue;
    const position = { file, line };
    const cells = splitRow(text, ALTERNATE_NAME_COLUMNS, position);
    if (cells instanceof Error) return cells;
    const placeId = parseInteger(cell(cells, 1), 'geonameid', position);
    if (placeId instanceof Error) return placeId;
    const lang = cell(cells, 2);
    const historic = cell(cells, 7) === '1';
    if (historic || languages[placeId]?.includes(lang) !== true) continue;

    const list = (names[placeId] ??= []);
    list.push({
      name: cell(cells, 3),
      lang,
      preferred: cell(cells, 4) === '1',
      short: cell(cells, 5) === '1',
      colloquial: cell(cells, 6) === '1',
    });
  }
  return names;
}

/**
 * Название для показа на языке (П3): с isPreferredName, иначе первое обычное, иначе
 * первое короткое. Разговорные («Питер») для показа не берутся: у Петербурга нет
 * предпочтительного английского, и первым на en шло бы «Peterburg».
 */
function pickName(names: readonly AlternateName[], lang: string): string | null {
  const candidates = names.filter((name) => name.lang === lang && !name.colloquial);
  const best =
    candidates.find((name) => name.preferred) ??
    candidates.find((name) => !name.short) ??
    candidates[0];
  return best?.name ?? null;
}

/** Названия одного места без повторов после нормализации; пустые отбрасываются. */
function placeAliases(
  own: readonly string[],
  alternates: readonly AlternateName[],
  place: Pick<AliasRecord, 'countryCode' | 'cityId'>,
): AliasRecord[] {
  const seen = new Set<string>();
  const result: AliasRecord[] = [];
  const candidates = [
    ...own.map((alias) => ({ alias, lang: null })),
    ...alternates.map((alternate) => ({ alias: alternate.name, lang: alternate.lang })),
  ];
  for (const { alias, lang } of candidates) {
    const normalized = normalizeName(alias);
    if (normalized === '' || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push({ normalized, alias, lang, ...place });
  }
  return result;
}
