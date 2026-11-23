CREATE TABLE "authors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"headline" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "authors_platform_external_id_unique" UNIQUE("platform","external_id"),
	CONSTRAINT "authors_id_platform_unique" UNIQUE("id","platform")
);
--> statement-breakpoint
CREATE TABLE "platforms" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platforms_id_check" CHECK ("id" ~ '^[a-z0-9-]+$')
);
--> statement-breakpoint
CREATE TABLE "publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"external_id" text NOT NULL,
	"url" text NOT NULL,
	"content" text NOT NULL,
	"posted_at" timestamp with time zone NOT NULL,
	"payload" jsonb,
	"content_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"claimed_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"last_error" text,
	"not_vacancy_reason" text,
	"note" text,
	"duplicate_of_id" uuid,
	"author_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publications_platform_external_id_unique" UNIQUE("platform","external_id"),
	CONSTRAINT "publications_status_check" CHECK ("status" IN ('pending', 'processing', 'vacancy', 'not_vacancy', 'duplicate', 'empty', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connector" text NOT NULL,
	"key" text NOT NULL,
	"platform" text NOT NULL,
	"name" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"interval_minutes" integer DEFAULT 1440 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cursor" jsonb,
	"last_fetched_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sources_connector_key_unique" UNIQUE("connector","key"),
	CONSTRAINT "sources_id_platform_unique" UNIQUE("id","platform"),
	CONSTRAINT "sources_interval_minutes_check" CHECK ("interval_minutes" >= 15),
	CONSTRAINT "sources_consecutive_failures_check" CHECK ("consecutive_failures" >= 0)
);
--> statement-breakpoint
CREATE TABLE "occupations" (
	"id" text PRIMARY KEY NOT NULL,
	"parent_id" text,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "occupations_id_check" CHECK ("id" ~ '^[a-z][a-z0-9_]*$'),
	CONSTRAINT "occupations_root_check" CHECK (("parent_id" IS NULL) = ("id" = 'root'))
);
--> statement-breakpoint
CREATE TABLE "vacancies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"publication_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"schema_version" smallint NOT NULL,
	"title" text NOT NULL,
	"company" text,
	"company_url" text,
	"hiring_party" text NOT NULL,
	"occupation_id" text,
	"suggested_occupation" text,
	"seniority" text,
	"experience_years_min" smallint,
	"workplace" text,
	"is_remote_from_anywhere" boolean NOT NULL,
	"locations" text[] DEFAULT '{}'::text[] NOT NULL,
	"employment_types" text[] DEFAULT '{}'::text[] NOT NULL,
	"salary_min" numeric,
	"salary_max" numeric,
	"salary_currency" text,
	"salary_period" text,
	"salary_raw" text,
	"salary_gross" boolean,
	"equity" boolean,
	"skills" text[] DEFAULT '{}'::text[] NOT NULL,
	"nice_skills" text[] DEFAULT '{}'::text[] NOT NULL,
	"languages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"relocation" boolean,
	"visa_sponsorship" boolean,
	"apply" jsonb NOT NULL,
	"summary" text NOT NULL,
	"responsibilities" text[] DEFAULT '{}'::text[] NOT NULL,
	"requirements" text[] DEFAULT '{}'::text[] NOT NULL,
	"benefits" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('russian', "title"), 'A')
  || setweight(to_tsvector('russian', coalesce("company", '') || ' ' || immutable_array_to_string("skills", ' ') || ' ' || immutable_array_to_string("nice_skills", ' ')), 'B')
  || setweight(to_tsvector('russian', "summary" || ' ' || immutable_array_to_string("locations", ' ') || ' ' || coalesce("salary_raw", '') || ' ' || immutable_array_to_string("responsibilities", ' ') || ' ' || immutable_array_to_string("requirements", ' ')), 'C')) STORED NOT NULL,
	CONSTRAINT "vacancies_publication_id_position_unique" UNIQUE("publication_id","position"),
	CONSTRAINT "vacancies_schema_version_check" CHECK ("schema_version" IN (1, 2)),
	CONSTRAINT "vacancies_occupation_check" CHECK ("schema_version" = 1 OR "occupation_id" IS NOT NULL),
	CONSTRAINT "vacancies_experience_years_min_check" CHECK ("experience_years_min" BETWEEN 0 AND 30),
	CONSTRAINT "vacancies_languages_check" CHECK (jsonb_typeof("languages") = 'array')
);
--> statement-breakpoint
CREATE TABLE "vacancy_locations" (
	"vacancy_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"role" text NOT NULL,
	"resolution" text NOT NULL,
	"region_code" text,
	"country_code" char(2),
	"city_id" integer,
	"raw" text NOT NULL,
	CONSTRAINT "vacancy_locations_vacancy_id_position_pk" PRIMARY KEY("vacancy_id","position"),
	CONSTRAINT "vacancy_locations_position_check" CHECK ("position" >= 0),
	CONSTRAINT "vacancy_locations_raw_check" CHECK ("raw" <> ''),
	CONSTRAINT "vacancy_locations_region_check" CHECK ("region_code" IS NULL OR ("country_code" IS NULL AND "city_id" IS NULL)),
	CONSTRAINT "vacancy_locations_city_country_check" CHECK ("city_id" IS NULL OR "country_code" IS NOT NULL),
	CONSTRAINT "vacancy_locations_resolution_check" CHECK (("resolution" IN ('not_found', 'ambiguous')) = (num_nonnulls("region_code", "country_code", "city_id") = 0)),
	CONSTRAINT "vacancy_locations_partial_check" CHECK ("resolution" <> 'partial' OR ("country_code" IS NOT NULL AND "city_id" IS NULL))
);
--> statement-breakpoint
-- Цель составного ключа vacancy_locations → geo_cities: создаётся до него.
ALTER TABLE "geo_cities" ADD CONSTRAINT "geo_cities_id_country_code_unique" UNIQUE("id","country_code");--> statement-breakpoint
ALTER TABLE "authors" ADD CONSTRAINT "authors_platform_platforms_id_fk" FOREIGN KEY ("platform") REFERENCES "public"."platforms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_duplicate_of_id_publications_id_fk" FOREIGN KEY ("duplicate_of_id") REFERENCES "public"."publications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_source_id_platform_sources_id_platform_fk" FOREIGN KEY ("source_id","platform") REFERENCES "public"."sources"("id","platform") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_author_id_platform_authors_id_platform_fk" FOREIGN KEY ("author_id","platform") REFERENCES "public"."authors"("id","platform") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_platform_platforms_id_fk" FOREIGN KEY ("platform") REFERENCES "public"."platforms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occupations" ADD CONSTRAINT "occupations_parent_id_occupations_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."occupations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_publication_id_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_occupation_id_occupations_id_fk" FOREIGN KEY ("occupation_id") REFERENCES "public"."occupations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacancy_locations" ADD CONSTRAINT "vacancy_locations_vacancy_id_vacancies_id_fk" FOREIGN KEY ("vacancy_id") REFERENCES "public"."vacancies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacancy_locations" ADD CONSTRAINT "vacancy_locations_region_code_geo_regions_code_fk" FOREIGN KEY ("region_code") REFERENCES "public"."geo_regions"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacancy_locations" ADD CONSTRAINT "vacancy_locations_country_code_geo_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."geo_countries"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacancy_locations" ADD CONSTRAINT "vacancy_locations_city_id_country_code_fk" FOREIGN KEY ("city_id","country_code") REFERENCES "public"."geo_cities"("id","country_code") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "publications_content_hash_index" ON "publications" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "publications_status_claimed_at_index" ON "publications" USING btree ("status","claimed_at") WHERE "status" IN ('pending', 'processing');--> statement-breakpoint
CREATE INDEX "publications_source_id_index" ON "publications" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "publications_author_id_index" ON "publications" USING btree ("author_id") WHERE "author_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "sources_next_run_at_index" ON "sources" USING btree ("next_run_at") WHERE "enabled";--> statement-breakpoint
CREATE INDEX "occupations_parent_id_index" ON "occupations" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "vacancies_created_at_index" ON "vacancies" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "vacancies_search_vector_index" ON "vacancies" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "vacancies_occupation_id_index" ON "vacancies" USING btree ("occupation_id");--> statement-breakpoint
-- Начальные данные: площадки и корень дерева профессий. Остальные узлы дерева добавит план 1.
INSERT INTO "platforms" ("id", "name") VALUES ('telegram', 'Telegram'), ('linkedin', 'LinkedIn');--> statement-breakpoint
INSERT INTO "occupations" ("id", "parent_id", "name", "description") VALUES ('root', NULL, 'Без профессии', 'Корень дерева профессий. Выбирай его, только если текст не позволяет отнести роль ни к одной ветке дерева.');