ALTER TABLE "publications" DROP CONSTRAINT "publications_status_check";--> statement-breakpoint
-- Причин «не вакансия» теперь две: `empty` и `trash`. Публикации переноса без текста писались
-- как `not_hiring` с пояснением «пост без текста» — это `empty`, пояснение им не нужно.
UPDATE "publications" SET "not_vacancy_reason" = 'empty', "note" = NULL
  WHERE "status" = 'not_vacancy' AND "not_vacancy_reason" = 'not_hiring' AND lower("note") = 'пост без текста';--> statement-breakpoint
UPDATE "publications" SET "not_vacancy_reason" = 'trash'
  WHERE "not_vacancy_reason" IN ('job_seeker', 'no_specific_role', 'not_hiring');--> statement-breakpoint
-- Статуса `empty` больше нет: пустая публикация — `not_vacancy` с причиной `empty`.
UPDATE "publications" SET "status" = 'not_vacancy', "not_vacancy_reason" = 'empty', "note" = NULL,
    "processed_at" = coalesce("processed_at", "created_at")
  WHERE "status" = 'empty';--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_status_check" CHECK ("status" IN ('pending', 'processing', 'vacancy', 'not_vacancy', 'duplicate', 'failed'));
