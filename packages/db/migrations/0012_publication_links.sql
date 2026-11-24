CREATE TABLE "publication_links" (
	"publication_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"url" text NOT NULL,
	"target_url" text,
	"host" text NOT NULL,
	"status" text NOT NULL,
	"reader" text,
	"error" text,
	CONSTRAINT "publication_links_publication_id_position_pk" PRIMARY KEY("publication_id","position"),
	CONSTRAINT "publication_links_position_check" CHECK ("position" >= 0),
	CONSTRAINT "publication_links_status_check" CHECK ("status" IN ('read', 'no_data', 'failed', 'unsupported', 'over_limit')),
	CONSTRAINT "publication_links_error_check" CHECK (("status" = 'failed') = ("error" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "publication_links" ADD CONSTRAINT "publication_links_publication_id_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "publication_links_host_status_index" ON "publication_links" USING btree ("host","status");