import { COMPARED_FIELDS } from './compare.ts';
import type { CaseComparison, ComparedField, FieldResult, OccupationDrift } from './compare.ts';

/** Итог поля по всему набору. */
export type FieldSummary = {
  readonly compared: number;
  readonly matched: number;
  /** Для множеств — по всем ролям вместе: доля найденного, которое есть в разметке. */
  readonly precision?: number;
  /** Для множеств — доля разметки, которую нашли. */
  readonly recall?: number;
  /** Для профессии — куда уходили расхождения. */
  readonly drift?: Readonly<Record<OccupationDrift, number>>;
};

export type Summary = {
  readonly cases: number;
  readonly errors: number;
  readonly roleCount: { readonly compared: number; readonly matched: number };
  readonly fields: Partial<Readonly<Record<ComparedField, FieldSummary>>>;
};

function summarizeField(results: readonly FieldResult[]): FieldSummary {
  const base = {
    compared: results.length,
    matched: results.filter((result) => result.match).length,
  };
  const sets = results.flatMap((result) => (result.kind === 'set' ? [result] : []));
  if (sets.length > 0) {
    const sum = (count: (result: (typeof sets)[number]) => number): number =>
      sets.reduce((total, result) => total + count(result), 0);
    const truePositives = sum((result) => result.truePositives);
    const actual = sum((result) => result.actual.length);
    const expected = sum((result) => result.expected.length);
    return {
      ...base,
      precision: actual === 0 ? 1 : truePositives / actual,
      recall: expected === 0 ? 1 : truePositives / expected,
    };
  }
  const drifts = results.flatMap((result) =>
    result.kind === 'occupation' && result.drift !== null ? [result.drift] : [],
  );
  if (results.some((result) => result.kind === 'occupation')) {
    const count = (drift: OccupationDrift): number =>
      drifts.filter((item) => item === drift).length;
    return {
      ...base,
      drift: {
        ancestor: count('ancestor'),
        descendant: count('descendant'),
        other_branch: count('other_branch'),
      },
    };
  }
  return base;
}

/** Сводка по набору: `null` вместо сравнения — случай, на котором экстрактор вернул ошибку. */
export function summarize(comparisons: readonly (CaseComparison | null)[]): Summary {
  const compared = comparisons.filter((comparison) => comparison !== null);
  const byField = new Map<ComparedField, FieldResult[]>();
  for (const role of compared.flatMap((comparison) => comparison.roles)) {
    for (const field of COMPARED_FIELDS) {
      const result = role[field];
      if (result !== undefined) byField.set(field, [...(byField.get(field) ?? []), result]);
    }
  }
  return {
    cases: comparisons.length,
    errors: comparisons.length - compared.length,
    roleCount: {
      compared: compared.length,
      matched: compared.filter((comparison) => comparison.roleCount.match).length,
    },
    fields: Object.fromEntries(
      [...byField].map(([field, results]) => [field, summarizeField(results)]),
    ),
  };
}
