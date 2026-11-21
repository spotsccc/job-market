CREATE TABLE "telegram_channels" (
	"channel" text PRIMARY KEY NOT NULL,
	"cursor_id" integer,
	"pass_top_id" integer,
	"resume_before_id" integer,
	"last_crawled_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" text NOT NULL,
	"message_id" integer NOT NULL,
	"url" text NOT NULL,
	"content" text NOT NULL,
	"posted_at" timestamp with time zone NOT NULL,
	"author_name" text NOT NULL,
	"content_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"claimed_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"last_error" text,
	"not_vacancy_reason" text,
	"note" text,
	"post_id" uuid,
	"duplicate_of_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_messages_channel_message_id_unique" UNIQUE("channel","message_id")
);
--> statement-breakpoint
ALTER TABLE "telegram_messages" ADD CONSTRAINT "telegram_messages_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_messages" ADD CONSTRAINT "telegram_messages_duplicate_of_id_telegram_messages_id_fk" FOREIGN KEY ("duplicate_of_id") REFERENCES "public"."telegram_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "telegram_messages_status_index" ON "telegram_messages" USING btree ("status");--> statement-breakpoint
CREATE INDEX "telegram_messages_content_hash_index" ON "telegram_messages" USING btree ("content_hash");