/** Экстрактор: роли публикации-вакансии по схеме ответа модели. */
export { defaultExtractorModel, extract, EXTRACTOR_MODEL_ID } from './extract.ts';
export { extractedVacancySchema, vacancyExtractionSchema } from './vacancy.ts';
export type { ApplyChannels, ExtractedVacancy, Salary } from './vacancy.ts';
