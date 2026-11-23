import { readFileSync } from 'node:fs';

/** Ответ актора, сохранённый в spike Э0: `packages/enricher/fixtures/<name>.json`. */
export function loadFixture(name: string): unknown[] {
  const parsed: unknown = JSON.parse(
    readFileSync(new URL(`../../fixtures/${name}.json`, import.meta.url), 'utf8'),
  );
  if (!Array.isArray(parsed)) throw new TypeError(`Fixture ${name} is not an array`);
  return parsed;
}

/** Копия элемента фикстуры, которую тест может менять. */
export function fixtureItem(name: string, index = 0): Record<string, unknown> {
  const item: unknown = structuredClone(loadFixture(name)[index]);
  if (typeof item !== 'object' || item === null) throw new TypeError(`No item ${String(index)}`);
  return { ...item };
}
