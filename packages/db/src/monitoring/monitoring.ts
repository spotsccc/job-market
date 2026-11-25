import { sql } from 'drizzle-orm';
import { boolean, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Схема `monitoring` — то, что читает Grafana (docs/plans/monitoring.html). Своих данных у неё
 * нет: представления считаются из таблиц движка при каждом запросе. Роль `grafana` видит только
 * эту схему (П11 плана), поэтому в представлениях нет текстов публикаций.
 */
export const monitoring = pgSchema('monitoring');

/** Виды событий `monitoring.events` — по одному на панель дашборда «Движок». */
export const EVENT_KINDS = [
  'publication',
  'vacancy',
  'parse_error',
  'link_error',
  'duplicate',
  'vacancy_duplicate',
  'not_vacancy',
  'extraction_error',
] as const;

/**
 * Одно событие движка (П1–П8, П14 плана мониторинга): найдена публикация, извлечена вакансия,
 * упал опрос, не прочиталась ссылка, публикация оказалась дублем, не вакансией или не
 * разобралась, роль оказалась дублем вакансии. Площадка и имя — у источника на момент запроса
 * (П8). Новый вид события или статус публикации — новая ветка UNION ALL здесь и строка в
 * README.
 */
export const events = monitoring
  .view('events', {
    /** Когда случилось событие; откуда время — своё у каждого вида. */
    at: timestamp({ withTimezone: true }).notNull(),
    kind: text({ enum: EVENT_KINDS }).notNull(),
    sourceId: uuid().notNull(),
    /** Имя источника для людей. */
    source: text().notNull(),
    platform: text().notNull(),
    connector: text().notNull(),
    /**
     * Подробность для разбивки: текст ошибки у `parse_error` и `extraction_error`, хост у
     * `link_error`, причина у `not_vacancy`, название роли у `vacancy_duplicate`.
     */
    detail: text(),
  })
  .as(
    sql`SELECT e.at, e.kind, e.source_id, s.name AS source, s.platform, s.connector, e.detail
FROM (
  SELECT p.created_at AS at, 'publication' AS kind, p.source_id, NULL::text AS detail
  FROM public.publications p
  UNION ALL
  SELECT v.created_at, 'vacancy', p.source_id, NULL
  FROM public.vacancies v JOIN public.publications p ON p.id = v.publication_id
  UNION ALL
  SELECT r.finished_at, 'parse_error', r.source_id, r.error
  FROM public.source_runs r
  WHERE r.status = 'failed'
  UNION ALL
  SELECT p.created_at, 'link_error', p.source_id, l.host
  FROM public.publication_links l JOIN public.publications p ON p.id = l.publication_id
  WHERE l.status = 'failed'
  UNION ALL
  SELECT p.processed_at, 'duplicate', p.source_id, NULL
  FROM public.publications p
  WHERE p.status = 'duplicate'
  UNION ALL
  SELECT d.created_at, 'vacancy_duplicate', p.source_id, d.title
  FROM public.vacancy_duplicates d JOIN public.publications p ON p.id = d.publication_id
  UNION ALL
  SELECT p.processed_at, 'not_vacancy', p.source_id, p.not_vacancy_reason
  FROM public.publications p
  WHERE p.status = 'not_vacancy'
  UNION ALL
  SELECT p.processed_at, 'extraction_error', p.source_id, p.last_error
  FROM public.publications p
  WHERE p.status = 'failed'
) e
JOIN public.sources s ON s.id = e.source_id`,
  );

/** Источник, как его видит дашборд: для переменных «Площадка» и «Источник». */
export const sources = monitoring
  .view('sources', {
    id: uuid().notNull(),
    name: text().notNull(),
    platform: text().notNull(),
    connector: text().notNull(),
    /** Опрашивается ли источник сейчас. */
    enabled: boolean().notNull(),
  })
  .as(sql`SELECT id, name, platform, connector, enabled FROM public.sources`);
