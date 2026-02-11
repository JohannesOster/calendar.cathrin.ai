ALTER TABLE "calendar_sync_state" ADD COLUMN "access_role" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "is_read_only" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "read_only_reason" text;