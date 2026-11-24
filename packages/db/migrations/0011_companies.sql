CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_name_check" CHECK ("name" <> '')
);
--> statement-breakpoint
CREATE TABLE "company_keys" (
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_keys_kind_value_pk" PRIMARY KEY("kind","value"),
	CONSTRAINT "company_keys_kind_check" CHECK ("kind" IN ('domain', 'linkedin', 'name'))
);
--> statement-breakpoint
ALTER TABLE "vacancies" ADD COLUMN "company_id" uuid;--> statement-breakpoint
ALTER TABLE "company_keys" ADD CONSTRAINT "company_keys_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_keys_company_id_index" ON "company_keys" USING btree ("company_id");--> statement-breakpoint
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vacancies_company_id_index" ON "vacancies" USING btree ("company_id");