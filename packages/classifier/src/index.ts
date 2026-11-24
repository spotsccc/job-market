/** Классификатор: вакансия ли публикация, и если нет — почему. */
export { VERDICTS } from './classification.ts';
export type { Classification, Verdict } from './classification.ts';
export { CLASSIFIER_MODEL_ID, classify, defaultClassifierModel } from './classify.ts';
export type { ClassifyOptions } from './classify.ts';
export { ClassificationError, NothingToClassifyError } from './errors/index.ts';
