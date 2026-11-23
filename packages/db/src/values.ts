/**
 * Допустимые значения `text`-столбцов всех доменов — вход `@job-market/db/values`. Не тянет
 * drizzle и `pg`: его берут схемы ответа модели и код, которому база не нужна.
 */
export * from './publication/values.ts';
export * from './vacancy/values.ts';
