CREATE TABLE "provider_contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"fetched_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "provider_contacts_account_email" UNIQUE("account_id","email")
);
--> statement-breakpoint
ALTER TABLE "provider_contacts" ADD CONSTRAINT "provider_contacts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "provider_contacts_account_idx" ON "provider_contacts" USING btree ("account_id");