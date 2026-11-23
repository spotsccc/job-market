-- drizzle-kit не создаёт расширения. pg_trgm нужен gin-индексу geo_aliases_normalized_trgm_index.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TABLE "geo_aliases" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "geo_aliases_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"normalized" text NOT NULL,
	"alias" text NOT NULL,
	"lang" text,
	"source" text NOT NULL,
	"country_code" char(2),
	"region_code" text,
	"city_id" integer,
	CONSTRAINT "geo_aliases_source_normalized_place_unique" UNIQUE NULLS NOT DISTINCT("source","normalized","country_code","region_code","city_id"),
	CONSTRAINT "geo_aliases_one_place_check" CHECK (num_nonnulls("country_code", "region_code", "city_id") = 1),
	CONSTRAINT "geo_aliases_source_check" CHECK ("source" IN ('geonames', 'manual')),
	CONSTRAINT "geo_aliases_region_manual_check" CHECK ("source" = 'manual' OR "region_code" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "geo_cities" (
	"id" integer PRIMARY KEY NOT NULL,
	"country_code" char(2) NOT NULL,
	"admin1_code" text,
	"name" text NOT NULL,
	"name_en" text,
	"name_ru" text,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"population" integer NOT NULL,
	"timezone" text NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "geo_cities_population_check" CHECK ("population" >= 0)
);
--> statement-breakpoint
CREATE TABLE "geo_countries" (
	"code" char(2) PRIMARY KEY NOT NULL,
	"iso3" char(3) NOT NULL,
	"geoname_id" integer NOT NULL,
	"continent" char(2) NOT NULL,
	"name_en" text NOT NULL,
	"name_ru" text NOT NULL,
	"population" bigint NOT NULL,
	CONSTRAINT "geo_countries_iso3_unique" UNIQUE("iso3"),
	CONSTRAINT "geo_countries_geoname_id_unique" UNIQUE("geoname_id"),
	CONSTRAINT "geo_countries_code_check" CHECK ("code" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
CREATE TABLE "geo_region_countries" (
	"region_code" text NOT NULL,
	"country_code" char(2) NOT NULL,
	CONSTRAINT "geo_region_countries_region_code_country_code_pk" PRIMARY KEY("region_code","country_code")
);
--> statement-breakpoint
CREATE TABLE "geo_regions" (
	"code" text PRIMARY KEY NOT NULL,
	"name_en" text NOT NULL,
	"name_ru" text NOT NULL,
	"description" text NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "geo_regions_code_check" CHECK ("code" ~ '^[a-z][a-z_]*$')
);
--> statement-breakpoint
ALTER TABLE "geo_aliases" ADD CONSTRAINT "geo_aliases_country_code_geo_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."geo_countries"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geo_aliases" ADD CONSTRAINT "geo_aliases_region_code_geo_regions_code_fk" FOREIGN KEY ("region_code") REFERENCES "public"."geo_regions"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geo_aliases" ADD CONSTRAINT "geo_aliases_city_id_geo_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."geo_cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geo_cities" ADD CONSTRAINT "geo_cities_country_code_geo_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."geo_countries"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geo_region_countries" ADD CONSTRAINT "geo_region_countries_region_code_geo_regions_code_fk" FOREIGN KEY ("region_code") REFERENCES "public"."geo_regions"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geo_region_countries" ADD CONSTRAINT "geo_region_countries_country_code_geo_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."geo_countries"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "geo_aliases_normalized_index" ON "geo_aliases" USING btree ("normalized");--> statement-breakpoint
CREATE INDEX "geo_aliases_normalized_trgm_index" ON "geo_aliases" USING gin ("normalized" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "geo_cities_country_code_population_index" ON "geo_cities" USING btree ("country_code","population" DESC NULLS LAST) WHERE "archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "geo_region_countries_country_code_index" ON "geo_region_countries" USING btree ("country_code");