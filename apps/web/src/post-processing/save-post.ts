import { and, db, gte, eq, posts, sql, vacancies } from '@job-market/db';

import type { Post, Vacancy } from './process-post.ts';

/** `excluded.<столбец>` — значение из отвергнутой вставки в `ON CONFLICT DO UPDATE`. */
function excludedColumns(keys: readonly string[]): Record<string, ReturnType<typeof sql.raw>> {
  return Object.fromEntries(
    keys.map((key) => {
      // Клиент базы называет столбцы в snake_case: `salaryMin` — `salary_min`.
      const column = key.replaceAll(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`);
      return [key, sql.raw(`excluded.${column}`)];
    }),
  );
}

/**
 * Сохраняет пост и его вакансии одной транзакцией. Повторный разбор того же поста
 * обновляет строку поста по `(source, externalId)` и вакансии по `(postId, position)`,
 * а роли, которых в новом разборе нет, удаляет. Возвращает id поста.
 */
export async function savePostWithVacancies(
  post: Post,
  postVacancies: readonly Vacancy[],
): Promise<Error | string> {
  // `async`-обёртка: `db` бросает синхронно, если не задан DATABASE_URL, — `.catch` ниже ловит и это.
  async function write(): Promise<string> {
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- транзакцию drizzle передаёт сам
    return db.transaction(async (tx) => {
      const { source: _source, externalId: _externalId, ...postFields } = post;
      const [row] = await tx
        .insert(posts)
        .values(post)
        .onConflictDoUpdate({
          target: [posts.source, posts.externalId],
          set: excludedColumns(Object.keys(postFields)),
        })
        .returning({ id: posts.id });
      if (row === undefined) throw new Error('Upsert returned no post row');

      await tx
        .delete(vacancies)
        .where(and(eq(vacancies.postId, row.id), gte(vacancies.position, postVacancies.length)));

      const [first] = postVacancies;
      if (first !== undefined) {
        const { position: _position, ...vacancyFields } = first;
        await tx
          .insert(vacancies)
          .values(
            postVacancies.map((vacancy) => ({
              ...vacancy,
              locations: [...vacancy.locations],
              employmentTypes: [...vacancy.employmentTypes],
              skills: [...vacancy.skills],
              postId: row.id,
            })),
          )
          .onConflictDoUpdate({
            target: [vacancies.postId, vacancies.position],
            set: { ...excludedColumns(Object.keys(vacancyFields)), updatedAt: sql`now()` },
          });
      }
      return row.id;
    });
  }

  return write().catch(
    (cause: unknown) => new Error(`Saving post ${post.externalId} failed`, { cause }),
  );
}
