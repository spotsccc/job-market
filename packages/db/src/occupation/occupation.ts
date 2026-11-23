import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import type { Database } from '../client.ts';

/**
 * Профессия — узел дерева профессий: домен («IT»), направление («Разработка») или
 * конкретная профессия («Frontend»). Дерево — список смежности: у узла ссылка на
 * родителя. Корень один — `root`, «Без профессии». Узлов десятки, поэтому приложение
 * читает дерево целиком и собирает его в памяти. Узел с детьми или вакансиями не
 * удаляется, а архивируется.
 */
export const occupations = pgTable(
  'occupations',
  {
    /**
     * Slug узла: `frontend`, `data_engineer`. Его видит модель в перечислении схемы ответа,
     * на него ссылаются вакансии и разметка набора, поэтому он не меняется.
     */
    id: text().primaryKey(),
    /** Родитель; `null` — только у `root`. */
    parentId: text().references((): AnyPgColumn => occupations.id, { onDelete: 'restrict' }),
    /** Название для карточки: «Frontend-разработка». Можно менять. */
    name: text().notNull(),
    /**
     * Определение узла для модели, с пограничным примером: «Интерфейсы в браузере.
     * Fullstack с React и Node — не сюда, а в fullstack». Это часть промпта.
     */
    description: text().notNull(),
    /** Когда узел архивирован; `null` — действует. */
    archivedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Slug годится как значение перечисления и как часть пути.
    check('occupations_id_check', sql`"id" ~ '^[a-z][a-z0-9_]*$'`),
    // Корень один, и это root; у остальных узлов есть родитель.
    check('occupations_root_check', sql`("parent_id" IS NULL) = ("id" = 'root')`),
    index('occupations_parent_id_index').on(table.parentId),
  ],
);

export type OccupationRow = typeof occupations.$inferSelect;
export type NewOccupationRow = typeof occupations.$inferInsert;

/** Узел дерева профессий, как его видят экстрактор и перенос. */
export type Occupation = Pick<
  OccupationRow,
  'id' | 'parentId' | 'name' | 'description' | 'archivedAt'
>;

/** Всё дерево профессий одним запросом, вместе с архивными узлами: узлов десятки. */
export async function listOccupations(db: Pick<Database, 'select'>): Promise<Occupation[]> {
  return db
    .select({
      id: occupations.id,
      parentId: occupations.parentId,
      name: occupations.name,
      description: occupations.description,
      archivedAt: occupations.archivedAt,
    })
    .from(occupations);
}
