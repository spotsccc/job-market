import { eq, inArray } from 'drizzle-orm';

import type { Database } from '../client.ts';
import { vacancies } from '../vacancy/vacancy.ts';
import { companies, companyKeys } from './company.ts';
import { CompanyNotFoundError, SameCompanyError } from './errors.ts';
import { lockKeys } from './match-company.ts';

/** Сколько ключей и вакансий перешло к оставшейся компании и какая компания удалена. */
export type MergeSummary = {
  readonly keys: number;
  readonly vacancies: number;
  /** Название удалённой компании. */
  readonly removed: string;
};

/**
 * Сливает компанию `fromId` в `intoId` одной транзакцией (П7): все ключи и вакансии переходят к
 * `intoId`, `fromId` удаляется, название `intoId` не меняется. Блокировки ключей `fromId` те же,
 * что у сопоставления: запись вакансии с её ключом ждёт конца слияния (E7). Сбой базы —
 * исключение.
 */
export async function mergeCompanies(
  db: Database,
  fromId: string,
  intoId: string,
): Promise<MergeSummary | SameCompanyError | CompanyNotFoundError> {
  if (fromId === intoId) return new SameCompanyError({ id: fromId });
  return db.transaction(async (tx) => {
    const found = await tx
      .select({ id: companies.id, name: companies.name })
      .from(companies)
      .where(inArray(companies.id, [fromId, intoId]))
      .for('update');
    const from = found.find((row) => row.id === fromId);
    if (from === undefined) return new CompanyNotFoundError({ id: fromId });
    if (!found.some((row) => row.id === intoId)) return new CompanyNotFoundError({ id: intoId });

    const keys = await tx
      .select({ kind: companyKeys.kind, value: companyKeys.value })
      .from(companyKeys)
      .where(eq(companyKeys.companyId, fromId));
    await lockKeys(tx, keys);

    const movedKeys = await tx
      .update(companyKeys)
      .set({ companyId: intoId })
      .where(eq(companyKeys.companyId, fromId))
      .returning({ kind: companyKeys.kind });
    const movedVacancies = await tx
      .update(vacancies)
      .set({ companyId: intoId })
      .where(eq(vacancies.companyId, fromId))
      .returning({ id: vacancies.id });
    await tx.delete(companies).where(eq(companies.id, fromId));
    return { keys: movedKeys.length, vacancies: movedVacancies.length, removed: from.name };
  });
}
