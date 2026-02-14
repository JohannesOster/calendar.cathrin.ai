ALTER TABLE "events" RENAME COLUMN "google_event_id" TO "provider_event_id";--> statement-breakpoint
ALTER INDEX "events_account_google_id_idx" RENAME TO "events_account_provider_id_idx";
