-- Старые posts и vacancies становятся legacy_posts и legacy_vacancies: имя vacancies займёт
-- новая модель. Строки, id и связь вакансии с постом не меняются — только имена таблиц,
-- индексов и ограничений. Postgres не переименовывает их вместе с таблицей, а имя индекса
-- уникально во всей схеме, поэтому новые имена — те, что drizzle даёт legacy-таблицам.
-- Снимок схемы для этой миграции написан руками: drizzle-kit generate спрашивает о
-- переименовании таблиц интерактивно.
ALTER TABLE "posts" RENAME TO "legacy_posts";--> statement-breakpoint
ALTER TABLE "legacy_posts" RENAME CONSTRAINT "posts_pkey" TO "legacy_posts_pkey";--> statement-breakpoint
ALTER TABLE "legacy_posts" RENAME CONSTRAINT "posts_source_external_id_unique" TO "legacy_posts_source_external_id_unique";--> statement-breakpoint
ALTER TABLE "vacancies" RENAME TO "legacy_vacancies";--> statement-breakpoint
ALTER TABLE "legacy_vacancies" RENAME CONSTRAINT "vacancies_pkey" TO "legacy_vacancies_pkey";--> statement-breakpoint
ALTER TABLE "legacy_vacancies" RENAME CONSTRAINT "vacancies_post_id_position_unique" TO "legacy_vacancies_post_id_position_unique";--> statement-breakpoint
ALTER TABLE "legacy_vacancies" RENAME CONSTRAINT "vacancies_post_id_posts_id_fk" TO "legacy_vacancies_post_id_legacy_posts_id_fk";--> statement-breakpoint
ALTER INDEX "vacancies_created_at_index" RENAME TO "legacy_vacancies_created_at_index";--> statement-breakpoint
ALTER INDEX "vacancies_search_vector_index" RENAME TO "legacy_vacancies_search_vector_index";
