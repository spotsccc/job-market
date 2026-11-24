import type { ModelVerdict } from '../src/classification.ts';
import type { CaseGroup } from './cases.ts';

/** Итог одного случая: вид случая, ожидаемый вердикт и ответ classify — вердикт или ошибка. */
export type CaseOutcome = {
  readonly id: string;
  readonly group: CaseGroup;
  readonly expected: ModelVerdict;
  readonly actual: ModelVerdict | Readonly<Error>;
};

export type Score = {
  readonly cases: number;
  /** Случаи, где classify вернул ошибку: в совпадения не идут. */
  readonly errors: number;
  readonly matched: number;
  /** По виду случая; случай с ошибкой считается в `total`, но не в `matched`. */
  readonly byGroup: Readonly<Partial<Record<CaseGroup, { matched: number; total: number }>>>;
  /** Несовпадения «вид случая → что ответили» с id случаев. Ошибки сюда не входят. */
  readonly confusion: readonly {
    readonly group: CaseGroup;
    readonly actual: ModelVerdict;
    readonly ids: readonly string[];
  }[];
};

/** Доля совпавших вердиктов — одна метрика набора. */
export function score(outcomes: readonly CaseOutcome[]): Score {
  const byGroup: Partial<Record<CaseGroup, { matched: number; total: number }>> = {};
  const confusion = new Map<string, { group: CaseGroup; actual: ModelVerdict; ids: string[] }>();
  let errors = 0;
  let matched = 0;
  for (const { id, group, expected, actual } of outcomes) {
    const bucket = byGroup[group] ?? { matched: 0, total: 0 };
    byGroup[group] = bucket;
    bucket.total += 1;
    if (typeof actual !== 'string') {
      errors += 1;
    } else if (actual === expected) {
      matched += 1;
      bucket.matched += 1;
    } else {
      const key = `${group}→${actual}`;
      const pair = confusion.get(key) ?? { group, actual, ids: [] };
      pair.ids.push(id);
      confusion.set(key, pair);
    }
  }
  return { cases: outcomes.length, errors, matched, byGroup, confusion: [...confusion.values()] };
}
