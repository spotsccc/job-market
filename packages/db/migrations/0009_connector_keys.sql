ALTER TABLE "authors" DROP CONSTRAINT "authors_platform_external_id_unique";--> statement-breakpoint
ALTER TABLE "authors" DROP CONSTRAINT "authors_platform_platforms_id_fk";
--> statement-breakpoint
ALTER TABLE "publications" DROP CONSTRAINT "publications_source_id_platform_sources_id_platform_fk";
--> statement-breakpoint
ALTER TABLE "publications" DROP CONSTRAINT "publications_author_id_platform_authors_id_platform_fk";
--> statement-breakpoint
ALTER TABLE "authors" DROP CONSTRAINT "authors_id_platform_unique";--> statement-breakpoint
ALTER TABLE "publications" DROP CONSTRAINT "publications_platform_external_id_unique";--> statement-breakpoint
ALTER TABLE "sources" DROP CONSTRAINT "sources_id_platform_unique";--> statement-breakpoint
ALTER TABLE "authors" DROP COLUMN "platform";--> statement-breakpoint
ALTER TABLE "publications" DROP COLUMN "platform";--> statement-breakpoint
ALTER TABLE "authors" ADD COLUMN "connector" text NOT NULL;--> statement-breakpoint
ALTER TABLE "publications" ADD COLUMN "connector" text NOT NULL;--> statement-breakpoint
ALTER TABLE "authors" ADD CONSTRAINT "authors_connector_external_id_unique" UNIQUE("connector","external_id");--> statement-breakpoint
ALTER TABLE "authors" ADD CONSTRAINT "authors_id_connector_unique" UNIQUE("id","connector");--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_connector_external_id_unique" UNIQUE("connector","external_id");--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_id_connector_unique" UNIQUE("id","connector");--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_source_id_connector_sources_id_connector_fk" FOREIGN KEY ("source_id","connector") REFERENCES "public"."sources"("id","connector") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_author_id_connector_authors_id_connector_fk" FOREIGN KEY ("author_id","connector") REFERENCES "public"."authors"("id","connector") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- Платформа — бренд источника, а не сервис: каналы GeekJobs живут в Telegram, но их платформа —
-- geekjobs. Источников на платформе telegram нет: 0008 создала таблицу пустой.
INSERT INTO "platforms" ("id", "name") VALUES ('geekjobs', 'GeekJobs');--> statement-breakpoint
DELETE FROM "platforms" WHERE "id" = 'telegram';
