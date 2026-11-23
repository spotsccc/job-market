/**
 * Старая модель: посты и вакансии, извлечённые из них, под именами `legacy_*`. Их читает
 * `/vacancies`, пока план 1 не перенесёт строки в новую модель и не удалит эти таблицы.
 */
export { legacyPosts } from './legacy-post.ts';
export type { LegacyPostRow, NewLegacyPostRow } from './legacy-post.ts';
export {
  legacyPostVacanciesRelations,
  legacyVacancies,
  legacyVacanciesRelations,
} from './legacy-vacancy.ts';
export type { LegacyVacancyRow, NewLegacyVacancyRow } from './legacy-vacancy.ts';
