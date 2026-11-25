CREATE TABLE "source_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"status" text NOT NULL,
	"inserted" integer NOT NULL,
	"error" text,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_runs_status_check" CHECK ("status" IN ('done', 'more', 'failed')),
	CONSTRAINT "source_runs_inserted_check" CHECK ("inserted" >= 0),
	CONSTRAINT "source_runs_error_check" CHECK (("status" = 'failed') = ("error" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "source_runs" ADD CONSTRAINT "source_runs_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "source_runs_finished_at_index" ON "source_runs" USING btree ("finished_at");--> statement-breakpoint
CREATE INDEX "source_runs_source_id_index" ON "source_runs" USING btree ("source_id");