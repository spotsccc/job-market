import { createTaggedError } from '@spotsccc/error-as-value';

/**
 * Базовая ошибка проекта. Все ошибки проекта наследуются от неё через
 * `createTaggedError({ name, message, extends: AppError })`, поэтому
 * `instanceof AppError` отличает их от чужих ошибок. `extendable` делает наследников
 * присваиваемыми к `AppError`; её собственный `_tag` при этом типизирован как `string`.
 */
export class AppError extends createTaggedError({ name: 'AppError', extendable: true }) {}
