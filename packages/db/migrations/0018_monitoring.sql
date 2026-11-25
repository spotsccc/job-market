CREATE SCHEMA "monitoring";
--> statement-breakpoint
CREATE VIEW "monitoring"."events" AS (SELECT e.at, e.kind, e.source_id, s.name AS source, s.platform, s.connector, e.detail
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
JOIN public.sources s ON s.id = e.source_id);--> statement-breakpoint
CREATE VIEW "monitoring"."sources" AS (SELECT id, name, platform, connector, enabled FROM public.sources);