/**
 * Домен вакансий: роли, извлечённые из публикаций, и их места, сведённые к гео-справочнику.
 * Таблицы, типы строк и связи — и связи публикаций и профессий, которые ведут к вакансиям.
 */
export {
  companiesRelations,
  companyKeysRelations,
  occupationsRelations,
  publicationsRelations,
  vacanciesRelations,
  vacancyLocationsRelations,
} from './relations.ts';
export { DUPLICATE_WINDOW_DAYS, isSameRole, titleKey } from './duplicates.ts';
export type { DuplicateFields } from './duplicates.ts';
export { saveVacancies } from './save-vacancies.ts';
export type { PlaceToSave, SaveOptions, SaveSummary, VacancyToSave } from './save-vacancies.ts';
export { vacancyDuplicates } from './vacancy-duplicate.ts';
export type { NewVacancyDuplicateRow, VacancyDuplicateRow } from './vacancy-duplicate.ts';
export { vacancyLocations } from './vacancy-location.ts';
export type { NewVacancyLocationRow, VacancyLocationRow } from './vacancy-location.ts';
export { vacancies } from './vacancy.ts';
export type { NewVacancyRow, VacancyApply, VacancyLanguage, VacancyRow } from './vacancy.ts';
