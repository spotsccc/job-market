/** Разбор постов моделями: вакансия ли пост и какие в нём роли, и запись вакансий в базу. */
export { processPost } from './process-post.ts';
export type { Post, ProcessedPost, Vacancy } from './process-post.ts';
export { defaultPostProcessingModels } from './models.ts';
export type { PostProcessingModels } from './models.ts';
export { savePostWithVacancies } from './save-post.ts';
