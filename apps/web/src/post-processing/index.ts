/** Разбор постов моделями: вакансия ли пост и какие в нём роли. */
export { processLinkedinPost } from './process-post.ts';
export type { Post, ProcessedPost, Vacancy } from './process-post.ts';
export { defaultPostProcessingModels } from './models.ts';
export type { PostProcessingModels } from './models.ts';
