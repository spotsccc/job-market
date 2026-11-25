CREATE TABLE "vacancy_duplicates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"publication_id" uuid NOT NULL,
	"original_id" uuid NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vacancy_duplicates" ADD CONSTRAINT "vacancy_duplicates_publication_id_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacancy_duplicates" ADD CONSTRAINT "vacancy_duplicates_original_id_publications_id_fk" FOREIGN KEY ("original_id") REFERENCES "public"."publications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vacancy_duplicates_publication_id_index" ON "vacancy_duplicates" USING btree ("publication_id");--> statement-breakpoint
CREATE INDEX "vacancy_duplicates_created_at_index" ON "vacancy_duplicates" USING btree ("created_at");