/**
 * Домен вакансий: роли, извлечённые из публикаций, и их места, сведённые к гео-справочнику.
 * Таблицы, типы строк и связи — и связи публикаций и профессий, которые ведут к вакансиям.
 */
export {
  occupationsRelations,
  publicationsRelations,
  vacanciesRelations,
  vacancyLocationsRelations,
} from './relations.ts';
export { saveVacancies } from './save-vacancies.ts';
export type { PlaceToSave, VacancyToSave } from './save-vacancies.ts';
export { vacancyLocations } from './vacancy-location.ts';
export type { NewVacancyLocationRow, VacancyLocationRow } from './vacancy-location.ts';
export { vacancies } from './vacancy.ts';
export type { NewVacancyRow, VacancyApply, VacancyLanguage, VacancyRow } from './vacancy.ts';
