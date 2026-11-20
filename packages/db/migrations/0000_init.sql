CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"url" text NOT NULL,
	"content" text NOT NULL,
	"posted_at" timestamp with time zone NOT NULL,
	"author_name" text NOT NULL,
	"author_url" text NOT NULL,
	"author_headline" text,
	"author_handle" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "posts_source_external_id_unique" UNIQUE("source","external_id")
);
--> statement-breakpoint
CREATE TABLE "vacancies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"company" text,
	"company_url" text,
	"hiring_party" text NOT NULL,
	"seniority" text,
	"workplace" text,
	"is_remote_from_anywhere" boolean NOT NULL,
	"locations" text[] DEFAULT '{}'::text[] NOT NULL,
	"employment_types" text[] DEFAULT '{}'::text[] NOT NULL,
	"salary_min" numeric,
	"salary_max" numeric,
	"salary_currency" text,
	"salary_period" text,
	"salary_raw" text,
	"skills" text[] DEFAULT '{}'::text[] NOT NULL,
	"relocation" boolean,
	"visa_sponsorship" boolean,
	"apply" jsonb NOT NULL,
	"summary" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vacancies_post_id_position_unique" UNIQUE("post_id","position")
);
--> statement-breakpoint
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vacancies_created_at_index" ON "vacancies" USING btree ("created_at");