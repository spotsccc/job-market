/**
 * Вся схема базы: таблицы и связи всех доменов. Отсюда её берут клиент (`db`) и
 * drizzle-kit для генерации миграций. Домен — папка в `src/` с таблицами, типами
 * строк и связями рядом; новый домен — строка экспорта ниже.
 */
export * from './publication/index.ts';
export * from './occupation/index.ts';
export * from './vacancy/index.ts';
export * from './legacy/index.ts';
export * from './geo/index.ts';
