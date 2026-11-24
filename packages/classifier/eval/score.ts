import type { Verdict } from '../src/index.ts';

/** Итог одного случая: ожидаемый вердикт и ответ classify — вердикт или ошибка. */
export type CaseOutcome = {
  readonly id: string;
  readonly expected: Verdict;
  readonly actual: Verdict | Readonly<Error>;
};

export type Score = {
  readonly cases: number;
  /** Случаи, где classify вернул ошибку: в совпадения не идут. */
  readonly errors: number;
  readonly matched: number;
  /** По ожидаемому вердикту; случай с ошибкой считается в `total`, но не в `matched`. */
  readonly byVerdict: Readonly<Partial<Record<Verdict, { matched: number; total: number }>>>;
  /** Несовпадения «ждали → получили» с id случаев. Ошибки сюда не входят. */
  readonly confusion: readonly {
    readonly expected: Verdict;
    readonly actual: Verdict;
    readonly ids: readonly string[];
  }[];
};

/** Доля совпавших вердиктов — одна метрика набора. */
export function score(outcomes: readonly CaseOutcome[]): Score {
  const byVerdict: Partial<Record<Verdict, { matched: number; total: number }>> = {};
  const confusion = new Map<string, { expected: Verdict; actual: Verdict; ids: string[] }>();
  let errors = 0;
  let matched = 0;
  for (const { id, expected, actual } of outcomes) {
    const bucket = byVerdict[expected] ?? { matched: 0, total: 0 };
    byVerdict[expected] = bucket;
    bucket.total += 1;
    if (typeof actual !== 'string') {
      errors += 1;
    } else if (actual === expected) {
      matched += 1;
      bucket.matched += 1;
    } else {
      const key = `${expected}→${actual}`;
      const pair = confusion.get(key) ?? { expected, actual, ids: [] };
      pair.ids.push(id);
      confusion.set(key, pair);
    }
  }
  return { cases: outcomes.length, errors, matched, byVerdict, confusion: [...confusion.values()] };
}
