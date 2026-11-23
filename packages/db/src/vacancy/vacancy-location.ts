import { sql } from 'drizzle-orm';
import {
  char,
  check,
  foreignKey,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  uuid,
} from 'drizzle-orm/pg-core';

import { geoCities, geoCountries, geoRegions } from '../geo/geo.ts';
import { vacancies } from './vacancy.ts';
import { LOCATION_ROLES, RESOLUTIONS } from './values.ts';

/**
 * Одно место одной вакансии: где офис или откуда можно работать, сведённое к
 * гео-справочнику. Место — регион, или страна, или город вместе с его страной;
 * нераспознанное место хранится только текстом. Повторный разбор перезаписывает места
 * вакансии целиком.
 */
export const vacancyLocations = pgTable(
  'vacancy_locations',
  {
    vacancyId: uuid()
      .notNull()
      .references(() => vacancies.id, { onDelete: 'cascade' }),
    /** Номер места в ответе экстрактора, с нуля. */
    position: smallint().notNull(),
    /** `office` — где офис, `hiring` — откуда можно работать: «офис в Берлине или удалённо из ЕС» — два места. */
    role: text({ enum: LOCATION_ROLES }).notNull(),
    /** Итог распознавания; по `not_found` и `ambiguous` видно, какие названия добавить в справочник. */
    resolution: text({ enum: RESOLUTIONS }).notNull(),
    /** Регион, если место — регион. Регион не удаляется, а архивируется. */
    regionCode: text().references(() => geoRegions.code, { onDelete: 'restrict' }),
    /**
     * Страна, если место — страна; у города — страна города: «вакансии в Германии» — одно
     * условие по столбцу, без JOIN с `geo_cities`.
     */
    countryCode: char({ length: 2 }).references(() => geoCountries.code, {
      onDelete: 'restrict',
    }),
    /** Город, если место — город. */
    cityId: integer(),
    /** Место словами текста: «Berlin (hybrid)», «Remote EU». */
    raw: text().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.vacancyId, table.position] }),
    // Город лежит в стране места. Город, который GeoNames перенёс в другую страну, уносит
    // страну места с собой; при `city_id` NULL ключ не проверяется (MATCH SIMPLE).
    foreignKey({
      name: 'vacancy_locations_city_id_country_code_fk',
      columns: [table.cityId, table.countryCode],
      foreignColumns: [geoCities.id, geoCities.countryCode],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),
    check('vacancy_locations_position_check', sql`"position" >= 0`),
    check('vacancy_locations_raw_check', sql`"raw" <> ''`),
    // Регион исключает страну и город.
    check(
      'vacancy_locations_region_check',
      sql`"region_code" IS NULL OR ("country_code" IS NULL AND "city_id" IS NULL)`,
    ),
    check(
      'vacancy_locations_city_country_check',
      sql`"city_id" IS NULL OR "country_code" IS NOT NULL`,
    ),
    // У нераспознанного места нет ссылок, у распознанного есть.
    check(
      'vacancy_locations_resolution_check',
      sql`("resolution" IN ('not_found', 'ambiguous')) = (num_nonnulls("region_code", "country_code", "city_id") = 0)`,
    ),
    // partial — это страна без города.
    check(
      'vacancy_locations_partial_check',
      sql`"resolution" <> 'partial' OR ("country_code" IS NOT NULL AND "city_id" IS NULL)`,
    ),
  ],
);

export type VacancyLocationRow = typeof vacancyLocations.$inferSelect;
export type NewVacancyLocationRow = typeof vacancyLocations.$inferInsert;
