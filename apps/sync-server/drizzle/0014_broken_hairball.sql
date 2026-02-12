CREATE TABLE "watch_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"calendar_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"expiration" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "watch_channels_channel_id_unique" UNIQUE("channel_id"),
	CONSTRAINT "watch_channels_account_calendar" UNIQUE("account_id","calendar_id")
);
--> statement-breakpoint
ALTER TABLE "watch_channels" ADD CONSTRAINT "watch_channels_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "watch_channels_expiration_idx" ON "watch_channels" USING btree ("expiration");