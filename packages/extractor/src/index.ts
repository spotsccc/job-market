/** Экстрактор: роли публикации-вакансии по схеме ответа модели и дереву профессий. */
export { defaultExtractorModel, extract, EXTRACTOR_MODEL_ID } from './extract.ts';
export type { ExtractedRole, ExtractOptions } from './extract.ts';
export { normalizeVacancy } from './normalize.ts';
export { ancestors, isLeaf, occupationEnum, occupationsPrompt } from './occupations.ts';
export type { OccupationNode } from './occupations.ts';
export { vacancySchema } from './vacancy.ts';
export type { ApplyChannels, ModelPlace, ModelVacancy, Salary } from './vacancy.ts';
