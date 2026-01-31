CREATE TABLE "fetched_weeks" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"calendar_id" text NOT NULL,
	"week_id" text NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "fetched_weeks_unique" UNIQUE("account_id","calendar_id","week_id")
);
--> statement-breakpoint
ALTER TABLE "fetched_weeks" ADD CONSTRAINT "fetched_weeks_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fetched_weeks_lookup_idx" ON "fetched_weeks" USING btree ("account_id","calendar_id","week_id");