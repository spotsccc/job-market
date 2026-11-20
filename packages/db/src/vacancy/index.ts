/** Домен вакансий: посты из источников и вакансии, извлечённые из них. Таблицы, типы строк и связи. */
export { posts } from './post.ts';
export type { NewPostRow, PostRow } from './post.ts';
export { postVacanciesRelations, vacancies, vacanciesRelations } from './vacancy.ts';
export type { NewVacancyRow, VacancyApply, VacancyRow } from './vacancy.ts';
