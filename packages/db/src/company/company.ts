import { sql } from 'drizzle-orm';
import { check, index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Виды ключей компании в порядке поиска (П3): домен сайта, страница LinkedIn, название. */
export const COMPANY_KEY_KINDS = ['domain', 'linkedin', 'name'] as const;
export type CompanyKeyKind = (typeof COMPANY_KEY_KINDS)[number];

/**
 * Компания, в которую нанимают: работодатель вакансий. Одна компания — одна строка, как бы её
 * ни писали в вакансиях; написания сводят к ней ключи `company_keys`. Компании создаёт
 * сопоставление (П3), удаляет только слияние (П7).
 */
export const companies = pgTable(
  'companies',
  {
    id: uuid().primaryKey().defaultRandom(),
    /** Название для людей: из первой вакансии компании как в тексте. */
    name: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  () => [check('companies_name_check', sql`"name" <> ''`)],
);

/**
 * Признак, по которому вакансию относят к компании (П1, П2). Вид — часть ключа: `acme` как
 * название и как домен — разные ключи. Ключ ведёт ровно к одной компании; у компании их
 * несколько, поэтому ключи — отдельная таблица.
 */
export const companyKeys = pgTable(
  'company_keys',
  {
    kind: text({ enum: COMPANY_KEY_KINDS }).notNull(),
    value: text().notNull(),
    companyId: uuid()
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.kind, table.value] }),
    check(
      'company_keys_kind_check',
      sql`"kind" IN (${sql.raw(COMPANY_KEY_KINDS.map((kind) => `'${kind}'`).join(', '))})`,
    ),
    // Ключи компании при слиянии.
    index('company_keys_company_id_index').on(table.companyId),
  ],
);

export type CompanyRow = typeof companies.$inferSelect;
export type NewCompanyRow = typeof companies.$inferInsert;
export type CompanyKeyRow = typeof companyKeys.$inferSelect;
