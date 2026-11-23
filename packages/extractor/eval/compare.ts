/**
 * Сравнение ответа экстрактора с разметкой набора по полям (П20). Работает над плоскими
 * полями роли: что вернула текущая схема, решает адаптер в `run.ts`, поэтому поле, которого
 * нет в ответе, пропускается.
 */

/** Место разметки: роль и ключ места справочника (`city:2950159`, `country:DE`, `region:eu`). */
export type PlaceLabel = { readonly role: string; readonly key: string };
export type LanguageLabel = { readonly code: string; readonly level: string | null };

/** Поля роли, которые сравниваются точным равенством; `null` равен только `null`. */
export const EXACT_FIELDS = [
  'hiringParty',
  'seniority',
  'workplace',
  'salaryMin',
  'salaryMax',
  'salaryCurrency',
  'salaryPeriod',
  'salaryGross',
  'equity',
  'relocation',
  'visaSponsorship',
  'isRemoteFromAnywhere',
  'experienceYearsMin',
] as const;

/** Строки без учёта регистра и пробелов по краям. */
export const TEXT_FIELDS = ['title', 'company'] as const;

/** Множества без учёта регистра: точность и полнота. */
export const SET_FIELDS = [
  'employmentTypes',
  'skills',
  'niceSkills',
  'languages',
  'places',
] as const;

/** В разметке — заполнено ли поле, в ответе — непустая строка или список. */
export const NON_EMPTY_FIELDS = [
  'suggestedOccupation',
  'responsibilities',
  'requirements',
  'benefits',
] as const;

type ExactField = (typeof EXACT_FIELDS)[number];
type TextField = (typeof TEXT_FIELDS)[number];
type SetField = (typeof SET_FIELDS)[number];
type NonEmptyField = (typeof NON_EMPTY_FIELDS)[number];
type Scalar = string | number | boolean | null;

/** Все поля, которые сравнивает набор. */
export const COMPARED_FIELDS = [
  ...TEXT_FIELDS,
  'occupationId',
  ...EXACT_FIELDS,
  ...SET_FIELDS,
  ...NON_EMPTY_FIELDS,
] as const;
export type ComparedField = (typeof COMPARED_FIELDS)[number];

type SetValues = {
  readonly occupationId: string;
  readonly employmentTypes: readonly string[];
  readonly skills: readonly string[];
  readonly niceSkills: readonly string[];
  readonly languages: readonly LanguageLabel[];
  readonly places: readonly PlaceLabel[];
};

/** Роль из ответа экстрактора, сведённая к полям сравнения. */
export type ActualRole = Partial<
  Readonly<Record<ExactField, Scalar>> &
    Readonly<Record<TextField, string | null>> &
    Readonly<Record<NonEmptyField, string | readonly string[] | null>> &
    SetValues
>;

/** Роль разметки: те же поля, разделы описания и suggestedOccupation — признаком «заполнено». */
export type ExpectedRole = Partial<
  Readonly<Record<ExactField, Scalar>> &
    Readonly<Record<TextField, string | null>> &
    Readonly<Record<NonEmptyField, boolean>> &
    SetValues
>;

/** Узел дерева профессий: этого хватает, чтобы найти предков. */
export type TreeNode = { readonly id: string; readonly parent_id: string | null };

/** Куда ушла профессия ответа от разметки. */
export type OccupationDrift = 'ancestor' | 'descendant' | 'other_branch';

export type FieldResult =
  | {
      readonly kind: 'exact';
      readonly match: boolean;
      readonly expected: Scalar;
      readonly actual: Scalar;
    }
  | {
      readonly kind: 'set';
      readonly match: boolean;
      /** Сколько найденного есть в разметке. */
      readonly truePositives: number;
      readonly expected: readonly string[];
      readonly actual: readonly string[];
    }
  | {
      readonly kind: 'occupation';
      readonly match: boolean;
      readonly drift: OccupationDrift | null;
      readonly expected: string;
      readonly actual: string;
    };

export type RoleComparison = Partial<Readonly<Record<ComparedField, FieldResult>>>;

export type CaseComparison = {
  readonly roleCount: {
    readonly expected: number;
    readonly actual: number;
    readonly match: boolean;
  };
  /** Роли сравниваются по порядку: i-я роль ответа с i-й ролью разметки. */
  readonly roles: readonly RoleComparison[];
};

function setItems(field: SetField, role: ActualRole | ExpectedRole): readonly string[] | undefined {
  if (field === 'languages') {
    return role.languages?.map((language) =>
      `${language.code}:${language.level ?? 'null'}`.toLowerCase(),
    );
  }
  if (field === 'places') {
    return role.places?.map((place) => `${place.role} ${place.key}`.toLowerCase());
  }
  return role[field]?.map((item) => item.trim().toLowerCase());
}

function compareSets(
  expectedItems: readonly string[],
  actualItems: readonly string[],
): FieldResult {
  const expected = [...new Set(expectedItems)];
  const actual = [...new Set(actualItems)];
  const truePositives = actual.filter((item) => expected.includes(item)).length;
  return {
    kind: 'set',
    match: truePositives === expected.length && truePositives === actual.length,
    truePositives,
    expected,
    actual,
  };
}

function ancestorsOf(tree: readonly TreeNode[], id: string): readonly string[] {
  const parent = tree.find((node) => node.id === id)?.parent_id ?? null;
  return parent === null ? [] : [parent, ...ancestorsOf(tree, parent)];
}

function compareOccupation(
  tree: readonly TreeNode[],
  expected: string,
  actual: string,
): FieldResult {
  if (expected === actual) {
    return { kind: 'occupation', match: true, drift: null, expected, actual };
  }
  const drift: OccupationDrift = ancestorsOf(tree, expected).includes(actual)
    ? 'ancestor'
    : ancestorsOf(tree, actual).includes(expected)
      ? 'descendant'
      : 'other_branch';
  return { kind: 'occupation', match: false, drift, expected, actual };
}

function isNonEmpty(value: string | readonly string[] | null): boolean {
  if (value === null) return false;
  return typeof value === 'string' ? value.trim() !== '' : value.length > 0;
}

function normalizeText(value: string | null): string | null {
  return value === null ? null : value.trim().toLowerCase();
}

function exact(expected: Scalar, actual: Scalar, match = expected === actual): FieldResult {
  return { kind: 'exact', match, expected, actual };
}

function compareRole(
  tree: readonly TreeNode[],
  expected: ExpectedRole,
  actual: ActualRole,
): RoleComparison {
  const result: Partial<Record<ComparedField, FieldResult>> = {};
  for (const field of EXACT_FIELDS) {
    const [want, got] = [expected[field], actual[field]];
    if (want !== undefined && got !== undefined) result[field] = exact(want, got);
  }
  for (const field of TEXT_FIELDS) {
    const [want, got] = [expected[field], actual[field]];
    if (want !== undefined && got !== undefined) {
      result[field] = exact(want, got, normalizeText(want) === normalizeText(got));
    }
  }
  for (const field of SET_FIELDS) {
    const [want, got] = [setItems(field, expected), setItems(field, actual)];
    if (want !== undefined && got !== undefined) result[field] = compareSets(want, got);
  }
  for (const field of NON_EMPTY_FIELDS) {
    const [want, got] = [expected[field], actual[field]];
    if (want !== undefined && got !== undefined) result[field] = exact(want, isNonEmpty(got));
  }
  if (expected.occupationId !== undefined && actual.occupationId !== undefined) {
    result.occupationId = compareOccupation(tree, expected.occupationId, actual.occupationId);
  }
  return result;
}

/** Ответ на один случай набора против его разметки. */
export function compareCase(
  tree: readonly TreeNode[],
  expected: readonly ExpectedRole[],
  actual: readonly ActualRole[],
): CaseComparison {
  return {
    roleCount: {
      expected: expected.length,
      actual: actual.length,
      match: expected.length === actual.length,
    },
    roles: expected.flatMap((want, index) => {
      const got = actual[index];
      return got === undefined ? [] : [compareRole(tree, want, got)];
    }),
  };
}
