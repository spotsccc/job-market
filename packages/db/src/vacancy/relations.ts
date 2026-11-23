import { relations } from 'drizzle-orm';

import { geoCities, geoCountries, geoRegions } from '../geo/geo.ts';
import { occupations } from '../occupation/occupation.ts';
import { authors } from '../publication/author.ts';
import { publications } from '../publication/publication.ts';
import { sources } from '../publication/source.ts';
import { vacancyLocations } from './vacancy-location.ts';
import { vacancies } from './vacancy.ts';

/**
 * `db.query.vacancies.findMany({ with: { publication: true, occupation: true, places: true } })`.
 * Места — `places`, а не `locations`: так уже называется столбец вакансии с местами словами.
 * Связи лежат отдельно от таблиц: вакансия и её места ссылаются друг на друга.
 */
export const vacanciesRelations = relations(vacancies, ({ one, many }) => ({
  publication: one(publications, {
    fields: [vacancies.publicationId],
    references: [publications.id],
  }),
  occupation: one(occupations, {
    fields: [vacancies.occupationId],
    references: [occupations.id],
  }),
  places: many(vacancyLocations),
}));

/** `db.query.vacancyLocations.findMany({ with: { region: true, country: true, city: true } })`. */
export const vacancyLocationsRelations = relations(vacancyLocations, ({ one }) => ({
  vacancy: one(vacancies, { fields: [vacancyLocations.vacancyId], references: [vacancies.id] }),
  region: one(geoRegions, { fields: [vacancyLocations.regionCode], references: [geoRegions.code] }),
  country: one(geoCountries, {
    fields: [vacancyLocations.countryCode],
    references: [geoCountries.code],
  }),
  city: one(geoCities, { fields: [vacancyLocations.cityId], references: [geoCities.id] }),
}));

/**
 * Связи публикации: `db.query.publications.findMany({ with: { source: true, author: true,
 * vacancies: true } })`. Лежат здесь, а не в `publication.ts`: drizzle выводит типы только из
 * одного `relations()` на таблицу, а публикация не знает о вакансиях. `duplicates` —
 * публикации, вместо которых разобрана эта.
 */
export const publicationsRelations = relations(publications, ({ one, many }) => ({
  source: one(sources, { fields: [publications.sourceId], references: [sources.id] }),
  author: one(authors, { fields: [publications.authorId], references: [authors.id] }),
  duplicateOf: one(publications, {
    fields: [publications.duplicateOfId],
    references: [publications.id],
    relationName: 'duplicate',
  }),
  duplicates: many(publications, { relationName: 'duplicate' }),
  vacancies: many(vacancies),
}));

/**
 * Связи узла дерева профессий: `db.query.occupations.findMany({ with: { parent: true,
 * children: true, vacancies: true } })`. Здесь по той же причине, что связи публикации.
 */
export const occupationsRelations = relations(occupations, ({ one, many }) => ({
  parent: one(occupations, {
    fields: [occupations.parentId],
    references: [occupations.id],
    relationName: 'parent',
  }),
  children: many(occupations, { relationName: 'parent' }),
  vacancies: many(vacancies),
}));
