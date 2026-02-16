ALTER TABLE "events" ADD COLUMN "recurrence" jsonb;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "recurring_event_id" text;