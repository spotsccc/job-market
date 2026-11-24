import { log } from '@job-market/logger';
import { and, eq, or, sql } from 'drizzle-orm';

import type { DbExecutor } from '../client.ts';
import { keysOf } from './company-keys.ts';
import type { CompanyKey } from './company-keys.ts';
import { companies, companyKeys } from './company.ts';

const companyLog = log.with({ module: 'company' });

/** Что известно о компании вакансии: как её написал экстрактор. */
export type CompanyInput = {
  readonly company: string | null;
  readonly companyUrl: string | null;
};

/** Компания вакансии и создана ли она этим вызовом. */
export type CompanyMatch = {
  readonly companyId: string;
  readonly created: boolean;
};

const keyText = (key: CompanyKey): string => `${key.kind}:${key.value}`;

/**
 * Берёт advisory-блокировки транзакции по ключам: две транзакции с одним новым ключом не
 * создадут две компании (E1). Порядок — сортировка, иначе транзакции с ключами {a, b} и
 * {b, a} возьмут их навстречу друг другу. Повторная блокировка в той же транзакции не ждёт
 * (E2); снимает блокировки конец транзакции.
 */
export async function lockKeys(tx: DbExecutor, keys: readonly CompanyKey[]): Promise<void> {
  const texts = [...new Set(keys.map((key) => keyText(key)))].toSorted();
  for (const text of texts) {
    // oxlint-disable-next-line no-await-in-loop -- блокировки берутся по одной в порядке сортировки
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${text}, 0))`);
  }
}

/** Имя новой компании (П3): `company` как в тексте, а без него — домен или slug LinkedIn. */
function newCompanyName(input: CompanyInput, keys: readonly CompanyKey[]): string {
  const company = input.company?.trim() ?? '';
  if (company !== '') return company;
  const [first] = keys;
  if (first === undefined) throw new Error('A company without keys is never created');
  return first.kind === 'linkedin' ? first.value.replace(/^company\//u, '') : first.value;
}

/** Какой компании принадлежит каждый из ключей, которые уже есть. */
async function findOwners(
  tx: DbExecutor,
  keys: readonly CompanyKey[],
): Promise<(key: CompanyKey) => string | undefined> {
  const found = await tx
    .select({ kind: companyKeys.kind, value: companyKeys.value, companyId: companyKeys.companyId })
    .from(companyKeys)
    .where(
      or(
        ...keys.map((key) => and(eq(companyKeys.kind, key.kind), eq(companyKeys.value, key.value))),
      ),
    );
  return (key) => found.find((row) => row.kind === key.kind && row.value === key.value)?.companyId;
}

async function createCompany(tx: DbExecutor, name: string): Promise<string> {
  const [company] = await tx.insert(companies).values({ name }).returning({ id: companies.id });
  if (company === undefined) throw new Error('Company insert returned no row');
  return company.id;
}

/**
 * Находит или создаёт компанию вакансии (П3, П4) и сообщает, создана ли она. `null` — у
 * вакансии нет ни одного ключа. Только внутри транзакции вызывающего.
 */
export async function resolveCompany(
  tx: DbExecutor,
  input: CompanyInput,
): Promise<CompanyMatch | null> {
  const keys = keysOf(input.company, input.companyUrl);
  if (keys.length === 0) return null;
  await lockKeys(tx, keys);

  const owner = await findOwners(tx, keys);
  const existing = keys.map((key) => owner(key)).find((id) => id !== undefined);
  const companyId = existing ?? (await createCompany(tx, newCompanyName(input, keys)));

  const missing = keys.filter((key) => owner(key) === undefined);
  if (missing.length > 0) {
    await tx
      .insert(companyKeys)
      .values(missing.map((key) => ({ kind: key.kind, value: key.value, companyId })));
  }
  for (const key of keys) {
    const other = owner(key);
    if (other !== undefined && other !== companyId) {
      companyLog.warn('company key conflict', {
        kind: key.kind,
        value: key.value,
        companyId,
        keyCompanyId: other,
      });
    }
  }
  return { companyId, created: existing === undefined };
}

/**
 * Компания вакансии (П3, П4): id компании первого найденного ключа или новой, если ни один
 * ключ не найден; `null` — ключей нет. Работает только внутри транзакции вызывающего:
 * advisory-блокировки снимаются её концом.
 */
export async function matchCompany(tx: DbExecutor, input: CompanyInput): Promise<string | null> {
  return (await resolveCompany(tx, input))?.companyId ?? null;
}
