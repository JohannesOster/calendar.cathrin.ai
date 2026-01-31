CREATE TABLE "calendar_sync_state" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"calendar_id" text NOT NULL,
	"sync_token" text,
	"last_sync_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"calendar_id" text NOT NULL,
	"google_event_id" text NOT NULL,
	"title" text NOT NULL,
	"start" timestamp NOT NULL,
	"end" timestamp NOT NULL,
	"is_all_day" boolean DEFAULT false,
	"color" text,
	"status" text,
	"raw" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "sync_status" text DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "sync_error" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "last_sync_at" timestamp;--> statement-breakpoint
ALTER TABLE "calendar_sync_state" ADD CONSTRAINT "calendar_sync_state_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sync_state_account_calendar_idx" ON "calendar_sync_state" USING btree ("account_id","calendar_id");--> statement-breakpoint
CREATE INDEX "events_account_calendar_idx" ON "events" USING btree ("account_id","calendar_id");--> statement-breakpoint
CREATE INDEX "events_start_end_idx" ON "events" USING btree ("start","end");--> statement-breakpoint
CREATE UNIQUE INDEX "events_account_google_id_idx" ON "events" USING btree ("account_id","google_event_id");