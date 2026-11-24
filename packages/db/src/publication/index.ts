/**
 * Домен публикаций: площадки, источники, авторы и публикации, которые находят источники.
 * Таблицы, типы строк и связи.
 */
export { authors } from './author.ts';
export type { AuthorRow, NewAuthorRow } from './author.ts';
export { platforms } from './platform.ts';
export type { NewPlatformRow, PlatformRow } from './platform.ts';
export {
  authorPublicationsRelations,
  publications,
  sourcePublicationsRelations,
} from './publication.ts';
export type { NewPublicationRow, PublicationRow } from './publication.ts';
export { publicationLinks } from './publication-link.ts';
export type { NewPublicationLinkRow, PublicationLinkRow } from './publication-link.ts';
export { sources } from './source.ts';
export type { NewSourceRow, SourceRow } from './source.ts';
export { contentHash } from './content-hash.ts';
export {
  addPublications,
  authorKey,
  findOriginals,
  insertPublication,
  markFailed,
  saveCursor,
  setOutcome,
  upsertAuthors,
} from './write-publication.ts';
export type {
  AuthorToSave,
  NewPublicationToSave,
  PublicationOutcome,
  PublicationToSave,
} from './write-publication.ts';
export { replacePublicationLinks } from './write-links.ts';
export type { LinkToSave } from './write-links.ts';
