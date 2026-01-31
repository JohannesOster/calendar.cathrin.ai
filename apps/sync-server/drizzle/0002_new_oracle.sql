CREATE TABLE "oauth_pending_tokens" (
	"state" text PRIMARY KEY NOT NULL,
	"token" text,
	"error" text,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "oauth_pending_expires_idx" ON "oauth_pending_tokens" USING btree ("expires_at");